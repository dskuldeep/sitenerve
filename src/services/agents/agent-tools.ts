import type { IssueSeverity } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  normalizeAgentContextConfig,
  type AgentContextConfig,
  type AgentRunToolTrace,
} from "@/types/agents";
import {
  countCrawlDeltaIssuesInBucket,
  listCrawlDeltaIssuesInBucket,
  loadCrawlDeltaWindowContext,
} from "./crawl-delta";
import type { AgentToolLimits } from "./context-limits";
import {
  FunctionCallingMode,
  SchemaType,
  type FunctionDeclaration,
  type GoogleGenerativeAI,
  type Schema,
} from "@google/generative-ai";

function summarizeJsonLdTypes(jsonLd: unknown[] | null): string[] {
  if (!Array.isArray(jsonLd)) return [];
  const types = new Set<string>();
  for (const entry of jsonLd) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const typeValue = record["@type"];
    if (typeof typeValue === "string" && typeValue.trim()) {
      types.add(typeValue.trim());
      continue;
    }
    if (Array.isArray(typeValue)) {
      for (const nestedType of typeValue) {
        if (typeof nestedType === "string" && nestedType.trim()) {
          types.add(nestedType.trim());
        }
      }
    }
  }
  return Array.from(types);
}

function summarizeEvidence(evidence: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!evidence) return null;
  const keys = Object.keys(evidence);
  if (keys.length === 0) return null;
  return {
    keys,
    sample:
      keys.length > 0
        ? Object.fromEntries(keys.slice(0, 5).map((key) => [key, evidence[key] ?? null]))
        : null,
  };
}

const TRACE_RESPONSE_MAX_CHARS = 14_000;

function slimForTraceResponse(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  try {
    const s = JSON.stringify(data);
    if (s.length <= TRACE_RESPONSE_MAX_CHARS) return data;
    return {
      _truncated: true,
      originalLength: s.length,
      preview: s.slice(0, TRACE_RESPONSE_MAX_CHARS),
    };
  } catch {
    return { _error: "unserializable_response" };
  }
}

function capToolPayload(data: unknown, maxChars: number): Record<string, unknown> {
  const payload = data as Record<string, unknown>;
  const s = JSON.stringify(payload);
  if (s.length <= maxChars) return payload;
  return {
    truncated: true,
    maxChars,
    message:
      "Tool output exceeded the size cap. Narrow your query (smaller limit, urlContains, or specific URLs).",
    preview: s.slice(0, Math.min(maxChars, 8000)),
  };
}

const listPagesSchema = z.object({
  offset: z.number().int().min(0).optional().default(0),
  limit: z.number().int().min(1).optional(),
  urlContains: z.string().optional(),
});

const getPagesByUrlSchema = z.object({
  urls: z.array(z.string()).min(1),
});

const searchPagesSchema = z.object({
  query: z.string().min(1),
  offset: z.number().int().min(0).optional().default(0),
  limit: z.number().int().min(1).optional(),
});

const listIssuesSchema = z.object({
  offset: z.number().int().min(0).optional().default(0),
  limit: z.number().int().min(1).optional(),
  severity: z
    .enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"])
    .optional(),
  ruleIdContains: z.string().optional(),
  urlContains: z.string().optional(),
});

const getCrawlDeltaSchema = z
  .object({
    mode: z.enum(["summary", "urls", "issues"]).default("summary"),
    urlSegment: z.enum(["new", "removed", "changed"]).optional(),
    urlOffset: z.coerce.number().int().min(0).default(0),
    urlLimit: z.coerce.number().int().min(1).default(100),
    issueBucket: z.enum(["new", "resolved", "persisted"]).optional(),
    issueOffset: z.coerce.number().int().min(0).default(0),
    issueLimit: z.coerce.number().int().min(1).default(120),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "urls" && data.urlSegment === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "When mode is 'urls', set urlSegment to new | removed | changed",
        path: ["urlSegment"],
      });
    }
    if (data.mode === "issues" && data.issueBucket === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "When mode is 'issues', set issueBucket to new | resolved | persisted",
        path: ["issueBucket"],
      });
    }
  });

