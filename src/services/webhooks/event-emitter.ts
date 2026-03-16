import { prisma } from "@/lib/prisma";

export async function enqueueWebhookIfConfigured(
  projectId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      webhookUrl: true,
      webhookEvents: true,
    },
  });

  if (!project?.webhookUrl) return false;

  if (project.webhookEvents) {
    const enabledEvents = project.webhookEvents as string[];
    if (Array.isArray(enabledEvents) && enabledEvents.length > 0 && !enabledEvents.includes(event)) {
      return false;
    }
  }

  try {
    const { webhookQueue } = await import("@/lib/queue");
    await webhookQueue.add(`webhook-${event}`, {
      projectId,
      event,
      payload,
    });
    console.log(`[WebhookEmitter] Enqueued ${event} webhook for project ${projectId}`);
    return true;
  } catch (error) {
    console.error(`[WebhookEmitter] Failed to enqueue webhook:`, error);
    return false;
  }
}
