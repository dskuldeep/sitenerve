import { Queue, Worker } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
}) as unknown as ConnectionOptions;
const postCrawlQueue = new Queue("post-crawl-queue", { connection });
const staleJobRecoveryThresholdMs = 5 * 60 * 1000;

type PostProcessingPatch = Record<string, unknown>;

function mergePostProcessingIntoDiff(
  diff: Prisma.JsonValue | null,
  patch: PostProcessingPatch
): Prisma.InputJsonValue {
  const base =
    diff && typeof diff === "object" && !Array.isArray(diff)
      ? ({ ...(diff as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const existingPostProcessing =
    base.postProcessing && typeof base.postProcessing === "object" && !Array.isArray(base.postProcessing)
      ? (base.postProcessing as Record<string, unknown>)
      : {};

  return {
    ...base,
    postProcessing: {
      ...existingPostProcessing,
      ...patch,
    },
  } as Prisma.InputJsonValue;
}

async function recoverStaleActivePostCrawlJobs(): Promise<void> {
  try {
    const activeJobs = await postCrawlQueue.getJobs(["active"]);
    if (activeJobs.length === 0) return;

    const rawRedis = connection as unknown as IORedis;
    const now = Date.now();

    for (const job of activeJobs) {
      const processedOn = job.processedOn ?? 0;
      if (processedOn === 0 || now - processedOn < staleJobRecoveryThresholdMs) {
        continue;
      }

      const lockKey = `bull:post-crawl-queue:${job.id}:lock`;
      const lockTtlMs = await rawRedis.pttl(lockKey);

      if (lockTtlMs > 0) {
        await rawRedis.del(lockKey);
      }

      const attempts =
        typeof job.opts.attempts === "number" && job.opts.attempts > 0 ? job.opts.attempts : 3;
      const backoff = job.opts.backoff ?? { type: "exponential" as const, delay: 5000 };

      await job.remove();
      await postCrawlQueue.add(job.name, job.data, {
        jobId: String(job.id),
        attempts,
        backoff,
        removeOnComplete: job.opts.removeOnComplete,
        removeOnFail: job.opts.removeOnFail,
      });

      console.warn(
        `[Post-Crawl Worker] Recovered stale active job ${job.id} after ${Math.round(
          (now - processedOn) / 1000
        )}s`
      );
    }
  } catch (error) {
    console.error("[Post-Crawl Worker] Failed to recover stale active jobs:", error);
  }
}

const postCrawlWorker = new Worker(
  "post-crawl-queue",
  async (job) => {
    const { projectId, crawlId } = job.data as { projectId: string; crawlId: string };
    console.log(`[Post-Crawl Worker] Starting downstream pipeline for crawl ${crawlId}`);

    const crawl = await prisma.crawl.findUnique({
      where: { id: crawlId },
      select: {
        id: true,
        projectId: true,
        status: true,
        diff: true,
        totalPages: true,
        newPages: true,
        removedPages: true,
        changedPages: true,
        errorCount: true,
      },
    });

    if (!crawl || crawl.projectId !== projectId) {
      console.warn(`[Post-Crawl Worker] Crawl ${crawlId} not found for project ${projectId}`);
      return { skipped: true, reason: "crawl-not-found" };
    }

    if (crawl.status !== "COMPLETED") {
      console.warn(
        `[Post-Crawl Worker] Crawl ${crawlId} is ${crawl.status}; skipping downstream pipeline`
      );
      return { skipped: true, reason: `crawl-${crawl.status.toLowerCase()}` };
    }

    const existingPostProcessing =
      crawl.diff && typeof crawl.diff === "object" && !Array.isArray(crawl.diff)
        ? ((crawl.diff as Record<string, unknown>).postProcessing as Record<string, unknown> | undefined)
        : undefined;
    if (existingPostProcessing?.completedAt) {
      console.log(`[Post-Crawl Worker] Crawl ${crawlId} already post-processed; skipping`);
      return { skipped: true, reason: "already-processed" };
    }

    await prisma.crawl.update({
      where: { id: crawlId },
      data: {
        diff: mergePostProcessingIntoDiff(crawl.diff, {
          startedAt: new Date().toISOString(),
          status: "RUNNING",
        }),
      },
    });

    await prisma.project.update({
      where: { id: projectId },
      data: { status: "CRAWLING" },
    });

    const stepStatus: Record<string, { status: "SUCCESS" | "FAILED"; error?: string }> = {};
    let auditResult:
      | {
          issueCount: number;
          healthScore: number;
          previousHealthScore: number | null;
          activeIssueCount: number;
        }
      | null = null;

    try {
      try {
        console.log(`[Post-Crawl Worker] Running audit for project ${projectId}`);
        const { runAudit } = await import("./audit-worker");
        auditResult = await runAudit(projectId, crawlId);
        stepStatus.audit = { status: "SUCCESS" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown audit error";
        stepStatus.audit = { status: "FAILED", error: message };
        console.error(`[Post-Crawl Worker] Audit failed: ${message}`);
      }

      try {
        console.log(`[Post-Crawl Worker] Extracting keywords for project ${projectId}`);
        const { extractAndScoreKeywords } = await import("./keyword-worker");
        await extractAndScoreKeywords(projectId);
        stepStatus.keywords = { status: "SUCCESS" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown keyword error";
        stepStatus.keywords = { status: "FAILED", error: message };
        console.error(`[Post-Crawl Worker] Keyword extraction failed: ${message}`);
      }

      try {
        console.log(`[Post-Crawl Worker] Building site graph for project ${projectId}`);
        const { buildGraph } = await import("@/services/graph/builder");
        await buildGraph(projectId);
        stepStatus.graph = { status: "SUCCESS" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown graph error";
        stepStatus.graph = { status: "FAILED", error: message };
        console.error(`[Post-Crawl Worker] Graph build failed: ${message}`);
      }

      try {
        console.log(`[Post-Crawl Worker] Evaluating agent triggers for project ${projectId}`);
        const {
          evaluatePostCrawlTriggers,
          evaluateOnNewIssuesTriggers,
          evaluateOnNewPagesTriggers,
        } = await import("@/services/agents/trigger-evaluator");
        await evaluatePostCrawlTriggers(projectId, crawlId);
        await evaluateOnNewIssuesTriggers(projectId, auditResult?.issueCount ?? 0);
        await evaluateOnNewPagesTriggers(projectId, crawl.newPages);
        stepStatus.agents = { status: "SUCCESS" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown trigger error";
        stepStatus.agents = { status: "FAILED", error: message };
        console.error(`[Post-Crawl Worker] Agent trigger evaluation failed: ${message}`);
      }

      try {
        console.log(`[Post-Crawl Worker] Sending project webhook events for project ${projectId}`);
        const { enqueueWebhookIfConfigured } = await import("@/services/webhooks/event-emitter");
        await enqueueWebhookIfConfigured(projectId, "crawl.completed", {
          crawlId,
          totalPages: crawl.totalPages,
          newPages: crawl.newPages,
          removedPages: crawl.removedPages,
          changedPages: crawl.changedPages,
          errorCount: crawl.errorCount,
          healthScore: auditResult?.healthScore ?? null,
          newIssueCount: auditResult?.issueCount ?? null,
        });

        if (auditResult) {
          await enqueueWebhookIfConfigured(projectId, "audit.completed", {
            crawlId,
            healthScore: auditResult.healthScore,
            previousHealthScore: auditResult.previousHealthScore,
            activeIssueCount: auditResult.activeIssueCount,
            newIssueCount: auditResult.issueCount,
          });

          if (auditResult.issueCount > 0) {
            await enqueueWebhookIfConfigured(projectId, "issues.new", {
              crawlId,
              newIssueCount: auditResult.issueCount,
              activeIssueCount: auditResult.activeIssueCount,
              healthScore: auditResult.healthScore,
            });
          }

          if (
            auditResult.previousHealthScore !== null &&
            auditResult.previousHealthScore !== auditResult.healthScore
          ) {
            await enqueueWebhookIfConfigured(projectId, "health.changed", {
              crawlId,
              previousHealthScore: auditResult.previousHealthScore,
              healthScore: auditResult.healthScore,
              delta: auditResult.healthScore - auditResult.previousHealthScore,
            });
          }
        }
        stepStatus.webhook = { status: "SUCCESS" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown webhook error";
        stepStatus.webhook = { status: "FAILED", error: message };
        console.error(`[Post-Crawl Worker] Webhook dispatch failed: ${message}`);
      }
    } finally {
      const refreshedCrawl = await prisma.crawl.findUnique({
        where: { id: crawlId },
        select: { diff: true },
      });

      await prisma.crawl.update({
        where: { id: crawlId },
        data: {
          diff: mergePostProcessingIntoDiff(refreshedCrawl?.diff ?? crawl.diff, {
            status: "COMPLETED",
            completedAt: new Date().toISOString(),
            steps: stepStatus,
            healthScore: auditResult?.healthScore ?? null,
            newIssueCount: auditResult?.issueCount ?? null,
          }),
        },
      });

      await prisma.project.update({
        where: { id: projectId },
        data: { status: "ACTIVE" },
      });
    }

    console.log(`[Post-Crawl Worker] Completed downstream pipeline for crawl ${crawlId}`);
    return {
      crawlId,
      auditResult,
      stepStatus,
    };
  },
  {
    connection,
    // Post-crawl work is CPU-heavy (audit/graph/keywords). Keep concurrency low to avoid
    // lock-renew starvation and stalls on large crawls.
    concurrency: 1,
    lockDuration: 60 * 60 * 1000,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  }
);

void recoverStaleActivePostCrawlJobs();

postCrawlWorker.on("completed", (job) => {
  console.log(`[Post-Crawl Worker] Job ${job.id} completed`);
});

postCrawlWorker.on("failed", (job, err) => {
  console.error(`[Post-Crawl Worker] Job ${job?.id} failed:`, err.message);
  const projectId = job?.data?.projectId as string | undefined;
  if (!projectId) return;
  void prisma.project
    .update({
      where: { id: projectId },
      data: { status: "ERROR" },
    })
    .catch((updateError) => {
      console.error(
        `[Post-Crawl Worker] Failed to mark project ${projectId} ERROR after worker failure:`,
        updateError
      );
    });
});

export default postCrawlWorker;
