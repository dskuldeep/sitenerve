import { Worker, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
}) as unknown as ConnectionOptions;


const agentWorker = new Worker(
  "agent-queue",
  async (job) => {
    const { agentId, triggeredBy, runtimeOverrides } = job.data;
    const triggerLabel = triggeredBy || "MANUAL";
    console.log(`[Agent Worker] Starting agent execution for ${agentId} (trigger: ${triggerLabel})`);

    const { executeAgent } = await import("@/services/agents/executor");

    const runId = await executeAgent(agentId, runtimeOverrides);

    console.log(`[Agent Worker] Agent execution completed, run: ${runId}`);

    // Enqueue notification for agent completion
    const { notificationQueue } = await import("@/lib/queue");

    await notificationQueue.add("agent-finding", {
      type: "AGENT_FINDING",
      agentId,
      runId,
    });

    // Dispatch webhook for agent completion
    try {
      const { prisma } = await import("@/lib/prisma");
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { projectId: true, name: true },
      });
      if (agent) {
        const run = await prisma.agentRun.findUnique({
          where: { id: runId },
          select: { status: true, duration: true, findings: { select: { severity: true, type: true, title: true } } },
        });
        const { enqueueWebhookIfConfigured } = await import("@/services/webhooks/event-emitter");
        await enqueueWebhookIfConfigured(agent.projectId, "agent.completed", {
          agentId,
          agentName: agent.name,
          runId,
          triggeredBy: triggerLabel,
          status: run?.status,
          duration: run?.duration,
          findingCount: run?.findings.length ?? 0,
          findings: run?.findings.slice(0, 20) ?? [],
        });
      }
    } catch (e) {
      console.error(`[Agent Worker] Webhook dispatch failed:`, e);
    }

    return { runId };
  },
  {
    connection,
    concurrency: 3,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  }
);

agentWorker.on("completed", (job) => {
  console.log(`[Agent Worker] Job ${job.id} completed`);
});

agentWorker.on("failed", (job, err) => {
  console.error(`[Agent Worker] Job ${job?.id} failed:`, err.message);
});

export default agentWorker;
