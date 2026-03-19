import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getAgentPromptPreviewPayload,
  resolveAgentRuntime,
} from "@/services/agents/runtime";
import { normalizeAgentContextConfig } from "@/types/agents";

const previewSchema = z.object({
  prompt: z.string().min(1).optional(),
  geminiModel: z.string().min(1).nullable().optional(),
  contextConfig: z.object({
    includeProjectSummary: z.boolean().optional(),
    includePageData: z.boolean().optional(),
    includeExistingIssues: z.boolean().optional(),
    includePreviousFindings: z.boolean().optional(),
    includeLatestCrawlDelta: z.boolean().optional(),
  }).optional(),
});

export async function POST(
  req: NextRequest,
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

  const body = await req.json();
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, projectId },
    select: { id: true },
  });
  if (!agent) {
    return NextResponse.json({ success: false, error: "Agent not found" }, { status: 404 });
  }

  const runtime = await resolveAgentRuntime(agentId, {
    ...parsed.data,
    contextConfig: parsed.data.contextConfig
      ? normalizeAgentContextConfig(parsed.data.contextConfig)
      : undefined,
  });

  return NextResponse.json({
    success: true,
    data: {
      ...getAgentPromptPreviewPayload(runtime),
      model: runtime.model,
    },
  });
}
