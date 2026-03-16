import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; agentId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { projectId, agentId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, projectId },
  });
  if (!agent) {
    return NextResponse.json({ success: false, error: "Agent not found" }, { status: 404 });
  }

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      lastRunAt: new Date(),
      lastRunStatus: "RUNNING",
    },
  });

  try {
    const { agentQueue } = await import("@/lib/queue");
    await agentQueue.add("agent-run", { agentId, projectId });

    return NextResponse.json({
      success: true,
      message: "Agent run enqueued",
    });
  } catch {
    // If Redis not available, run inline
    try {
      const { executeAgent } = await import("@/services/agents/executor");
      const runId = await executeAgent(agentId);
      return NextResponse.json({ success: true, data: { runId } });
    } catch {
      return NextResponse.json(
        { success: false, error: "Failed to execute agent" },
        { status: 500 }
      );
    }
  }
}
