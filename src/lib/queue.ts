import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import { redis } from "./redis";

const connection = redis as unknown as ConnectionOptions;

export const crawlQueue = new Queue("crawl-queue", { connection });
export const postCrawlQueue = new Queue("post-crawl-queue", { connection });
export const agentQueue = new Queue("agent-queue", { connection });
export const qualificationQueue = new Queue("qualification-queue", { connection });
export const webhookQueue = new Queue("webhook-queue", { connection });
export const notificationQueue = new Queue("notification-queue", { connection });
