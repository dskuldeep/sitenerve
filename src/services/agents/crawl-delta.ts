import { prisma } from "@/lib/prisma";
import type { ProjectContext } from "./prompt-assembler";

export interface CrawlDeltaQueryLimits {
  maxDeltaNewUrls: number;
  maxDeltaRemovedUrls: number;
  maxDeltaChangedPages: number;
  maxDeltaIssueRowsPerBucket: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getLatestCrawlDiffRecord(diff: unknown): Record<string, unknown> {
  return isRecord(diff) ? diff : {};
}

const emptyDelta = (): ProjectContext["latestCrawlDelta"] => ({
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
});

/** Counts only — URLs/issue rows loaded via `get_crawl_delta` tool. */
export async function loadLatestCrawlDeltaSummary(
  projectId: string
): Promise<ProjectContext["latestCrawlDelta"]> {
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
    return emptyDelta();
  }

  const latestCrawlDiff = getLatestCrawlDiffRecord(latestCrawl.diff);
  const postProcessing = isRecord(latestCrawlDiff.postProcessing)
    ? latestCrawlDiff.postProcessing
    : {};

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
      newPages: [],
      removedPages: [],
      changedPages: [],
    },
    issueDiff: {
      newIssuesCount:
        typeof postProcessing.newIssueCount === "number" ? postProcessing.newIssueCount : 0,
      // Detailed resolved/persisted counts require DB window queries — use get_crawl_delta.
      resolvedIssuesCount: 0,
      persistedIssuesCount: 0,
      activeIssuesAfterCrawl:
        typeof postProcessing.activeIssueCount === "number"
          ? postProcessing.activeIssueCount
          : null,
      newIssues: [],
      resolvedIssues: [],
      persistedIssues: [],
    },
  };
}

export async function loadLatestCrawlDelta(
  projectId: string,
  limits: CrawlDeltaQueryLimits
): Promise<{
  delta: ProjectContext["latestCrawlDelta"];
  crawlDeltaArraysTrimmed: boolean;
}> {
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
    return { delta: emptyDelta(), crawlDeltaArraysTrimmed: false };
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
      take: limits.maxDeltaIssueRowsPerBucket,
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
      take: limits.maxDeltaIssueRowsPerBucket,
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
      take: limits.maxDeltaIssueRowsPerBucket,
    }),
  ]);

  const newPagesFull = Array.isArray(crawlDiff.newPages)
    ? crawlDiff.newPages.filter((value): value is string => typeof value === "string")
    : [];
  const removedPagesFull = Array.isArray(crawlDiff.removedPages)
    ? crawlDiff.removedPages.filter((value): value is string => typeof value === "string")
    : [];
  const changedPagesFull = Array.isArray(crawlDiff.changedPages)
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
    : [];

  const newPages = newPagesFull.slice(0, limits.maxDeltaNewUrls);
  const removedPages = removedPagesFull.slice(0, limits.maxDeltaRemovedUrls);
  const changedPages = changedPagesFull.slice(0, limits.maxDeltaChangedPages);

  const crawlDeltaArraysTrimmed =
    newPagesFull.length > newPages.length ||
    removedPagesFull.length > removedPages.length ||
    changedPagesFull.length > changedPages.length;

  return {
    delta: {
      available: true,
      crawlId: latestCrawl.id,
      crawlCompletedAt: latestCrawl.completedAt?.toISOString() || null,
      isInitialCrawl: crawls.length === 1,
      urlDiff: {
        totalPages: latestCrawl.totalPages,
        newPagesCount: latestCrawl.newPages,
        removedPagesCount: latestCrawl.removedPages,
        changedPagesCount: latestCrawl.changedPages,
        newPages,
        removedPages,
        changedPages,
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
    },
    crawlDeltaArraysTrimmed,
  };
}

// --- Paginated crawl delta for agent tools (avoid huge single responses) ---

export type CrawlDeltaIssueBucket = "new" | "resolved" | "persisted";

export interface CrawlDeltaWindowContext {
  projectId: string;
  crawlId: string;
  crawlCompletedAt: string | null;
  crawlCreatedAt: Date;
  isInitialCrawl: boolean;
  changeWindowStart: Date;
  changeWindowEnd: Date;
  postProcessing: Record<string, unknown>;
  totalPages: number;
  newPagesCount: number;
  removedPagesCount: number;
  changedPagesCount: number;
  newPagesUrls: string[];
  removedPagesUrls: string[];
  changedPagesEntries: Array<{
    url: string;
    changes: Array<{ field: string; oldValue: unknown; newValue: unknown }>;
  }>;
}

