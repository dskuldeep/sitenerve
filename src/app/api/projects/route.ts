import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  areEquivalentSiteUrls,
  normalizeHostname,
  normalizeOptionalSitemapUrl,
  normalizeSiteUrl,
} from "@/lib/url-normalization";
import { z } from "zod";

const createProjectSchema = z.object({
  name: z.string().optional(),
  siteUrl: z
    .string()
    .min(1, "URL is required")
    .transform(normalizeSiteUrl)
    .pipe(z.string().url("Must be a valid URL")),
  description: z.string().optional(),
  sitemapUrl: z.string().optional(),
})
  .superRefine((value, ctx) => {
    if (!value.sitemapUrl?.trim()) return;

    try {
      validateSitemapCandidate(value.sitemapUrl, value.siteUrl);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sitemapUrl"],
        message: "Sitemap URL must be a valid URL or sitemap path",
      });
    }
  })
  .transform((value) => ({
    ...value,
    sitemapUrl: normalizeSitemapCandidate(value.sitemapUrl, value.siteUrl),
  }));

function validateSitemapCandidate(raw: string | undefined, siteUrl: string): void {
  normalizeOptionalSitemapUrl(raw, siteUrl);
}

function normalizeSitemapCandidate(raw: string | undefined, siteUrl: string): string | undefined {
  try {
    return normalizeOptionalSitemapUrl(raw, siteUrl);
  } catch {
    return undefined;
  }
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      siteUrl: true,
      status: true,
      healthScore: true,
      totalPages: true,
      totalIssues: true,
      lastCrawlAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ success: true, data: projects });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createProjectSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { siteUrl, description, sitemapUrl } = parsed.data;
  let name = parsed.data.name;

  if (!name) {
    try {
      const url = new URL(siteUrl);
      name = normalizeHostname(url.hostname);
    } catch {
      name = siteUrl;
    }
  }

  const existingProjects = await prisma.project.findMany({
    where: { userId: session.user.id },
    select: { siteUrl: true },
  });

  if (existingProjects.some((project) => areEquivalentSiteUrls(project.siteUrl, siteUrl))) {
    return NextResponse.json(
      { success: false, error: "You already have a project for this URL" },
      { status: 409 }
    );
  }

  const project = await prisma.project.create({
    data: {
      userId: session.user.id,
      name,
      siteUrl,
      sitemapUrl,
      description,
      status: "INITIALIZING",
    },
  });

  // Auto-provision starter agents
  try {
    const { seedPrompts } = await import("@/services/agents/seed-prompts");
    const starterAgents = [
      { key: "TECHNICAL_SEO_AUDITOR", trigger: "POST_CRAWL" as const },
      { key: "CONTENT_QUALITY_ANALYZER", trigger: "POST_CRAWL" as const },
      { key: "LINK_HEALTH_MONITOR", trigger: "POST_CRAWL" as const },
    ];

    for (const { key, trigger } of starterAgents) {
      const seed = seedPrompts[key];
      if (!seed) continue;
      await prisma.agent.create({
        data: {
          projectId: project.id,
          name: seed.name,
          description: seed.description,
          prompt: seed.prompt,
          seedPrompt: seed.prompt,
          triggerType: trigger,
          isActive: true,
          skills: [],
        },
      });
    }
    console.log(`[Projects] Auto-provisioned 3 starter agents for project ${project.id}`);
  } catch (error) {
    console.error("Failed to create starter agents:", error);
  }

  // Enqueue initial crawl (BullMQ)
  try {
    const { crawlQueue } = await import("@/lib/queue");
    await crawlQueue.add("crawl", {
      projectId: project.id,
      siteUrl: project.siteUrl,
      isInitial: true,
      maxPages: project.maxCrawlPages,
    }, {
      jobId: `initial-crawl-${project.id}`,
    });
  } catch (error) {
    console.error("Failed to enqueue crawl job:", error);
  }

  return NextResponse.json({ success: true, data: project }, { status: 201 });
}
