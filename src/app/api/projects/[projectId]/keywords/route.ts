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
  const search = searchParams.get("search");
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "50");

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: { id: true },
  });

  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  // Parse keywords dynamically if comma-separated
  const terms = search
    ? search
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const searchFilter =
    terms.length > 0
      ? {
          // Wrap all terms in an AND condition so the page must match all specified filters
          AND: terms.map((term) => ({
            OR: [
              { url: { contains: term, mode: "insensitive" } },
              { title: { contains: term, mode: "insensitive" } },
              { keywords: { some: { keyword: { contains: term, mode: "insensitive" } } } },
            ],
          })),
        }
      : {};

  // Get pages with their keywords
  const pages = await prisma.page.findMany({
    where: {
      projectId,
      ...searchFilter,
    },
    include: {
      keywords: {
        orderBy: { score: "desc" },
        take: 10,
      },
    },
    orderBy: { url: "asc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  } as any);

  const total = await prisma.page.count({
    where: { projectId },
  });

  return NextResponse.json({
    success: true,
    data: {
      items: pages.map((p: any) => ({
        id: p.id,
        url: p.url,
        title: p.title,
        keywords: p.keywords.map((k: any) => ({
          keyword: k.keyword,
          score: k.score,
          sources: k.sources,
        })),
      })),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    },
  });
}
