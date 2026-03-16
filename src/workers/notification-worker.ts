import { Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "@/lib/prisma";
import type { NotificationType, IssueSeverity } from "@prisma/client";

interface NotificationJobData {
  type: NotificationType;
  projectId?: string;
  userId?: string;
  title?: string;
  body?: string;
  severity?: IssueSeverity;
  metadata?: Record<string, unknown>;
  // Context-specific fields
  agentId?: string;
  runId?: string;
  crawlId?: string;
  issueId?: string;
  pageId?: string;
  pageUrl?: string;
  errorMessage?: string;
}

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
}) as any;


const notificationWorker = new Worker(
  "notification-queue",
  async (job) => {
    const data = job.data as NotificationJobData;
    console.log(`[Notification Worker] Processing ${data.type} notification`);

    const { generateNotification } = await import(
      "@/services/notifications/generator"
    );

    await generateNotification(data);

    console.log(`[Notification Worker] Notification created for ${data.type}`);
  },
  {
    connection,
    concurrency: 10,
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 100 },
  }
);

notificationWorker.on("completed", (job) => {
  console.log(`[Notification Worker] Job ${job.id} completed`);
});

notificationWorker.on("failed", (job, err) => {
  console.error(`[Notification Worker] Job ${job?.id} failed:`, err.message);
});

export default notificationWorker;
