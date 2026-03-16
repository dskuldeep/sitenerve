import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const whitelistSchema = z.object({
  scope: z.enum(["SINGLE", "RULE", "URL_PATTERN"]),
  issueId: z.string().optional(),
  ruleId: z.string().optional(),
  urlPattern: z.string().optional(),
  reason: z.string().min(1),
  expiresAt: z.string().optional(),
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

  const entries = await prisma.whitelistEntry.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ success: true, data: entries });
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

  const body = await req.json();
  const parsed = whitelistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const entry = await prisma.whitelistEntry.create({
    data: {
      projectId,
      scope: parsed.data.scope,
      issueId: parsed.data.issueId,
      ruleId: parsed.data.ruleId,
      urlPattern: parsed.data.urlPattern,
      reason: parsed.data.reason,
      createdBy: session.user.id,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    },
  });

  // Apply whitelist to matching issues
  if (parsed.data.scope === "SINGLE" && parsed.data.issueId) {
    await prisma.issue.update({
      where: { id: parsed.data.issueId },
      data: { isWhitelisted: true, whitelistReason: parsed.data.reason, status: "WHITELISTED" },
    });
  } else if (parsed.data.scope === "RULE" && parsed.data.ruleId) {
    await prisma.issue.updateMany({
      where: { projectId, ruleId: parsed.data.ruleId, status: "ACTIVE" },
      data: { isWhitelisted: true, whitelistReason: parsed.data.reason, status: "WHITELISTED" },
    });
  }

  return NextResponse.json({ success: true, data: entry }, { status: 201 });
}
