import { NextRequest, NextResponse } from "next/server";
import { Prisma, TriggerType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createAgentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  prompt: z.string().min(1),
  seedPrompt: z.string().min(1),
  triggerType: z.enum([
    "POST_CRAWL",
    "SCHEDULED",
    "ON_NEW_ISSUES",
    "ON_NEW_PAGES",
    "MANUAL",
    "WEBHOOK_INBOUND",
  ]),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  skills: z.array(z.string()).optional(),
  geminiModel: z.string().optional(),
  webhookEnabled: z.boolean().optional(),
  webhookUrl: z.string().url().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { projectId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  const agents = await prisma.agent.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { runs: true } },
    },
  });

  return NextResponse.json({ success: true, data: agents });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { projectId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: { id: true },
  });
  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = createAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const agent = await prisma.agent.create({
    data: {
      projectId,
      name: parsed.data.name,
      description: parsed.data.description,
      prompt: parsed.data.prompt,
      seedPrompt: parsed.data.seedPrompt,
      triggerType: parsed.data.triggerType as TriggerType,
      triggerConfig: (parsed.data.triggerConfig || {}) as Prisma.InputJsonValue,
      skills: parsed.data.skills || [],
      geminiModel: parsed.data.geminiModel,
      webhookEnabled: parsed.data.webhookEnabled ?? false,
      webhookUrl: parsed.data.webhookUrl,
    },
  });

  return NextResponse.json({ success: true, data: agent }, { status: 201 });
}
