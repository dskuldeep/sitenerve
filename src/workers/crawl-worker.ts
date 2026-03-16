import { Worker } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@/lib/prisma";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
}) as unknown as ConnectionOptions;


const crawlWorker = new Worker(
  "crawl-queue",
  async (job) => {
    const { projectId, siteUrl, isInitial, maxPages } = job.data;
    console.log(`[Crawl Worker] Starting crawl for project ${projectId}: ${siteUrl}`);

    // Dynamic import to avoid bundling issues
    const { runCrawl } = await import("@/services/crawler/crawler");

    const crawlId = await runCrawl({
      projectId,
      siteUrl,
      isInitial,
      maxPages: typeof maxPages === "number" ? maxPages : undefined,
    });

    const crawl = await prisma.crawl.findUnique({
      where: { id: crawlId },
      select: { status: true },
    });

    if (!crawl || crawl.status !== "COMPLETED") {
      console.log(
        `[Crawl Worker] Crawl ${crawlId} finished with status ${crawl?.status ?? "UNKNOWN"}; skipping downstream jobs`
      );
      return { crawlId, status: crawl?.status ?? "UNKNOWN" };
    }

    console.log(`[Crawl Worker] Crawl completed: ${crawlId}. Queueing post-crawl pipeline...`);
    try {
      const { postCrawlQueue } = await import("@/lib/queue");
      await postCrawlQueue.add(
        "post-crawl",
        {
          projectId,
          crawlId,
        },
        {
          jobId: `post-crawl-${crawlId}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        }
      );
    } catch (e) {
      console.error(`[Crawl Worker] Failed to enqueue post-crawl pipeline:`, e);
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "ERROR" },
      });
      throw e;
    }

    console.log(`[Crawl Worker] Crawl stage finished for ${crawlId}. Post-crawl pipeline queued.`);
    return { crawlId };
  },
  {
    connection,
    // Crawls can run for a long time on large sites; avoid premature stall failures.
    concurrency: 2,
    lockDuration: 60 * 60 * 1000,
    maxStalledCount: 2,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  }
);

crawlWorker.on("completed", (job) => {
  console.log(`[Crawl Worker] Job ${job.id} completed`);
});

crawlWorker.on("failed", (job, err) => {
  console.error(`[Crawl Worker] Job ${job?.id} failed:`, err.message);
  const projectId = job?.data?.projectId as string | undefined;
  if (!projectId) return;
  void prisma.project
    .update({
      where: { id: projectId },
      data: { status: "ERROR" },
    })
    .catch((updateError) => {
      console.error(
        `[Crawl Worker] Failed to mark project ${projectId} ERROR after worker failure:`,
        updateError
      );
    });
});

export default crawlWorker;
