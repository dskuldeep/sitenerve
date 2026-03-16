import { NextRequest, NextResponse } from "next/server";
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
  const pageId = searchParams.get("pageId");
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "50");

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: { id: true },
  });

  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  if (pageId) {
    const pageRecord = await prisma.page.findFirst({
      where: { id: pageId, projectId },
      select: {
        id: true,
        url: true,
        canonicalUrl: true,
        statusCode: true,
        responseTime: true,
        pageSize: true,
        title: true,
        metaDescription: true,
        metaRobots: true,
        ogTags: true,
        h1: true,
        h2: true,
        h3: true,
        h4: true,
        h5: true,
        h6: true,
        jsonLd: true,
        coreWebVitals: true,
        internalLinks: true,
        externalLinks: true,
        images: true,
        wordCount: true,
        hreflangTags: true,
        depth: true,
        lastCrawledAt: true,
      },
    });

    if (!pageRecord) {
      return NextResponse.json({ success: false, error: "Page not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: pageRecord });
  }

  const [pages, total] = await Promise.all([
    prisma.page.findMany({
      where: { projectId },
      orderBy: { url: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        url: true,
        title: true,
        statusCode: true,
        responseTime: true,
        wordCount: true,
        lastCrawledAt: true,
      },
    }),
    prisma.page.count({ where: { projectId } }),
  ]);

  return NextResponse.json({
    success: true,
    data: { items: pages, total, page, pageSize, hasMore: page * pageSize < total },
  });
}
