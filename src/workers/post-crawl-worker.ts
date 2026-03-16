import { Worker } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
}) as unknown as ConnectionOptions;

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
    let auditResult: { issueCount: number; healthScore: number } | null = null;

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
        const { evaluatePostCrawlTriggers } = await import("@/services/agents/trigger-evaluator");
        await evaluatePostCrawlTriggers(projectId, crawlId);
        stepStatus.agents = { status: "SUCCESS" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown trigger error";
        stepStatus.agents = { status: "FAILED", error: message };
        console.error(`[Post-Crawl Worker] Agent trigger evaluation failed: ${message}`);
      }

      try {
        console.log(`[Post-Crawl Worker] Sending crawl-completed webhook for project ${projectId}`);
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
