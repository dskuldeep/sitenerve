import {
  normalizeAgentContextConfig,
  type AgentContextConfig,
} from "@/types/agents";

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

export interface ProjectContext {
  projectId: string;
  siteUrl: string;
  totalPages: number;
  totalIssues: number;
  healthScore: number;
  latestCrawlDelta: {
    available: boolean;
    crawlId: string | null;
    crawlCompletedAt: string | null;
    isInitialCrawl: boolean;
    urlDiff: {
      totalPages: number;
      newPagesCount: number;
      removedPagesCount: number;
      changedPagesCount: number;
      newPages: string[];
      removedPages: string[];
      changedPages: Array<{
        url: string;
        changes: Array<{
          field: string;
          oldValue: unknown;
          newValue: unknown;
        }>;
      }>;
    };
    issueDiff: {
      newIssuesCount: number;
      resolvedIssuesCount: number;
      persistedIssuesCount: number;
      activeIssuesAfterCrawl: number | null;
      newIssues: Array<{
        ruleId: string;
        severity: string;
        title: string;
        affectedUrl: string;
        firstDetectedAt: string;
      }>;
      resolvedIssues: Array<{
        ruleId: string;
        severity: string;
        title: string;
        affectedUrl: string;
        resolvedAt: string | null;
      }>;
      persistedIssues: Array<{
        ruleId: string;
        severity: string;
        title: string;
        affectedUrl: string;
        lastDetectedAt: string;
      }>;
    };
  };
  pages: Array<{
    url: string;
    statusCode: number | null;
    title: string | null;
    metaDescription: string | null;
    h1: string[];
    wordCount: number | null;
    responseTime: number | null;
    pageSize: number | null;
    canonicalUrl: string | null;
    metaRobots: string | null;
    jsonLd: unknown[] | null;
    internalLinks: Array<{ href: string; text: string }> | null;
    externalLinks: Array<{ href: string; text: string }> | null;
    images: Array<{ src: string; alt: string; width?: number; height?: number }> | null;
  }>;
  issues: Array<{
    ruleId: string;
    category: string;
    severity: string;
    title: string;
    description: string;
    affectedUrl: string;
    evidence: Record<string, unknown> | null;
  }>;
  /** Set when context was capped for the LLM (see project summary note). */
  promptTruncation?: {
    pagesInPrompt: number;
    pagesTotalInDb: number | null;
    issuesInPrompt: number;
    issuesTotalInDb: number | null;
    crawlDeltaArraysTrimmed: boolean;
  };
}

export interface AgentPromptSection {
  key:
    | "agent-instructions"
    | "additional-skills"
    | "project-summary"
    | "page-data"
    | "existing-issues"
    | "previous-findings"
    | "latest-crawl-delta"
    | "output-format";
  title: string;
  description: string;
  content: string;
  included: boolean;
  available: boolean;
  itemCount?: number;
}

export type AgentPromptMode = "monolith" | "tool_bootstrap";

