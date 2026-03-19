import { prisma } from "@/lib/prisma";
import {
  getAgentContextConfigFromTriggerConfig,
  normalizeAgentContextConfig,
  type AgentContextConfig,
} from "@/types/agents";
import {
  assemblePrompt,
  buildPromptSections,
  type AgentPromptSection,
  type ProjectContext,
} from "./prompt-assembler";
import { formatAgentToolsForPromptAppendix, listAgentToolNamesForContext } from "./agent-tools";
import { loadLatestCrawlDelta, loadLatestCrawlDeltaSummary } from "./crawl-delta";
import {
  chunkArray,
  getAgentContextLimits,
  getAgentToolLimits,
  isAgentToolLoopEnabled,
  type AgentContextLimits,
} from "./context-limits";
import { resolveSkills } from "./skill-resolver";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const PAGE_QUERY_IN_CHUNK = 320;

export interface AgentRuntimeOverrides {
  prompt?: string;
  geminiModel?: string | null;
  contextConfig?: AgentContextConfig;
}

export interface AgentPromptPreview {
  fullPrompt: string;
  sections: AgentPromptSection[];
  contextConfig: AgentContextConfig;
  toolLoopEnabled: boolean;
  toolNames: string[];
  summary: {
    siteUrl: string;
    totalPages: number;
    totalIssues: number;
    healthScore: number;
    previousFindingsCount: number;
    attachedSkillsCount: number;
  };
}

async function loadBootstrapProjectContext(projectId: string): Promise<ProjectContext> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      id: true,
      siteUrl: true,
      totalPages: true,
      totalIssues: true,
      healthScore: true,
    },
  });

  const latestCrawlDelta = await loadLatestCrawlDeltaSummary(projectId);

  return {
    projectId: project.id,
    siteUrl: project.siteUrl,
    totalPages: project.totalPages,
    totalIssues: project.totalIssues,
    healthScore: project.healthScore,
    latestCrawlDelta,
    pages: [],
    issues: [],
  };
}

const pageSelect = {
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
} as const;

type PageRow = {
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
  jsonLd: unknown;
  internalLinks: unknown;
  externalLinks: unknown;
  images: unknown;
};

async function loadProjectContext(
  projectId: string,
  limits: AgentContextLimits = getAgentContextLimits()
): Promise<ProjectContext> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      id: true,
      siteUrl: true,
      totalPages: true,
      totalIssues: true,
      healthScore: true,
    },
  });

  const { delta: latestCrawlDelta, crawlDeltaArraysTrimmed } = await loadLatestCrawlDelta(
    projectId,
    limits
  );

  const priorityRaw: string[] = [];
  const seenUrl = new Set<string>();
  const pushUrl = (u: string) => {
    const t = u.trim();
    if (t && !seenUrl.has(t)) {
      seenUrl.add(t);
      priorityRaw.push(t);
    }
  };
  for (const u of latestCrawlDelta.urlDiff.newPages) pushUrl(u);
  for (const u of latestCrawlDelta.urlDiff.removedPages) pushUrl(u);
  for (const c of latestCrawlDelta.urlDiff.changedPages) pushUrl(c.url);

  const priorityUrls = priorityRaw.slice(0, limits.maxPages);

  let selectedPages: PageRow[] = [];

  if (priorityUrls.length > 0) {
    for (const chunk of chunkArray(priorityUrls, PAGE_QUERY_IN_CHUNK)) {
      const batch = await prisma.page.findMany({
        where: { projectId, url: { in: chunk } },
        select: pageSelect,
      });
      const byUrl = new Map(batch.map((p) => [p.url, p as PageRow]));
      for (const url of chunk) {
        const row = byUrl.get(url);
        if (row) selectedPages.push(row);
      }
    }
  }

  const remainingSlots = limits.maxPages - selectedPages.length;
  if (remainingSlots > 0) {
    const used = new Set(selectedPages.map((p) => p.url));
    const fill = await prisma.page.findMany({
      where: {
        projectId,
        ...(used.size > 0 ? { url: { notIn: [...used] } } : {}),
      },
      select: pageSelect,
      orderBy: { url: "asc" },
      take: remainingSlots,
    });
    selectedPages = [...selectedPages, ...(fill as PageRow[])];
  } else if (priorityUrls.length === 0 && limits.maxPages > 0) {
    selectedPages = (await prisma.page.findMany({
      where: { projectId },
      select: pageSelect,
      orderBy: { url: "asc" },
      take: limits.maxPages,
    })) as PageRow[];
  }

  if (selectedPages.length > limits.maxPages) {
    selectedPages = selectedPages.slice(0, limits.maxPages);
  }

  const issues = await prisma.issue.findMany({
    where: { projectId, status: "ACTIVE" },
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
    take: limits.maxIssues,
  });

  const mayNeedCounts =
    crawlDeltaArraysTrimmed ||
    selectedPages.length >= limits.maxPages ||
    issues.length >= limits.maxIssues;

  let pagesTotalInDb: number | null = null;
  let issuesTotalInDb: number | null = null;
  if (mayNeedCounts) {
    [pagesTotalInDb, issuesTotalInDb] = await Promise.all([
      prisma.page.count({ where: { projectId } }),
      prisma.issue.count({ where: { projectId, status: "ACTIVE" } }),
    ]);
  }

  const promptTruncation =
    crawlDeltaArraysTrimmed ||
    (pagesTotalInDb != null && selectedPages.length < pagesTotalInDb) ||
    (issuesTotalInDb != null && issues.length < issuesTotalInDb)
      ? {
          pagesInPrompt: selectedPages.length,
          pagesTotalInDb,
          issuesInPrompt: issues.length,
          issuesTotalInDb,
          crawlDeltaArraysTrimmed,
        }
      : undefined;

  return {
    projectId: project.id,
    siteUrl: project.siteUrl,
    totalPages: project.totalPages,
    totalIssues: project.totalIssues,
    healthScore: project.healthScore,
    latestCrawlDelta,
    promptTruncation,
    pages: selectedPages.map((p) => ({
      url: p.url,
      statusCode: p.statusCode,
      title: p.title,
      metaDescription: p.metaDescription,
      h1: p.h1,
      wordCount: p.wordCount,
      responseTime: p.responseTime,
      pageSize: p.pageSize,
      canonicalUrl: p.canonicalUrl,
      metaRobots: p.metaRobots,
      jsonLd: p.jsonLd as unknown[] | null,
      internalLinks: p.internalLinks as Array<{ href: string; text: string }> | null,
      externalLinks: p.externalLinks as Array<{ href: string; text: string }> | null,
      images: p.images as Array<{
        src: string;
        alt: string;
        width?: number;
        height?: number;
      }> | null,
    })),
    issues: issues.map((i) => ({
      ruleId: i.ruleId,
      category: i.category,
      severity: i.severity,
      title: i.title,
      description: i.description,
      affectedUrl: i.affectedUrl,
      evidence: i.evidence as Record<string, unknown> | null,
    })),
  };
}

