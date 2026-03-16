import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getNextScheduledAt, isValidCronExpression } from "@/lib/scheduler";
import {
  areEquivalentSiteUrls,
  normalizeOptionalSitemapUrl,
  normalizeSiteUrl,
} from "@/lib/url-normalization";
import { z } from "zod";

const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    siteUrl: z
      .string()
      .trim()
      .transform(normalizeSiteUrl)
      .pipe(z.string().url("Must be a valid URL"))
      .optional(),
    sitemapUrl: z.string().trim().nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    maxCrawlPages: z.number().int().min(1).max(100000).optional(),
    crawlSchedule: z.string().trim().min(1).max(120).optional(),
})
  .passthrough();

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
    include: {
      _count: {
        select: {
          pages: true,
          issues: { where: { status: "ACTIVE" } },
          agents: true,
        },
      },
      crawls: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          status: true,
          totalPages: true,
          newPages: true,
          removedPages: true,
          changedPages: true,
          errorCount: true,
          errorMessage: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
        },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  const latestCrawlWithDiff = await prisma.crawl.findFirst({
    where: {
      projectId: project.id,
      status: { in: ["COMPLETED", "FAILED", "CANCELLED"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      diff: true,
    },
  });

  const activeCrawlWithDiff = await prisma.crawl.findFirst({
    where: {
      projectId: project.id,
      status: { in: ["RUNNING", "QUEUED"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      diff: true,
    },
  });

  const crawlDiffById = new Map<string, Prisma.JsonValue | null>();
  if (latestCrawlWithDiff?.id) {
    crawlDiffById.set(latestCrawlWithDiff.id, latestCrawlWithDiff.diff as Prisma.JsonValue | null);
  }
  if (activeCrawlWithDiff?.id) {
    crawlDiffById.set(activeCrawlWithDiff.id, activeCrawlWithDiff.diff as Prisma.JsonValue | null);
  }

  const crawls = project.crawls.map((crawl) => ({
    ...crawl,
    diff: crawlDiffById.get(crawl.id) ?? null,
  }));

  const nextScheduledAt = getNextScheduledAt(project.crawlSchedule || "manual");

  return NextResponse.json(
    {
      success: true,
      data: {
        ...project,
        crawls,
        schedulerEnabled: project.crawlSchedule !== "manual",
        nextScheduledAt: nextScheduledAt?.toISOString() ?? null,
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
  const parsed = updateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || "Invalid project settings payload" },
      { status: 400 }
    );
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });

  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  const updateData: Prisma.ProjectUpdateInput = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  const normalizedSiteUrl = parsed.data.siteUrl !== undefined ? parsed.data.siteUrl : project.siteUrl;
  if (parsed.data.siteUrl !== undefined) {
    const existingProjects = await prisma.project.findMany({
      where: {
        userId: session.user.id,
        id: { not: projectId },
      },
      select: { siteUrl: true },
    });
    if (existingProjects.some((entry) => areEquivalentSiteUrls(entry.siteUrl, normalizedSiteUrl))) {
      return NextResponse.json(
        { success: false, error: "You already have another project for this URL" },
        { status: 409 }
      );
    }
    updateData.siteUrl = normalizedSiteUrl;
  }
  if (parsed.data.sitemapUrl !== undefined) {
    if (!parsed.data.sitemapUrl || parsed.data.sitemapUrl.trim().length === 0) {
      updateData.sitemapUrl = null;
    } else {
      try {
        updateData.sitemapUrl = normalizeOptionalSitemapUrl(parsed.data.sitemapUrl, normalizedSiteUrl) ?? null;
      } catch {
        return NextResponse.json(
          { success: false, error: "Sitemap URL must be a valid URL or sitemap path" },
          { status: 400 }
        );
      }
    }
  }
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.maxCrawlPages !== undefined) updateData.maxCrawlPages = parsed.data.maxCrawlPages;
  if (parsed.data.crawlSchedule !== undefined) {
    if (!isValidCronExpression(parsed.data.crawlSchedule, true)) {
      return NextResponse.json(
        { success: false, error: "Crawl schedule must be a valid cron expression or 'manual'" },
        { status: 400 }
      );
    }
    updateData.crawlSchedule = parsed.data.crawlSchedule;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { success: false, error: "No supported project settings provided" },
      { status: 400 }
    );
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: updateData,
  });

  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(
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
  });

  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  await prisma.project.delete({ where: { id: projectId } });

  return NextResponse.json({ success: true, message: "Project deleted" });
}
