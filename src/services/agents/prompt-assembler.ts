export interface ProjectContext {
  projectId: string;
  siteUrl: string;
  totalPages: number;
  totalIssues: number;
  healthScore: number;
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

export function assemblePrompt(config: {
  prompt: string;
  skills: string[];
  context: ProjectContext;
  previousFindings?: Array<{ title: string; severity: string; type: string; status: string }>;
}): string {
  const { prompt, skills, context, previousFindings } = config;

  const sections: string[] = [];

  // System prompt (the agent's core instructions)
  sections.push(`## Agent Instructions\n\n${prompt}`);

  // Skill definitions (additional capabilities injected from skills.sh)
  if (skills.length > 0) {
    sections.push(`## Additional Skills\n\n${skills.join("\n\n---\n\n")}`);
  }

  // Project context
  sections.push(
    `## Project Context\n\n` +
      `- **Site URL:** ${context.siteUrl}\n` +
      `- **Total Pages:** ${context.totalPages}\n` +
      `- **Total Active Issues:** ${context.totalIssues}\n` +
      `- **Health Score:** ${context.healthScore}/100\n`
  );

  // Page data (truncated for token budget)
  const maxPages = 200;
  const pagesToInclude = context.pages.slice(0, maxPages);

  sections.push(
    `## Page Data (${pagesToInclude.length} of ${context.pages.length} pages)\n\n` +
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
      "\n```"
  );

  // Existing issues for context (avoid duplicate findings)
  if (context.issues.length > 0) {
    const issueSummary = context.issues.reduce<Record<string, number>>((acc, issue) => {
      const key = `${issue.category}:${issue.severity}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const issuesToInclude = context.issues.slice(0, 500);

    sections.push(
      `## Full Site Audit Context\n\n` +
        `The deterministic audit detected ${context.issues.length} active issues across the site.\n\n` +
        "### Audit Summary by Category/Severity\n" +
        "```json\n" +
        JSON.stringify(issueSummary, null, 2) +
        "\n```\n\n" +
        `### Audit Findings (${issuesToInclude.length} of ${context.issues.length})\n` +
        "Use this as baseline evidence. Your output should add prioritization, root-cause patterns, and implementation-ready remediations.\n\n" +
        "```json\n" +
        JSON.stringify(issuesToInclude, null, 2) +
        "\n```"
    );
  }

  // Previous findings for delta analysis
  if (previousFindings && previousFindings.length > 0) {
    sections.push(
      `## Your Previous Findings (${previousFindings.length})\n\n` +
        "These are the findings from your last run. Use them for delta analysis:\n" +
        "- Flag which previous issues PERSIST (still present in the data)\n" +
        "- Flag which previous issues are RESOLVED (no longer supported by data)\n" +
        "- Focus your analysis on NEW findings not covered by your previous run\n" +
        "- If a finding persists with stronger evidence, increase your confidence score\n\n" +
        "```json\n" +
        JSON.stringify(previousFindings, null, 2) +
        "\n```"
    );
  }

  // Structured output instructions
  sections.push(
    `## Output Format\n\n` +
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
      "\n```"
  );

  return sections.join("\n\n---\n\n");
}
