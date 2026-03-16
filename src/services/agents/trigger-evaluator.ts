import { prisma } from "@/lib/prisma";

export async function evaluatePostCrawlTriggers(
  projectId: string,
  crawlId: string
): Promise<void> {
  const agents = await prisma.agent.findMany({
    where: {
      projectId,
      isActive: true,
      triggerType: "POST_CRAWL",
    },
    select: { id: true, name: true },
  });

  if (agents.length === 0) {
    console.log(`[TriggerEvaluator] No POST_CRAWL agents for project ${projectId}`);
    return;
  }

  const { agentQueue } = await import("@/lib/queue");

  for (const agent of agents) {
    console.log(`[TriggerEvaluator] Enqueuing POST_CRAWL agent: ${agent.name} (${agent.id})`);
    await agentQueue.add("agent-post-crawl", {
      agentId: agent.id,
      triggeredBy: "POST_CRAWL",
      crawlId,
    });
  }

  console.log(`[TriggerEvaluator] Enqueued ${agents.length} POST_CRAWL agents for project ${projectId}`);
}

export async function evaluateOnNewIssuesTriggers(
  projectId: string,
  newIssueCount: number
): Promise<void> {
  if (newIssueCount === 0) return;

  const agents = await prisma.agent.findMany({
    where: {
      projectId,
      isActive: true,
      triggerType: "ON_NEW_ISSUES",
    },
    select: { id: true, name: true, triggerConfig: true },
  });

  if (agents.length === 0) return;

  const { agentQueue } = await import("@/lib/queue");

  for (const agent of agents) {
    const config = agent.triggerConfig as { minIssues?: number } | null;
    const threshold = config?.minIssues ?? 1;

    if (newIssueCount >= threshold) {
      console.log(`[TriggerEvaluator] Enqueuing ON_NEW_ISSUES agent: ${agent.name} (${newIssueCount} new issues >= threshold ${threshold})`);
      await agentQueue.add("agent-on-new-issues", {
        agentId: agent.id,
        triggeredBy: "ON_NEW_ISSUES",
        newIssueCount,
      });
    }
  }
}

export async function evaluateOnNewPagesTriggers(
  projectId: string,
  newPageCount: number
): Promise<void> {
  if (newPageCount === 0) return;

  const agents = await prisma.agent.findMany({
    where: {
      projectId,
      isActive: true,
      triggerType: "ON_NEW_PAGES",
    },
    select: { id: true, name: true, triggerConfig: true },
  });

  if (agents.length === 0) return;

  const { agentQueue } = await import("@/lib/queue");

  for (const agent of agents) {
    const config = agent.triggerConfig as { minPages?: number } | null;
    const threshold = config?.minPages ?? 1;

    if (newPageCount >= threshold) {
      console.log(`[TriggerEvaluator] Enqueuing ON_NEW_PAGES agent: ${agent.name} (${newPageCount} new pages >= threshold ${threshold})`);
      await agentQueue.add("agent-on-new-pages", {
        agentId: agent.id,
        triggeredBy: "ON_NEW_PAGES",
        newPageCount,
      });
    }
  }
}
