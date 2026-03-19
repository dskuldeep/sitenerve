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
import { resolveSkills } from "./skill-resolver";

export interface AgentRuntimeOverrides {
  prompt?: string;
  geminiModel?: string | null;
  contextConfig?: AgentContextConfig;
}

export interface AgentPromptPreview {
  fullPrompt: string;
  sections: AgentPromptSection[];
  contextConfig: AgentContextConfig;
  summary: {
    siteUrl: string;
    totalPages: number;
    totalIssues: number;
    healthScore: number;
    previousFindingsCount: number;
    attachedSkillsCount: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getLatestCrawlDiffRecord(diff: unknown): Record<string, unknown> {
  return isRecord(diff) ? diff : {};
}

async function loadLatestCrawlDelta(projectId: string): Promise<ProjectContext["latestCrawlDelta"]> {
  const crawls = await prisma.crawl.findMany({
    where: { projectId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: {
      id: true,
      createdAt: true,
      completedAt: true,
      totalPages: true,
      newPages: true,
      removedPages: true,
      changedPages: true,
      diff: true,
    },
  });

  const latestCrawl = crawls[0];
  if (!latestCrawl) {
    return {
      available: false,
      crawlId: null,
      crawlCompletedAt: null,
      isInitialCrawl: false,
      urlDiff: {
        totalPages: 0,
        newPagesCount: 0,
        removedPagesCount: 0,
        changedPagesCount: 0,
        newPages: [],
        removedPages: [],
        changedPages: [],
      },
      issueDiff: {
        newIssuesCount: 0,
        resolvedIssuesCount: 0,
        persistedIssuesCount: 0,
        activeIssuesAfterCrawl: null,
        newIssues: [],
        resolvedIssues: [],
        persistedIssues: [],
      },
    };
  }

  const latestCrawlDiff = getLatestCrawlDiffRecord(latestCrawl.diff);
  const crawlDiff = isRecord(latestCrawlDiff.crawlDiff) ? latestCrawlDiff.crawlDiff : {};
  const postProcessing = isRecord(latestCrawlDiff.postProcessing)
    ? latestCrawlDiff.postProcessing
    : {};
  const changeWindowStart = latestCrawl.createdAt;
  const changeWindowEnd =
    typeof postProcessing.completedAt === "string"
      ? new Date(postProcessing.completedAt)
      : latestCrawl.completedAt || new Date();

  const [newIssues, resolvedIssues, persistedIssues] = await Promise.all([
    prisma.issue.findMany({
      where: {
        projectId,
        firstDetectedAt: {
          gte: changeWindowStart,
          lte: changeWindowEnd,
        },
      },
      select: {
        ruleId: true,
        severity: true,
        title: true,
        affectedUrl: true,
        firstDetectedAt: true,
      },
      orderBy: [{ severity: "desc" }, { firstDetectedAt: "desc" }],
      take: 100,
    }),
    prisma.issue.findMany({
      where: {
        projectId,
        resolvedAt: {
          gte: changeWindowStart,
          lte: changeWindowEnd,
        },
      },
      select: {
        ruleId: true,
        severity: true,
        title: true,
        affectedUrl: true,
        resolvedAt: true,
      },
      orderBy: [{ severity: "desc" }, { resolvedAt: "desc" }],
      take: 100,
    }),
    prisma.issue.findMany({
      where: {
        projectId,
        firstDetectedAt: { lt: changeWindowStart },
        lastDetectedAt: {
          gte: changeWindowStart,
          lte: changeWindowEnd,
        },
        status: { not: "RESOLVED" },
      },
      select: {
        ruleId: true,
        severity: true,
        title: true,
        affectedUrl: true,
        lastDetectedAt: true,
      },
      orderBy: [{ severity: "desc" }, { lastDetectedAt: "desc" }],
      take: 100,
    }),
  ]);

  return {
    available: true,
    crawlId: latestCrawl.id,
    crawlCompletedAt: latestCrawl.completedAt?.toISOString() || null,
    isInitialCrawl: crawls.length === 1,
    urlDiff: {
      totalPages: latestCrawl.totalPages,
      newPagesCount: latestCrawl.newPages,
      removedPagesCount: latestCrawl.removedPages,
      changedPagesCount: latestCrawl.changedPages,
      newPages: Array.isArray(crawlDiff.newPages)
        ? crawlDiff.newPages.filter((value): value is string => typeof value === "string")
        : [],
      removedPages: Array.isArray(crawlDiff.removedPages)
        ? crawlDiff.removedPages.filter((value): value is string => typeof value === "string")
        : [],
      changedPages: Array.isArray(crawlDiff.changedPages)
        ? crawlDiff.changedPages
            .filter(isRecord)
            .map((entry) => ({
              url: typeof entry.url === "string" ? entry.url : "",
              changes: Array.isArray(entry.changes)
                ? entry.changes.filter(isRecord).map((change) => ({
                    field: typeof change.field === "string" ? change.field : "unknown",
                    oldValue: change.oldValue ?? null,
                    newValue: change.newValue ?? null,
                  }))
                : [],
            }))
            .filter((entry) => entry.url.length > 0)
        : [],
    },
    issueDiff: {
      newIssuesCount:
        typeof postProcessing.newIssueCount === "number"
          ? postProcessing.newIssueCount
          : newIssues.length,
      resolvedIssuesCount: resolvedIssues.length,
      persistedIssuesCount: persistedIssues.length,
      activeIssuesAfterCrawl:
        typeof postProcessing.activeIssueCount === "number"
          ? postProcessing.activeIssueCount
          : null,
      newIssues: newIssues.map((issue) => ({
        ruleId: issue.ruleId,
        severity: issue.severity,
        title: issue.title,
        affectedUrl: issue.affectedUrl,
        firstDetectedAt: issue.firstDetectedAt.toISOString(),
      })),
      resolvedIssues: resolvedIssues.map((issue) => ({
        ruleId: issue.ruleId,
        severity: issue.severity,
        title: issue.title,
        affectedUrl: issue.affectedUrl,
        resolvedAt: issue.resolvedAt?.toISOString() || null,
      })),
      persistedIssues: persistedIssues.map((issue) => ({
        ruleId: issue.ruleId,
        severity: issue.severity,
        title: issue.title,
        affectedUrl: issue.affectedUrl,
        lastDetectedAt: issue.lastDetectedAt.toISOString(),
      })),
    },
  };
}

async function loadProjectContext(projectId: string): Promise<ProjectContext> {
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

  const pages = await prisma.page.findMany({
    where: { projectId },
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
  });

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
    orderBy: { severity: "desc" },
  });
  const latestCrawlDelta = await loadLatestCrawlDelta(projectId);

  return {
    projectId: project.id,
    siteUrl: project.siteUrl,
    totalPages: project.totalPages,
    totalIssues: project.totalIssues,
    healthScore: project.healthScore,
    latestCrawlDelta,
    pages: pages.map((p) => ({
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

async function loadPreviousFindings(agentId: string): Promise<Array<{
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

  const skillIds = (agent.skills as string[]) || [];
  const [skills, context, previousFindings] = await Promise.all([
    resolveSkills(skillIds),
    loadProjectContext(agent.projectId),
    loadPreviousFindings(agent.id),
  ]);

  const prompt = overrides.prompt ?? agent.prompt;
  const contextConfig = normalizeAgentContextConfig(
    overrides.contextConfig ?? getAgentContextConfigFromTriggerConfig(agent.triggerConfig)
  );
  const sections = buildPromptSections({
    prompt,
    skills,
    context,
    previousFindings,
    contextConfig,
  });
  const fullPrompt = assemblePrompt({
    prompt,
    skills,
    context,
    previousFindings,
    contextConfig,
  });
  const model =
    overrides.geminiModel === undefined
      ? agent.geminiModel || agent.project.user.geminiModel
      : overrides.geminiModel || agent.project.user.geminiModel;

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
  };
}

export function getAgentPromptPreviewPayload(runtime: Awaited<ReturnType<typeof resolveAgentRuntime>>): AgentPromptPreview {
  return {
    fullPrompt: runtime.fullPrompt,
    sections: runtime.sections,
    contextConfig: runtime.contextConfig,
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