export async function executeAgentTool(
  projectId: string,
  name: string,
  rawArgs: unknown,
  limits: AgentToolLimits,
  contextConfig: AgentContextConfig
): Promise<Record<string, unknown>> {
  const wrap = (data: unknown) => capToolPayload(data, limits.maxToolResponseChars);

  const allowedRead = new Set(
    getAgentFunctionDeclarationsForContext(contextConfig)
      .map((d) => d.name)
      .filter((n) => n !== "submit_agent_results")
  );
  if (!allowedRead.has(name)) {
    return {
      error: `Tool "${name}" is not enabled for this agent run (check Runtime Context toggles).`,
    };
  }

  try {
    switch (name) {
      case "get_project_summary": {
        const project = await prisma.project.findUniqueOrThrow({
          where: { id: projectId },
          select: {
            siteUrl: true,
            healthScore: true,
            totalPages: true,
            totalIssues: true,
            status: true,
          },
        });
        const [pagesInDb, activeIssuesInDb] = await Promise.all([
          prisma.page.count({ where: { projectId } }),
          prisma.issue.count({ where: { projectId, status: "ACTIVE" } }),
        ]);
        return wrap({
          siteUrl: project.siteUrl,
          healthScore: project.healthScore,
          projectTotalPagesField: project.totalPages,
          projectTotalIssuesField: project.totalIssues,
          pagesIndexedCount: pagesInDb,
          activeIssuesCount: activeIssuesInDb,
          projectStatus: project.status,
        });
      }

      case "list_pages": {
        const args = listPagesSchema.parse(rawArgs ?? {});
        const take = Math.min(args.limit ?? limits.listPagesMax, limits.listPagesMax);
        const where = {
          projectId,
          ...(args.urlContains?.trim()
            ? { url: { contains: args.urlContains.trim(), mode: "insensitive" as const } }
            : {}),
        };
        const [rows, totalMatching] = await Promise.all([
          prisma.page.findMany({
            where,
            select: {
              url: true,
              statusCode: true,
              title: true,
              metaDescription: true,
              h1: true,
              wordCount: true,
              responseTime: true,
              pageSize: true,
              canonicalUrl: true,
              metaRobots: true,
              jsonLd: true,
              internalLinks: true,
              externalLinks: true,
              images: true,
            },
            orderBy: { url: "asc" },
            skip: args.offset,
            take,
          }),
          prisma.page.count({ where }),
        ]);
        return wrap({
          offset: args.offset,
          limit: take,
          returned: rows.length,
          totalMatching,
          hasMore: args.offset + rows.length < totalMatching,
          pages: rows.map((p) => ({
            url: p.url,
            status: p.statusCode,
            title: p.title,
            metaDescription: p.metaDescription,
            h1: p.h1,
            wordCount: p.wordCount,
            responseTime: p.responseTime,
            pageSize: p.pageSize,
            canonicalUrl: p.canonicalUrl,
            metaRobots: p.metaRobots,
            jsonLdTypes: summarizeJsonLdTypes(p.jsonLd as unknown[] | null),
            internalLinkCount: Array.isArray(p.internalLinks) ? p.internalLinks.length : 0,
            externalLinkCount: Array.isArray(p.externalLinks) ? p.externalLinks.length : 0,
            imageCount: Array.isArray(p.images) ? p.images.length : 0,
            imagesWithoutAlt: Array.isArray(p.images)
              ? p.images.filter((i) => {
                  if (typeof i !== "object" || i === null) return true;
                  const alt = (i as Record<string, unknown>).alt;
                  return typeof alt !== "string" || !alt.trim();
                }).length
              : 0,
          })),
        });
      }

      case "get_pages_by_url": {
        const args = getPagesByUrlSchema.parse(rawArgs ?? {});
        const urls = [...new Set(args.urls.map((u) => u.trim()).filter(Boolean))].slice(
          0,
          limits.getPagesByUrlMax
        );
        const rows = await prisma.page.findMany({
          where: { projectId, url: { in: urls } },
          select: {
            url: true,
            statusCode: true,
            title: true,
            metaDescription: true,
            h1: true,
            wordCount: true,
            responseTime: true,
            pageSize: true,
            canonicalUrl: true,
            metaRobots: true,
            jsonLd: true,
            internalLinks: true,
            externalLinks: true,
            images: true,
          },
        });
        return wrap({
          requested: urls.length,
          found: rows.length,
          pages: rows.map((p) => ({
            url: p.url,
            status: p.statusCode,
            title: p.title,
            metaDescription: p.metaDescription,
            h1: p.h1,
            wordCount: p.wordCount,
            responseTime: p.responseTime,
            pageSize: p.pageSize,
            canonicalUrl: p.canonicalUrl,
            metaRobots: p.metaRobots,
            jsonLdTypes: summarizeJsonLdTypes(p.jsonLd as unknown[] | null),
            internalLinkCount: Array.isArray(p.internalLinks) ? p.internalLinks.length : 0,
            externalLinkCount: Array.isArray(p.externalLinks) ? p.externalLinks.length : 0,
            imageCount: Array.isArray(p.images) ? p.images.length : 0,
            imagesWithoutAlt: Array.isArray(p.images)
              ? p.images.filter((i) => {
                  if (typeof i !== "object" || i === null) return true;
                  const alt = (i as Record<string, unknown>).alt;
                  return typeof alt !== "string" || !alt.trim();
                }).length
              : 0,
          })),
        });
      }

      case "search_pages": {
        const args = searchPagesSchema.parse(rawArgs ?? {});
        const take = Math.min(args.limit ?? limits.listPagesMax, limits.listPagesMax);
        const q = args.query.trim();
        const where = {
          projectId,
          OR: [
            { url: { contains: q, mode: "insensitive" as const } },
            { title: { contains: q, mode: "insensitive" as const } },
          ],
        };
        const [rows, totalMatching] = await Promise.all([
          prisma.page.findMany({
            where,
            select: {
              url: true,
              statusCode: true,
              title: true,
              metaDescription: true,
              h1: true,
              wordCount: true,
            },
            orderBy: { url: "asc" },
            skip: args.offset,
            take,
          }),
          prisma.page.count({ where }),
        ]);
        return wrap({
          query: q,
          offset: args.offset,
          limit: take,
          returned: rows.length,
          totalMatching,
          hasMore: args.offset + rows.length < totalMatching,
          pages: rows,
        });
      }

      case "list_issues": {
        const args = listIssuesSchema.parse(rawArgs ?? {});
        const take = Math.min(args.limit ?? limits.listIssuesMax, limits.listIssuesMax);
        const where = {
          projectId,
          status: "ACTIVE" as const,
          ...(args.severity ? { severity: args.severity as IssueSeverity } : {}),
          ...(args.ruleIdContains?.trim()
            ? { ruleId: { contains: args.ruleIdContains.trim(), mode: "insensitive" as const } }
            : {}),
          ...(args.urlContains?.trim()
            ? { affectedUrl: { contains: args.urlContains.trim(), mode: "insensitive" as const } }
            : {}),
        };
        const [rows, totalMatching] = await Promise.all([
          prisma.issue.findMany({
            where,
            select: {
              ruleId: true,
              category: true,
              severity: true,
              title: true,
              description: true,
              affectedUrl: true,
              evidence: true,
            },
            orderBy: [{ severity: "desc" }, { affectedUrl: "asc" }],
            skip: args.offset,
            take,
          }),
          prisma.issue.count({ where }),
        ]);
        return wrap({
          offset: args.offset,
          limit: take,
          returned: rows.length,
          totalMatching,
          hasMore: args.offset + rows.length < totalMatching,
          issues: rows.map((i) => ({
            ruleId: i.ruleId,
            category: i.category,
            severity: i.severity,
            title: i.title,
            description: i.description,
            affectedUrl: i.affectedUrl,
            evidenceSummary: summarizeEvidence(i.evidence as Record<string, unknown> | null),
          })),
        });
      }

      case "get_crawl_delta": {
        const args = getCrawlDeltaSchema.parse(rawArgs ?? {});
        const ctx = await loadCrawlDeltaWindowContext(projectId);
        if (!ctx) {
          return wrap({ error: "No completed crawl found for this project.", mode: args.mode });
        }

        if (args.mode === "summary") {
          const [newC, resolvedC, persistedC] = await Promise.all([
            countCrawlDeltaIssuesInBucket(projectId, ctx, "new"),
            countCrawlDeltaIssuesInBucket(projectId, ctx, "resolved"),
            countCrawlDeltaIssuesInBucket(projectId, ctx, "persisted"),
          ]);
          return wrap({
            mode: "summary",
            crawlId: ctx.crawlId,
            crawlCompletedAt: ctx.crawlCompletedAt,
            isInitialCrawl: ctx.isInitialCrawl,
            urlDiff: {
              totalPages: ctx.totalPages,
              newPagesCount: ctx.newPagesCount,
              removedPagesCount: ctx.removedPagesCount,
              changedPagesCount: ctx.changedPagesCount,
              listLengths: {
                newUrlsInDiffJson: ctx.newPagesUrls.length,
                removedUrlsInDiffJson: ctx.removedPagesUrls.length,
                changedEntriesInDiffJson: ctx.changedPagesEntries.length,
              },
            },
            issueWindowCounts: {
              newIssues: newC,
              resolvedIssues: resolvedC,
              persistedIssues: persistedC,
            },
            activeIssuesAfterCrawl:
              typeof ctx.postProcessing.activeIssueCount === "number"
                ? ctx.postProcessing.activeIssueCount
                : null,
            paginationHint:
              "Paginate URLs: mode=urls, urlSegment=new|removed|changed, urlOffset, urlLimit. " +
              "Paginate crawl-window issues: mode=issues, issueBucket=new|resolved|persisted, issueOffset, issueLimit. " +
              "Call summary first, then page until hasMore is false.",
          });
        }

        if (args.mode === "urls") {
          const seg = args.urlSegment!;
          const lim = Math.min(args.urlLimit, limits.crawlDeltaUrlPageMax);
          const off = args.urlOffset;
          let total = 0;
          let items: unknown;
          if (seg === "new") {
            total = ctx.newPagesUrls.length;
            items = ctx.newPagesUrls.slice(off, off + lim);
          } else if (seg === "removed") {
            total = ctx.removedPagesUrls.length;
            items = ctx.removedPagesUrls.slice(off, off + lim);
          } else {
            total = ctx.changedPagesEntries.length;
            items = ctx.changedPagesEntries.slice(off, off + lim);
          }
          return wrap({
            mode: "urls",
            urlSegment: seg,
            urlOffset: off,
            urlLimit: lim,
            totalInSegment: total,
            returned: Array.isArray(items) ? items.length : 0,
            hasMore: off + lim < total,
            items,
          });
        }

        const bucket = args.issueBucket!;
        const lim = Math.min(args.issueLimit, limits.crawlDeltaIssuePageMax);
        const off = args.issueOffset;
        const [totalInBucket, issues] = await Promise.all([
          countCrawlDeltaIssuesInBucket(projectId, ctx, bucket),
          listCrawlDeltaIssuesInBucket(projectId, ctx, bucket, off, lim),
        ]);
        return wrap({
          mode: "issues",
          issueBucket: bucket,
          issueOffset: off,
          issueLimit: lim,
          totalInBucket,
          returned: issues.length,
          hasMore: off + lim < totalInBucket,
          issues,
        });
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

const findingItemSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    type: { type: SchemaType.STRING, description: "issue | recommendation | observation" },
    title: { type: SchemaType.STRING },
    severity: { type: SchemaType.STRING, description: "INFO | LOW | MEDIUM | HIGH | CRITICAL" },
    description: { type: SchemaType.STRING },
    affectedUrls: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "URLs this finding applies to",
    },
    remediation: { type: SchemaType.STRING, description: "Optional" },
    confidence: { type: SchemaType.NUMBER, description: "0..1" },
    source: { type: SchemaType.STRING, description: "Optional" },
  },
  required: ["type", "title", "severity", "description"],
};

export const AGENT_READ_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "get_project_summary",
    description:
      "Fresh project metrics: live page and active-issue counts, health score, site URL. Call first to orient.",
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: "list_pages",
    description:
      "Paginated crawl snapshot for pages (slim fields). Response includes totalMatching and hasMore — increase offset until hasMore is false.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        offset: { type: SchemaType.INTEGER, description: "Skip N rows (default 0)" },
        limit: {
          type: SchemaType.INTEGER,
          description: "Page size (capped server-side; default tool max)",
        },
        urlContains: { type: SchemaType.STRING, description: "Filter URLs containing this substring" },
      },
      required: [],
    },
  },
  {
    name: "get_pages_by_url",
    description: "Fetch detailed slim rows for specific URLs (batch).",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        urls: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: "Full URLs as stored in the crawl",
        },
      },
      required: ["urls"],
    },
  },
  {
    name: "search_pages",
    description:
      "Search indexed pages by URL or title substring. Includes totalMatching and hasMore for pagination.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING },
        offset: { type: SchemaType.INTEGER },
        limit: { type: SchemaType.INTEGER },
      },
      required: ["query"],
    },
  },
  {
    name: "list_issues",
    description:
      "Paginated active audit issues with filters. Response includes totalMatching and hasMore. Server orders by severity then URL.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        offset: { type: SchemaType.INTEGER },
        limit: { type: SchemaType.INTEGER },
        severity: { type: SchemaType.STRING, description: "INFO|LOW|MEDIUM|HIGH|CRITICAL" },
        ruleIdContains: { type: SchemaType.STRING },
        urlContains: { type: SchemaType.STRING, description: "Filter affectedUrl" },
      },
      required: [],
    },
  },
  {
    name: "get_crawl_delta",
    description:
      "Latest completed crawl delta — MUST paginate. Default mode=summary (counts + list lengths + issue totals, no heavy arrays). " +
      "mode=urls needs urlSegment new|removed|changed plus urlOffset/urlLimit. " +
      "mode=issues needs issueBucket new|resolved|persisted plus issueOffset/issueLimit. " +
      "Page until hasMore is false to traverse the full project delta.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        mode: {
          type: SchemaType.STRING,
          description: "summary (default) | urls | issues",
        },
        urlSegment: {
          type: SchemaType.STRING,
          description: "Required for mode=urls: new | removed | changed",
        },
        urlOffset: { type: SchemaType.INTEGER, description: "Start index into URL list (default 0)" },
        urlLimit: { type: SchemaType.INTEGER, description: "Page size for URLs (default 100, capped server-side)" },
        issueBucket: {
          type: SchemaType.STRING,
          description: "Required for mode=issues: new | resolved | persisted",
        },
        issueOffset: { type: SchemaType.INTEGER, description: "Skip N issues in bucket (default 0)" },
        issueLimit: { type: SchemaType.INTEGER, description: "Page size for issues (default 120, capped server-side)" },
      },
      required: [],
    },
  },
];

