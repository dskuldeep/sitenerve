import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getNextScheduledAt, isValidCronExpression } from "@/lib/scheduler";
import { z } from "zod";

const updateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  prompt: z.string().min(1).optional(),
  triggerType: z.enum([
    "POST_CRAWL",
    "SCHEDULED",
    "ON_NEW_ISSUES",
    "ON_NEW_PAGES",
    "MANUAL",
    "WEBHOOK_INBOUND",
  ]).optional(),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  skills: z.array(z.string()).optional(),
  geminiModel: z.string().min(1).nullable().optional(),
  webhookEnabled: z.boolean().optional(),
  webhookUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().optional(),
});

function getScheduledCron(triggerConfig: Record<string, unknown> | undefined): string | null {
  if (!triggerConfig) return null;
  const cron =
    typeof triggerConfig.cron === "string"
      ? triggerConfig.cron.trim()
      : typeof triggerConfig.schedule === "string"
        ? triggerConfig.schedule.trim()
        : "";
  return cron.length > 0 ? cron : null;
}

async function assertProjectOwnership(projectId: string, userId: string): Promise<boolean> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });

  return Boolean(project);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; agentId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { projectId, agentId } = await params;

  const hasAccess = await assertProjectOwnership(projectId, session.user.id);
  if (!hasAccess) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, projectId },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          findings: true,
        },
      },
    },
  });

  if (!agent) {
    return NextResponse.json({ success: false, error: "Agent not found" }, { status: 404 });
  }

  const cron = getScheduledCron(agent.triggerConfig as Record<string, unknown> | undefined);
  const nextScheduledAt =
    agent.triggerType === "SCHEDULED" && cron ? getNextScheduledAt(cron) : null;

  return NextResponse.json({
    success: true,
    data: {
      ...agent,
      nextScheduledAt: nextScheduledAt?.toISOString() ?? null,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; agentId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { projectId, agentId } = await params;

  const hasAccess = await assertProjectOwnership(projectId, session.user.id);
  if (!hasAccess) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = updateAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const nextTriggerType = parsed.data.triggerType;
  if (nextTriggerType === "SCHEDULED" || parsed.data.triggerConfig !== undefined) {
    const cron = getScheduledCron(parsed.data.triggerConfig);
    if (nextTriggerType === "SCHEDULED" && (!cron || !isValidCronExpression(cron))) {
      return NextResponse.json(
        { success: false, error: "Scheduled agents require a valid cron expression in triggerConfig.cron" },
        { status: 400 }
      );
    }
    if (cron && !isValidCronExpression(cron)) {
      return NextResponse.json(
        { success: false, error: "triggerConfig.cron must be a valid cron expression" },
        { status: 400 }
      );
    }
  }

  const updateData: Prisma.AgentUpdateManyMutationInput = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.prompt !== undefined) updateData.prompt = parsed.data.prompt;
  if (parsed.data.triggerType !== undefined) updateData.triggerType = parsed.data.triggerType;
  if (parsed.data.triggerConfig !== undefined) {
    updateData.triggerConfig = parsed.data.triggerConfig as Prisma.InputJsonValue;
  }
  if (parsed.data.skills !== undefined) {
    updateData.skills = parsed.data.skills as Prisma.InputJsonValue;
  }
  if (parsed.data.geminiModel !== undefined) updateData.geminiModel = parsed.data.geminiModel;
  if (parsed.data.webhookEnabled !== undefined) updateData.webhookEnabled = parsed.data.webhookEnabled;
  if (parsed.data.webhookUrl !== undefined) updateData.webhookUrl = parsed.data.webhookUrl;
  if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;

  const updateResult = await prisma.agent.updateMany({
    where: { id: agentId, projectId },
    data: updateData,
  });
  if (updateResult.count === 0) {
    return NextResponse.json({ success: false, error: "Agent not found" }, { status: 404 });
  }

  const updated = await prisma.agent.findUnique({
    where: { id: agentId },
  });
  if (!updated) {
    return NextResponse.json({ success: false, error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; agentId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { projectId, agentId } = await params;

  const hasAccess = await assertProjectOwnership(projectId, session.user.id);
  if (!hasAccess) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  const deleteResult = await prisma.agent.deleteMany({
    where: { id: agentId, projectId },
  });
  if (deleteResult.count === 0) {
    return NextResponse.json({ success: false, error: "Agent not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
