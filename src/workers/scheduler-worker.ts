import { prisma } from "@/lib/prisma";
import { agentQueue, crawlQueue, postCrawlQueue } from "@/lib/queue";
import { getPreviousScheduledAt } from "@/lib/scheduler";

const SCHEDULED_QUEUE_STATES = ["waiting", "delayed", "prioritized", "active"] as const;
const SCHEDULER_INTERVAL_MS = 60_000;
let isTickInProgress = false;

type QueueKey = "projectId" | "agentId";

function normalizeScheduledAgentCron(triggerConfig: unknown): string | null {
  if (!triggerConfig || typeof triggerConfig !== "object" || Array.isArray(triggerConfig)) {
    return null;
  }

  const config = triggerConfig as Record<string, unknown>;
  const cron =
    typeof config.cron === "string"
      ? config.cron.trim()
      : typeof config.schedule === "string"
        ? config.schedule.trim()
        : "";

  return cron.length > 0 ? cron : null;
}

function toSlotKey(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function collectQueuedEntityIds(
  queue: typeof crawlQueue | typeof agentQueue,
  key: QueueKey
): Promise<Set<string>> {
  const jobs = await queue.getJobs([...SCHEDULED_QUEUE_STATES]);
  const ids = new Set<string>();

  for (const job of jobs) {
    const value = job.data?.[key];
    if (typeof value === "string" && value.length > 0) {
      ids.add(value);
    }
  }

  return ids;
}

async function enqueueDueScheduledCrawls(now: Date): Promise<number> {
  const [queuedProjectIds, projects] = await Promise.all([
    collectQueuedEntityIds(crawlQueue, "projectId"),
    prisma.project.findMany({
      where: {
        crawlSchedule: { not: "manual" },
        status: { not: "PAUSED" },
      },
      select: {
        id: true,
        siteUrl: true,
        maxCrawlPages: true,
        crawlSchedule: true,
        status: true,
        createdAt: true,
        crawls: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
  ]);

  let enqueued = 0;

  for (const project of projects) {
    if (project.status === "CRAWLING" || queuedProjectIds.has(project.id)) {
      continue;
    }

    const previousScheduledAt = getPreviousScheduledAt(project.crawlSchedule, now);
    if (!previousScheduledAt) continue;
    if (previousScheduledAt < project.createdAt) continue;

    const lastCrawlCreatedAt = project.crawls[0]?.createdAt ?? null;
    if (lastCrawlCreatedAt && lastCrawlCreatedAt >= previousScheduledAt) {
      continue;
    }

    await crawlQueue.add(
      "scheduled-crawl",
      {
        projectId: project.id,
        siteUrl: project.siteUrl,
        maxPages: project.maxCrawlPages,
        isInitial: false,
        triggeredBy: "SCHEDULED",
        scheduledFor: previousScheduledAt.toISOString(),
      },
      {
        jobId: `scheduled-crawl-${project.id}-${toSlotKey(previousScheduledAt)}`,
      }
    );

    enqueued += 1;
  }

  return enqueued;
}

async function enqueueDueScheduledAgents(now: Date): Promise<number> {
  const [queuedAgentIds, agents] = await Promise.all([
    collectQueuedEntityIds(agentQueue, "agentId"),
    prisma.agent.findMany({
      where: {
        isActive: true,
        triggerType: "SCHEDULED",
      },
      select: {
        id: true,
        projectId: true,
        name: true,
        triggerConfig: true,
        createdAt: true,
        lastRunAt: true,
        lastRunStatus: true,
      },
    }),
  ]);

  let enqueued = 0;

  for (const agent of agents) {
    if (agent.lastRunStatus === "RUNNING" || queuedAgentIds.has(agent.id)) {
      continue;
    }

    const cron = normalizeScheduledAgentCron(agent.triggerConfig);
    if (!cron) continue;

    const previousScheduledAt = getPreviousScheduledAt(cron, now);
    if (!previousScheduledAt) continue;
    if (previousScheduledAt < agent.createdAt) continue;
    if (agent.lastRunAt && agent.lastRunAt >= previousScheduledAt) {
      continue;
    }

    await agentQueue.add(
      "agent-scheduled",
      {
        agentId: agent.id,
        projectId: agent.projectId,
        triggeredBy: "SCHEDULED",
        scheduledFor: previousScheduledAt.toISOString(),
      },
      {
        jobId: `scheduled-agent-${agent.id}-${toSlotKey(previousScheduledAt)}`,
      }
    );

    enqueued += 1;
  }

  return enqueued;
}

async function shouldDeferScheduledCrawls(): Promise<boolean> {
  const [activeCrawls, activePostCrawls] = await Promise.all([
    crawlQueue.getActiveCount(),
    postCrawlQueue.getActiveCount(),
  ]);

  return activeCrawls > 0 || activePostCrawls > 0;
}

export async function runSchedulerTick(reason: "startup" | "interval" = "interval"): Promise<void> {
  if (isTickInProgress) return;
  isTickInProgress = true;

  try {
    const now = new Date();
    const deferScheduledCrawls = await shouldDeferScheduledCrawls();

    const [scheduledCrawls, scheduledAgents] = await Promise.all([
      deferScheduledCrawls ? Promise.resolve(0) : enqueueDueScheduledCrawls(now),
      enqueueDueScheduledAgents(now),
    ]);

    if (deferScheduledCrawls && reason === "interval") {
      console.log("[Scheduler] Deferring scheduled crawl enqueue while crawl/post-crawl work is active");
    }

    if (scheduledCrawls > 0 || scheduledAgents > 0) {
      console.log(
        `[Scheduler] ${reason} tick enqueued ${scheduledCrawls} crawl job(s) and ${scheduledAgents} agent job(s)`
      );
    }
  } catch (error) {
    console.error("[Scheduler] Tick failed:", error);
  } finally {
    isTickInProgress = false;
  }
}

void runSchedulerTick("startup");
setInterval(() => {
  void runSchedulerTick("interval");
}, SCHEDULER_INTERVAL_MS);