export async function loadCrawlDeltaWindowContext(
  projectId: string
): Promise<CrawlDeltaWindowContext | null> {
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
  if (!latestCrawl) return null;

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

  const newPagesFull = Array.isArray(crawlDiff.newPages)
    ? crawlDiff.newPages.filter((value): value is string => typeof value === "string")
    : [];
  const removedPagesFull = Array.isArray(crawlDiff.removedPages)
    ? crawlDiff.removedPages.filter((value): value is string => typeof value === "string")
    : [];
  const changedPagesFull = Array.isArray(crawlDiff.changedPages)
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
    : [];

  return {
    projectId,
    crawlId: latestCrawl.id,
    crawlCompletedAt: latestCrawl.completedAt?.toISOString() || null,
    crawlCreatedAt: latestCrawl.createdAt,
    isInitialCrawl: crawls.length === 1,
    changeWindowStart,
    changeWindowEnd,
    postProcessing,
    totalPages: latestCrawl.totalPages,
    newPagesCount: latestCrawl.newPages,
    removedPagesCount: latestCrawl.removedPages,
    changedPagesCount: latestCrawl.changedPages,
    newPagesUrls: newPagesFull,
    removedPagesUrls: removedPagesFull,
    changedPagesEntries: changedPagesFull,
  };
}

export async function countCrawlDeltaIssuesInBucket(
  projectId: string,
  ctx: CrawlDeltaWindowContext,
  bucket: CrawlDeltaIssueBucket
): Promise<number> {
  switch (bucket) {
    case "new":
      return prisma.issue.count({
        where: {
          projectId,
          firstDetectedAt: { gte: ctx.changeWindowStart, lte: ctx.changeWindowEnd },
        },
      });
    case "resolved":
      return prisma.issue.count({
        where: {
          projectId,
          resolvedAt: { gte: ctx.changeWindowStart, lte: ctx.changeWindowEnd },
        },
      });
    case "persisted":
      return prisma.issue.count({
        where: {
          projectId,
          firstDetectedAt: { lt: ctx.changeWindowStart },
          lastDetectedAt: { gte: ctx.changeWindowStart, lte: ctx.changeWindowEnd },
          status: { not: "RESOLVED" },
        },
      });
    default:
      return 0;
  }
}

export async function listCrawlDeltaIssuesInBucket(
  projectId: string,
  ctx: CrawlDeltaWindowContext,
  bucket: CrawlDeltaIssueBucket,
  skip: number,
  take: number
): Promise<
  Array<{
    ruleId: string;
    severity: string;
    title: string;
    affectedUrl: string;
    firstDetectedAt?: string;
    resolvedAt?: string | null;
    lastDetectedAt?: string;
  }>
> {
  switch (bucket) {
    case "new": {
      const rows = await prisma.issue.findMany({
        where: {
          projectId,
          firstDetectedAt: { gte: ctx.changeWindowStart, lte: ctx.changeWindowEnd },
        },
        select: {
          ruleId: true,
          severity: true,
          title: true,
          affectedUrl: true,
          firstDetectedAt: true,
        },
        orderBy: [{ severity: "desc" }, { firstDetectedAt: "desc" }],
        skip,
        take,
      });
      return rows.map((issue) => ({
        ruleId: issue.ruleId,
        severity: issue.severity,
        title: issue.title,
        affectedUrl: issue.affectedUrl,
        firstDetectedAt: issue.firstDetectedAt.toISOString(),
      }));
    }
    case "resolved": {
      const rows = await prisma.issue.findMany({
        where: {
          projectId,
          resolvedAt: { gte: ctx.changeWindowStart, lte: ctx.changeWindowEnd },
        },
        select: {
          ruleId: true,
          severity: true,
          title: true,
          affectedUrl: true,
          resolvedAt: true,
        },
        orderBy: [{ severity: "desc" }, { resolvedAt: "desc" }],
        skip,
        take,
      });
      return rows.map((issue) => ({
        ruleId: issue.ruleId,
        severity: issue.severity,
        title: issue.title,
        affectedUrl: issue.affectedUrl,
        resolvedAt: issue.resolvedAt?.toISOString() || null,
      }));
    }
    case "persisted": {
      const rows = await prisma.issue.findMany({
        where: {
          projectId,
          firstDetectedAt: { lt: ctx.changeWindowStart },
          lastDetectedAt: { gte: ctx.changeWindowStart, lte: ctx.changeWindowEnd },
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
        skip,
        take,
      });
      return rows.map((issue) => ({
        ruleId: issue.ruleId,
        severity: issue.severity,
        title: issue.title,
        affectedUrl: issue.affectedUrl,
        lastDetectedAt: issue.lastDetectedAt.toISOString(),
      }));
    }
    default:
      return [];
  }
}