async function loadPreviousFindings(
  agentId: string,
  maxItems: number
): Promise<Array<{
  title: string;
  severity: string;
  type: string;
  status: string;
}>> {
  const lastRun = await prisma.agentRun.findFirst({
    where: { agentId, status: "SUCCESS" },
    orderBy: { createdAt: "desc" },
    select: {
      findings: {
        select: { title: true, severity: true, type: true },
        orderBy: { createdAt: "desc" },
        take: maxItems,
      },
    },
  });

  if (!lastRun) return [];

  return lastRun.findings.map((finding) => ({
    title: finding.title,
    severity: finding.severity,
    type: finding.type,
    status: "previous",
  }));
}

export async function resolveAgentRuntime(agentId: string, overrides: AgentRuntimeOverrides = {}) {
  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    include: {
      project: {
        include: {
          user: {
            select: {
              geminiApiKey: true,
              geminiModel: true,
              temperature: true,
            },
          },
        },
      },
    },
  });

  const toolLoopEnabled = isAgentToolLoopEnabled();
  const monolithLimits = getAgentContextLimits();
  const toolLimits = getAgentToolLimits();
  const skillIds = (agent.skills as string[]) || [];
  const [skills, context, previousFindings] = await Promise.all([
    resolveSkills(skillIds),
    toolLoopEnabled
      ? loadBootstrapProjectContext(agent.projectId)
      : loadProjectContext(agent.projectId, monolithLimits),
    loadPreviousFindings(
      agent.id,
      toolLoopEnabled ? toolLimits.maxPreviousFindingsBootstrap : monolithLimits.maxPreviousFindings
    ),
  ]);

  const prompt = overrides.prompt ?? agent.prompt;
  const contextConfig = normalizeAgentContextConfig(
    overrides.contextConfig ?? getAgentContextConfigFromTriggerConfig(agent.triggerConfig)
  );
  const promptMode = toolLoopEnabled ? ("tool_bootstrap" as const) : ("monolith" as const);
  const toolNames = toolLoopEnabled ? listAgentToolNamesForContext(contextConfig) : [];

  const sections = buildPromptSections({
    prompt,
    skills,
    context,
    previousFindings,
    contextConfig,
    promptMode,
  });
  const fullPrompt = assemblePrompt({
    prompt,
    skills,
    context,
    previousFindings,
    contextConfig,
    promptMode,
  });
  const modelRaw =
    overrides.geminiModel === undefined
      ? agent.geminiModel || agent.project.user.geminiModel
      : overrides.geminiModel || agent.project.user.geminiModel;
  const model =
    typeof modelRaw === "string" && modelRaw.trim().length > 0
      ? modelRaw.trim()
      : DEFAULT_GEMINI_MODEL;

  return {
    agent,
    prompt,
    skills,
    context,
    previousFindings,
    contextConfig,
    sections,
    fullPrompt,
    model,
    temperature: agent.project.user.temperature,
    toolLoopEnabled,
    toolNames,
    toolLimits,
  };
}

export function getAgentPromptPreviewPayload(runtime: Awaited<ReturnType<typeof resolveAgentRuntime>>): AgentPromptPreview {
  const fullPromptWithToolDocs =
    runtime.toolLoopEnabled
      ? `${runtime.fullPrompt}\n\n---\n\n${formatAgentToolsForPromptAppendix(runtime.contextConfig)}`
      : runtime.fullPrompt;

  return {
    fullPrompt: fullPromptWithToolDocs,
    sections: runtime.sections,
    contextConfig: runtime.contextConfig,
    toolLoopEnabled: runtime.toolLoopEnabled,
    toolNames: runtime.toolNames,
    summary: {
      siteUrl: runtime.context.siteUrl,
      totalPages: runtime.context.totalPages,
      totalIssues: runtime.context.totalIssues,
      healthScore: runtime.context.healthScore,
      previousFindingsCount: runtime.previousFindings.length,
      attachedSkillsCount: runtime.skills.length,
    },
  };
}
