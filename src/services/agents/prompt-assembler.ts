import {
  normalizeAgentContextConfig,
  type AgentContextConfig,
} from "@/types/agents";

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

  const maxPages = 200;
  const pagesToInclude = context.pages.slice(0, maxPages);
  sections.push({
    key: "page-data",
    title: `Page Data (${pagesToInclude.length} of ${context.pages.length} pages)`,
    description: "Per-page crawl data, truncated for token budget control.",
    content:
      "```json\n" +
      JSON.stringify(
        pagesToInclude.map((p) => ({
          url: p.url,
          status: p.statusCode,
          title: p.title,
          metaDescription: p.metaDescription
            ? p.metaDescription.substring(0, 200)
            : null,
          h1: p.h1,
          wordCount: p.wordCount,
          responseTime: p.responseTime,
          pageSize: p.pageSize,
          canonicalUrl: p.canonicalUrl,
          metaRobots: p.metaRobots,
          jsonLd: p.jsonLd,
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

    const issuesToInclude = context.issues.slice(0, 500);

    sections.push({
      key: "existing-issues",
      title: `Full Site Audit Context (${issuesToInclude.length} of ${context.issues.length})`,
      description:
        "Deterministic audit findings passed as baseline evidence to avoid duplicate analysis.",
      content:
        `The deterministic audit detected ${context.issues.length} active issues across the site.\n\n` +
        "### Audit Summary by Category/Severity\n" +
        "```json\n" +
        JSON.stringify(issueSummary, null, 2) +
        "\n```\n\n" +
        "### Audit Findings\n" +
        "Use this as baseline evidence. Your output should add prioritization, root-cause patterns, and implementation-ready remediations.\n\n" +
        "```json\n" +
        JSON.stringify(issuesToInclude, null, 2) +
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
      ? "Net URL and issue changes from the most recent completed crawl."
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
    description: "Structured JSON contract and quality bar enforced for every run.",
    content:
      "You MUST respond with ONLY a valid JSON array. Do not include any text before or after the JSON.\n\n" +
      "Each element in the array must be an object with these fields:\n" +
      '- `type` (string): One of "issue", "recommendation", or "observation"\n' +
      "- `title` (string): A concise, actionable title\n" +
      '- `severity` (string): One of "INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"\n' +
      "- `description` (string): Detailed explanation with evidence from the data\n" +
      "- `affectedUrls` (string[]): Array of affected page URLs\n" +
      "- `remediation` (string): SPECIFIC, ACTIONABLE solution — include exact HTML, config, or code where applicable. Not generic advice.\n" +
      "- `confidence` (number): Your confidence in this finding, 0.0 to 1.0\n\n" +
      "QUALITY BAR:\n" +
      "- Your analysis must reference concrete site data (status codes, canonical targets, metadata values, JSON-LD fields, link targets).\n" +
      "- Group duplicate symptoms into root causes and explain why they happen.\n" +
      "- Prioritize by business impact first (indexation/crawl blockers before cosmetics).\n\n" +
      "IMPORTANT: Your remediation must be specific enough that a developer can implement it without further research. " +
      "For meta tag issues, suggest the exact text. For schema issues, provide the JSON-LD snippet. " +
      "For configuration issues, provide the exact directive.\n\n" +
      "Example:\n" +
      "```json\n" +
      JSON.stringify(
        [
          {
            type: "issue",
            title: "Multiple pages competing for the same keyword",
            severity: "MEDIUM",
            description: "Pages /about and /about-us have nearly identical title tags and target the same 'about company' intent.",
            affectedUrls: ["/about", "/about-us"],
            remediation: "301 redirect /about-us to /about. Add the following to your server config:\n\nRewriteRule ^/about-us$ /about [R=301,L]\n\nThen consolidate the unique content from /about-us into the /about page.",
            confidence: 0.85,
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
