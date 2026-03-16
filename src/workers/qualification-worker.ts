import { Worker } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
}) as any;


const qualificationWorker = new Worker(
  "qualification-queue",
  async (job) => {
    const { projectId } = job.data;
    console.log(
      `[Qualification Worker] Starting qualification for project ${projectId}`
    );

    const { runQualification } = await import(
      "@/services/qualification/pipeline"
    );

    const qualRunId = await runQualification(projectId);

    console.log(
      `[Qualification Worker] Qualification completed: ${qualRunId}`
    );

    // Enqueue notification
    const { notificationQueue } = await import("@/lib/queue");

    await notificationQueue.add("qualification-complete", {
      type: "CRAWL_COMPLETED",
      projectId,
      metadata: { qualificationRunId: qualRunId },
    });

    return { qualRunId };
  },
  {
    connection,
    concurrency: 2,
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 25 },
  }
);

qualificationWorker.on("completed", (job) => {
  console.log(`[Qualification Worker] Job ${job.id} completed`);
});

qualificationWorker.on("failed", (job, err) => {
  console.error(
    `[Qualification Worker] Job ${job?.id} failed:`,
    err.message
  );
});

export default qualificationWorker;
