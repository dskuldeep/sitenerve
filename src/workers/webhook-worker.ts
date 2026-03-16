import { Worker } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
}) as any;


const webhookWorker = new Worker(
  "webhook-queue",
  async (job) => {
    const { projectId, event, payload } = job.data;
    console.log(
      `[Webhook Worker] Dispatching ${event} webhook for project ${projectId}`
    );

    const { dispatchWebhook } = await import(
      "@/services/webhooks/dispatcher"
    );

    const result = await dispatchWebhook({ projectId, event, payload });

    if (!result.success) {
      console.warn(
        `[Webhook Worker] Webhook delivery failed: ${result.errorMessage}`
      );

      // Enqueue a notification about the failed webhook
      const { notificationQueue } = await import("@/lib/queue");

      await notificationQueue.add("webhook-failed", {
        type: "WEBHOOK_FAILED",
        projectId,
        errorMessage: result.errorMessage,
        metadata: {
          deliveryId: result.deliveryId,
          event,
          statusCode: result.statusCode,
        },
      });
    }

    return result;
  },
  {
    connection,
    concurrency: 5,
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
  }
);

webhookWorker.on("completed", (job) => {
  console.log(`[Webhook Worker] Job ${job.id} completed`);
});

webhookWorker.on("failed", (job, err) => {
  console.error(`[Webhook Worker] Job ${job?.id} failed:`, err.message);
});

export default webhookWorker;