export const SUBMIT_AGENT_RESULTS_DECLARATION: FunctionDeclaration = {
  name: "submit_agent_results",
  description:
    "Finish the run by submitting findings. Call exactly once when done (findings may be an empty array).",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      findings: {
        type: SchemaType.ARRAY,
        description: "Structured findings for this run",
        items: findingItemSchema,
      },
    },
    required: ["findings"],
  },
};

const READ_DECL_BY_NAME = Object.fromEntries(
  AGENT_READ_TOOL_DECLARATIONS.map((d) => [d.name, d])
) as Record<string, FunctionDeclaration>;

export function getAgentFunctionDeclarationsForContext(
  config: AgentContextConfig
): FunctionDeclaration[] {
  const c = normalizeAgentContextConfig(config);
  const names: string[] = [];
  if (c.includeProjectSummary) names.push("get_project_summary");
  if (c.includePageData) {
    names.push("list_pages", "get_pages_by_url", "search_pages");
  }
  if (c.includeExistingIssues) names.push("list_issues");
  if (c.includeLatestCrawlDelta) names.push("get_crawl_delta");
  const decls = names
    .map((n) => READ_DECL_BY_NAME[n])
    .filter((d): d is FunctionDeclaration => Boolean(d));
  decls.push(SUBMIT_AGENT_RESULTS_DECLARATION);
  return decls;
}