export function buildPromptSections(config: {
  prompt: string;
  skills: string[];
  context: ProjectContext;
  previousFindings?: Array<{ title: string; severity: string; type: string; status: string }>;
  contextConfig?: AgentContextConfig;
  /** tool_bootstrap: compact prompt; model uses tools to load pages/issues/delta. */
  promptMode?: AgentPromptMode;
}): AgentPromptSection[] {
  const { prompt, skills, context, previousFindings } = config;
  const contextConfig = normalizeAgentContextConfig(config.contextConfig);
  const promptMode = config.promptMode ?? "monolith";
  const sections: AgentPromptSection[] = [];

  sections.push({
    key: "agent-instructions",
    title: "Agent Instructions",
    description: "The editable system prompt for this agent.",
    content: prompt,
    included: true,
    available: true,
  });

  if (skills.length > 0) {
    sections.push({
      key: "additional-skills",
      title: "Additional Skills",
      description: "Attached skill definitions injected ahead of the site data.",
      content: skills.join("\n\n---\n\n"),
      included: true,
      available: true,
      itemCount: skills.length,
    });
  }

  const trunc = context.promptTruncation;
  const hadToCap =
    promptMode === "monolith" &&
    !!trunc &&
    ((trunc.pagesTotalInDb != null && trunc.pagesInPrompt < trunc.pagesTotalInDb) ||
      (trunc.issuesTotalInDb != null && trunc.issuesInPrompt < trunc.issuesTotalInDb) ||
      trunc.crawlDeltaArraysTrimmed);
  const truncNote = hadToCap
      ? "\n\n**Context scope:** Some crawl data was capped for this run so the prompt stays within model limits. " +
        "Delta URLs and higher-severity issues are prioritized. " +
        (trunc.pagesTotalInDb != null && trunc.pagesInPrompt < trunc.pagesTotalInDb
          ? `Pages in prompt: ${trunc.pagesInPrompt} of ${trunc.pagesTotalInDb}. `
          : "") +
        (trunc.issuesTotalInDb != null && trunc.issuesInPrompt < trunc.issuesTotalInDb
          ? `Issues in prompt: ${trunc.issuesInPrompt} of ${trunc.issuesTotalInDb}. `
          : "") +
        (trunc.crawlDeltaArraysTrimmed
          ? "Crawl delta URL/issue lists may be truncated; counts above still reflect the full crawl where available."
          : "")
      : "";

  sections.push({
    key: "project-summary",
    title: "Project Context",
    description: "High-level project metrics that anchor the analysis.",
    content:
      `- **Site URL:** ${context.siteUrl}\n` +
      `- **Total Pages:** ${context.totalPages}\n` +
      `- **Total Active Issues:** ${context.totalIssues}\n` +
      `- **Health Score:** ${context.healthScore}/100\n` +
      (truncNote ? truncNote.trimEnd() : ""),
    included: contextConfig.includeProjectSummary,
    available: true,
  });

  if (promptMode === "tool_bootstrap" && contextConfig.includePageData) {
    sections.push({
      key: "page-data",
      title: `Page data (${context.totalPages} pages indexed)`,
      description: "Load pages incrementally with tools (like exploring a codebase).",
      content:
        "Page rows are **not** inlined. Use tools to explore:\n" +
        "- `get_project_summary` — live indexed page count\n" +
        "- `list_pages` / `search_pages` — paginated; use `totalMatching` and `hasMore`, bump `offset` until done\n" +
        "- `get_pages_by_url` — batch-fetch specific URLs after you discover them\n" +
        "- `get_crawl_delta` — start with `mode=summary`, then `mode=urls` (per segment) and `mode=issues` (per bucket) with offsets\n\n" +
        "Work in chunks: never assume one tool call returns the whole site.",
      included: true,
      available: true,
      itemCount: context.totalPages,
    });
  } else {
    sections.push({
      key: "page-data",
      title: `Page Data (${context.pages.length} pages)`,
      description:
        "Per-page crawl data for the full crawl, slimmed to essential fields instead of truncating page count.",
      content:
        "```json\n" +
        JSON.stringify(
          context.pages.map((p) => ({
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
            jsonLdTypes: summarizeJsonLdTypes(p.jsonLd),
            internalLinkCount: p.internalLinks?.length ?? 0,
            externalLinkCount: p.externalLinks?.length ?? 0,
            imageCount: p.images?.length ?? 0,
            imagesWithoutAlt: p.images?.filter((i) => !i.alt).length ?? 0,
          })),
          null,
          2
        ) +
        "\n```",
      included: contextConfig.includePageData,
      available: context.pages.length > 0,
      itemCount: context.pages.length,
    });
  }

  if (promptMode === "tool_bootstrap" && contextConfig.includeExistingIssues) {
    sections.push({
      key: "existing-issues",
      title: `Site audit issues (${context.totalIssues} active)`,
      description: "Issues are fetched on demand with tools.",
      content:
        "Issues are **not** inlined. Use:\n" +
        "- `list_issues` — paginated active issues (`offset`, `limit`, optional `severity`, `ruleIdContains`, `urlContains`)\n\n" +
        "Higher-severity issues are returned first. Page through with `offset` for large audits.",
      included: true,
      available: true,
      itemCount: context.totalIssues,
    });
  } else if (context.issues.length > 0) {
    const issueSummary = context.issues.reduce<Record<string, number>>((acc, issue) => {
      const key = `${issue.category}:${issue.severity}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    sections.push({
      key: "existing-issues",
      title: `Full Site Audit Context (${context.issues.length} issues)`,
      description:
        "Full deterministic audit baseline, compacted by slimming each issue record rather than truncating issue count.",
      content:
        `The deterministic audit detected ${context.issues.length} active issues across the site.\n\n` +
        "### Audit Summary by Category/Severity\n" +
        "```json\n" +
        JSON.stringify(issueSummary, null, 2) +
        "\n```\n\n" +
        "### Audit Findings\n" +
        "Use this as supporting context when relevant to the agent instructions. Do not default to issue-hunting if the instructions ask for a summary, inventory, or page-diff report.\n\n" +
        "```json\n" +
        JSON.stringify(
          context.issues.map((issue) => ({
            ruleId: issue.ruleId,
            category: issue.category,
            severity: issue.severity,
            title: issue.title,
            description: issue.description,
            affectedUrl: issue.affectedUrl,
            evidenceSummary: summarizeEvidence(issue.evidence),
          })),
          null,
          2
        ) +
        "\n```",
      included: contextConfig.includeExistingIssues,
      available: true,
      itemCount: context.issues.length,
    });
  }

  if (previousFindings && previousFindings.length > 0) {
    sections.push({
      key: "previous-findings",
      title: `Your Previous Findings (${previousFindings.length})`,
      description: "Last successful run findings used for delta analysis and de-duplication.",
      content:
        "These are the findings from your last run. Use them for delta analysis:\n" +
        "- Flag which previous issues PERSIST (still present in the data)\n" +
        "- Flag which previous issues are RESOLVED (no longer supported by data)\n" +
        "- Focus your analysis on NEW findings not covered by your previous run\n" +
        "- If a finding persists with stronger evidence, increase your confidence score\n\n" +
        "```json\n" +
        JSON.stringify(previousFindings, null, 2) +
        "\n```",
      included: contextConfig.includePreviousFindings,
      available: true,
      itemCount: previousFindings.length,
    });
  }

  const deltaSummaryPayload =
    promptMode === "tool_bootstrap" && context.latestCrawlDelta.available
      ? {
          available: true,
          crawlId: context.latestCrawlDelta.crawlId,
          crawlCompletedAt: context.latestCrawlDelta.crawlCompletedAt,
          isInitialCrawl: context.latestCrawlDelta.isInitialCrawl,
          urlDiff: {
            totalPages: context.latestCrawlDelta.urlDiff.totalPages,
            newPagesCount: context.latestCrawlDelta.urlDiff.newPagesCount,
            removedPagesCount: context.latestCrawlDelta.urlDiff.removedPagesCount,
            changedPagesCount: context.latestCrawlDelta.urlDiff.changedPagesCount,
          },
          issueDiff: {
            newIssuesCount: context.latestCrawlDelta.issueDiff.newIssuesCount,
            resolvedIssuesCount: context.latestCrawlDelta.issueDiff.resolvedIssuesCount,
            persistedIssuesCount: context.latestCrawlDelta.issueDiff.persistedIssuesCount,
            activeIssuesAfterCrawl: context.latestCrawlDelta.issueDiff.activeIssuesAfterCrawl,
          },
          note:
            "Use get_crawl_delta: mode=summary first, then paginate mode=urls (urlSegment new|removed|changed) and mode=issues (issueBucket new|resolved|persisted).",
        }
      : context.latestCrawlDelta;

  sections.push({
    key: "latest-crawl-delta",
    title: context.latestCrawlDelta.isInitialCrawl
      ? "Latest Crawl Delta (Initial Baseline)"
      : "Latest Crawl Delta",
    description: context.latestCrawlDelta.available
      ? promptMode === "tool_bootstrap"
        ? "High-level crawl delta counts only; use get_crawl_delta with summary then paginated urls/issues modes."
        : "Net URL and issue changes from the most recent completed crawl. Use this first for prompts about new pages, removed pages, or change summaries."
      : "No completed crawl is available yet, so there is no crawl delta context to inject.",
    content: context.latestCrawlDelta.available
      ? "```json\n" + JSON.stringify(deltaSummaryPayload, null, 2) + "\n```"
      : "No completed crawl is available yet for this project.",
    included: contextConfig.includeLatestCrawlDelta,
    available: context.latestCrawlDelta.available,
    itemCount:
      context.latestCrawlDelta.urlDiff.newPagesCount +
      context.latestCrawlDelta.urlDiff.removedPagesCount +
      context.latestCrawlDelta.urlDiff.changedPagesCount +
      context.latestCrawlDelta.issueDiff.newIssuesCount +
      context.latestCrawlDelta.issueDiff.resolvedIssuesCount,
  });

  const outputMonolith =
    "You MUST respond with ONLY a valid JSON array. Do not include any text before or after the JSON.\n\n" +
    "Each element in the array must be an object with these fields:\n" +
    '- `type` (string): One of "issue", "recommendation", or "observation"\n' +
    "- `title` (string): A concise, actionable title\n" +
    '- `severity` (string): One of "INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"\n' +
    "- `description` (string): The main content. This may be a detailed explanation, a summary, an inventory, or a change report depending on the instructions.\n" +
    "- `affectedUrls` (string[]): Array of affected page URLs\n" +
    "- `remediation` (string): Optional next step, action, or implementation guidance when relevant. Leave it concise when the prompt asks for a report rather than a fix.\n" +
    "- `confidence` (number): Your confidence in this finding, 0.0 to 1.0\n\n" +
    "INSTRUCTION PRIORITY:\n" +
    "- Follow the agent instructions first.\n" +
    "- If the prompt asks for a summary, inventory, diff, or digest, respond with `observation` items instead of forcing everything into SEO issues.\n" +
    "- If the prompt asks specifically about new pages, removed pages, or crawl deltas, prioritize the `Latest Crawl Delta` section over generic site-wide issue patterns.\n" +
    "- Only produce SEO issues and remediations when the instructions ask for analysis or problem-finding.\n\n" +
    "QUALITY BAR:\n" +
    "- Reference concrete data from the provided context.\n" +
    "- Stay aligned with the user's requested task instead of defaulting to a standard audit.\n" +
    "- When summarizing, favor coverage and clarity over remediation depth.\n\n" +
    "Example:\n" +
    "```json\n" +
    JSON.stringify(
      [
        {
          type: "observation",
          title: "18 new pages were detected in the latest crawl",
          severity: "INFO",
          description: "Most new URLs are under /docs/integrations and /docs/api. No removed pages were detected in the same crawl window.",
          affectedUrls: ["/docs/integrations/example-a", "/docs/api/example-b"],
          remediation: "Review the new pages for indexability, internal linking, and sitemap inclusion if you want a follow-up audit.",
          confidence: 0.94,
        },
      ],
      null,
      2
    ) +
    "\n```";

  const outputToolBootstrap =
    "You are running in **tool mode** (similar to a coding agent over a repo). Use the provided function tools to read project data in batches.\n\n" +
    "WORKFLOW:\n" +
    "1. Plan what evidence you need for the user instructions.\n" +
    "2. Call tools iteratively (counts → search → targeted URL batches → issues/delta as needed).\n" +
    "3. When finished, call **`submit_agent_results`** exactly once with a `findings` array.\n\n" +
    "FINDINGS SCHEMA (each item):\n" +
    '- `type`: "issue" | "recommendation" | "observation"\n' +
    '- `severity`: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"\n' +
    "- `title`, `description` (required)\n" +
    "- `affectedUrls` (string[]), optional `remediation`, `confidence` (0..1), `source`\n\n" +
    "Do **not** paste the final JSON as plain text — use `submit_agent_results`.\n" +
    "If the task needs no structured output, submit an empty `findings` array.\n\n" +
    "INSTRUCTION PRIORITY:\n" +
    "- Follow the agent instructions first; use tools to ground answers in real crawl/audit data.\n" +
    "- Prefer observations for summaries/inventories/diffs; use issues only when the instructions ask for problems.\n";

  sections.push({
    key: "output-format",
    title: "Output Format",
    description:
      promptMode === "tool_bootstrap"
        ? "Finish via submit_agent_results after tool exploration."
        : "Structured JSON contract that should follow the agent instructions rather than forcing a single SEO-audit style.",
    content: promptMode === "tool_bootstrap" ? outputToolBootstrap : outputMonolith,
    included: true,
    available: true,
  });

  return sections;
}

export function assemblePrompt(config: {
  prompt: string;
  skills: string[];
  context: ProjectContext;
  previousFindings?: Array<{ title: string; severity: string; type: string; status: string }>;
  contextConfig?: AgentContextConfig;
  promptMode?: AgentPromptMode;
}): string {
  return buildPromptSections(config)
    .filter((section) => section.included && section.available)
    .map((section) => `## ${section.title}\n\n${section.content}`)
    .join("\n\n---\n\n");
}
