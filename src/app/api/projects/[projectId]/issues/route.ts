import { NextRequest, NextResponse } from "next/server";
import { IssueCategory, IssueSeverity, IssueStatus, Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const { searchParams } = new URL(req.url);
  const severity = searchParams.get("severity");
  const category = searchParams.get("category");
  const status = searchParams.get("status") || "ACTIVE";
  const search = searchParams.get("search");
  const pageId = searchParams.get("pageId");
  const affectedUrl = searchParams.get("affectedUrl");
  const all = searchParams.get("all") === "true";
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = Math.min(parseInt(searchParams.get("pageSize") || "50"), 50000);

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: { id: true },
  });

  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  const where: Prisma.IssueWhereInput = { projectId };

  if (severity) {
    const severities = severity
      .split(",")
      .filter((value): value is IssueSeverity =>
        (Object.values(IssueSeverity) as string[]).includes(value)
      );

    if (severities.length > 0) {
      where.severity = { in: severities };
    }
  }

  if (category && (Object.values(IssueCategory) as string[]).includes(category)) {
    where.category = category as IssueCategory;
  }

  if (pageId) where.pageId = pageId;
  if (affectedUrl) {
    where.affectedUrl = { contains: affectedUrl, mode: "insensitive" };
  }
  if (status && status !== "ALL" && (Object.values(IssueStatus) as string[]).includes(status)) {
    where.status = status as IssueStatus;
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { affectedUrl: { contains: search, mode: "insensitive" } },
    ];
  }

  const [issues, total] = await Promise.all([
    prisma.issue.findMany({
      where,
      orderBy: [
        { severity: "desc" },
        { lastDetectedAt: "desc" },
      ],
      skip: all ? undefined : (page - 1) * pageSize,
      take: all ? undefined : pageSize,
    }),
    prisma.issue.count({ where }),
  ]);

  return NextResponse.json(
    {
      success: true,
      data: {
        items: issues,
        total,
        page: all ? 1 : page,
        pageSize: all ? issues.length : pageSize,
        hasMore: all ? false : page * pageSize < total,
      },
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const body = await req.json();
  const { issueId, isWhitelisted, whitelistReason } = body;

  const issue = await prisma.issue.findFirst({
    where: { id: issueId, projectId },
  });

  if (!issue) {
    return NextResponse.json({ success: false, error: "Issue not found" }, { status: 404 });
  }

  const updated = await prisma.issue.update({
    where: { id: issueId },
    data: {
      isWhitelisted,
      whitelistReason,
      status: isWhitelisted ? "WHITELISTED" : "ACTIVE",
    },
  });

  return NextResponse.json({ success: true, data: updated });
}