export function listAgentToolNamesForContext(config: AgentContextConfig): string[] {
  return getAgentFunctionDeclarationsForContext(config).map((d) => d.name);
}

/**
 * Human-readable appendix for Runtime Preview (full prompt) — mirrors tool declarations sent to Gemini.
 */
export function formatAgentToolsForPromptAppendix(config: AgentContextConfig): string {
  const decls = getAgentFunctionDeclarationsForContext(config);
  const blocks: string[] = [
    "## Available tools (Gemini function declarations)",
    "",
    "These definitions are registered with the model as **tools** in addition to the markdown sections above. " +
      "Parameter schemas follow the Gemini / OpenAPI-style JSON schema below.",
    "",
  ];

  for (const d of decls) {
    blocks.push(`### \`${d.name}\``);
    if (d.description?.trim()) {
      blocks.push(d.description.trim());
    }
    if (d.parameters) {
      blocks.push("```json");
      blocks.push(JSON.stringify(d.parameters, null, 2));
      blocks.push("```");
    }
    blocks.push("");
  }

  return blocks.join("\n").trimEnd();
}

export async function runAgenticGeminiLoop(options: {
  client: GoogleGenerativeAI;
  model: string;
  temperature: number;
  bootstrapUserMessage: string;
  projectId: string;
  toolLimits: AgentToolLimits;
  contextConfig: AgentContextConfig;
}): Promise<{
  rawFindings: unknown[];
  transcript: string;
  fallbackText?: string;
  toolTrace: AgentRunToolTrace;
}> {
  const traceSteps: AgentRunToolTrace["steps"] = [];
  const functionDeclarations = getAgentFunctionDeclarationsForContext(options.contextConfig);
  const genModel = options.client.getGenerativeModel({
    model: options.model,
    generationConfig: { temperature: options.temperature },
    tools: [{ functionDeclarations }],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingMode.AUTO,
      },
    },
  });

  const chat = genModel.startChat({ history: [] });
  let result = await chat.sendMessage(options.bootstrapUserMessage);

  const transcriptParts: string[] = [`[user]\n${options.bootstrapUserMessage}`];

  for (let turn = 0; turn < options.toolLimits.maxAgentTurns; turn++) {
    const calls = result.response.functionCalls();
    if (!calls?.length) {
      const text = result.response.text();
      transcriptParts.push(`[model text]\n${text}`);
      traceSteps.push({ type: "model_text", text: text.slice(0, 12_000) });
      return {
        rawFindings: [],
        transcript: transcriptParts.join("\n\n---\n\n"),
        fallbackText: text,
        toolTrace: { version: 1, steps: traceSteps },
      };
    }

    transcriptParts.push(
      `[model functionCalls]\n${JSON.stringify(calls.map((c) => ({ name: c.name, args: c.args })))}`
    );
    traceSteps.push({
      type: "function_calls",
      calls: calls.map((c) => ({ name: c.name, args: c.args })),
    });

    const submit = calls.find((c) => c.name === "submit_agent_results");
    if (submit) {
      const args = submit.args as { findings?: unknown };
      const findings = Array.isArray(args.findings) ? args.findings : [];
      transcriptParts.push(`[submit_agent_results] count=${findings.length}`);
      traceSteps.push({ type: "submit_findings", findingsCount: findings.length });
      return {
        rawFindings: findings,
        transcript: transcriptParts.join("\n\n---\n\n"),
        toolTrace: { version: 1, steps: traceSteps },
      };
    }

    const responseParts = await Promise.all(
      calls.map(async (call) => {
        const payload = await executeAgentTool(
          options.projectId,
          call.name,
          call.args,
          options.toolLimits,
          options.contextConfig
        );
        return {
          functionResponse: {
            name: call.name,
            response: payload,
          },
        };
      })
    );

    traceSteps.push({
      type: "function_results",
      results: responseParts.map((p) => ({
        name: p.functionResponse.name,
        response: slimForTraceResponse(p.functionResponse.response),
      })),
    });

    transcriptParts.push(
      `[tool results]\n${JSON.stringify(responseParts.map((p) => p.functionResponse))}`
    );

    result = await chat.sendMessage(responseParts);
  }

  throw new Error(
    `Agent tool loop exceeded max turns (${options.toolLimits.maxAgentTurns}). Consider raising AGENT_MAX_TURNS or simplifying the task.`
  );
}
