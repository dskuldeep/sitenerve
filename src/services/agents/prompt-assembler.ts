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

export function buildPromptSections(config: {
  prompt: string;
  skills: string[];
  context: ProjectContext;
  previousFindings?: Array<{ title: string; severity: string; type: string; status: string }>;
  contextConfig?: AgentContextConfig;
}): AgentPromptSection[] {
  const { prompt, skills, context, previousFindings } = config;
  const contextConfig = normalizeAgentContextConfig(config.contextConfig);
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

  sections.push({
    key: "project-summary",
    title: "Project Context",
    description: "High-level project metrics that anchor the analysis.",
    content:
      `- **Site URL:** ${context.siteUrl}\n` +
      `- **Total Pages:** ${context.totalPages}\n` +
      `- **Total Active Issues:** ${context.totalIssues}\n` +
      `- **Health Score:** ${context.healthScore}/100\n`,
    included: contextConfig.includeProjectSummary,
    available: true,
  });

  sections.push({
    key: "page-data",
    title: `Page Data (${context.pages.length} pages)`,
    description: "Per-page crawl data for the full crawl, slimmed to essential fields instead of truncating page count.",
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

  if (context.issues.length > 0) {
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

  sections.push({
    key: "latest-crawl-delta",
    title: context.latestCrawlDelta.isInitialCrawl
      ? "Latest Crawl Delta (Initial Baseline)"
      : "Latest Crawl Delta",
    description: context.latestCrawlDelta.available
      ? "Net URL and issue changes from the most recent completed crawl. Use this first for prompts about new pages, removed pages, or change summaries."
      : "No completed crawl is available yet, so there is no crawl delta context to inject.",
    content: context.latestCrawlDelta.available
      ? "```json\n" + JSON.stringify(context.latestCrawlDelta, null, 2) + "\n```"
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

  sections.push({
    key: "output-format",
    title: "Output Format",
    description: "Structured JSON contract that should follow the agent instructions rather than forcing a single SEO-audit style.",
    content:
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
      "\n```",
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
}): string {
  return buildPromptSections(config)
    .filter((section) => section.included && section.available)
    .map((section) => `## ${section.title}\n\n${section.content}`)
    .join("\n\n---\n\n");
}
