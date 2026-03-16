import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function hasCompletedPostProcessing(diff: unknown): boolean {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return false;
  const postProcessing = (diff as Record<string, unknown>).postProcessing;
  if (!postProcessing || typeof postProcessing !== "object" || Array.isArray(postProcessing)) {
    return false;
  }
  const completedAt = (postProcessing as Record<string, unknown>).completedAt;
  return typeof completedAt === "string" && completedAt.length > 0;
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
  });

  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  if (project.status === "CRAWLING") {
    return NextResponse.json(
      { success: false, error: "A crawl is already in progress" },
      { status: 409 }
    );
  }

  try {
    const { crawlQueue, postCrawlQueue } = await import("@/lib/queue");
    const [
      runningCrawl,
      latestCompletedCrawl,
      waitingJobs,
      delayedJobs,
      prioritizedJobs,
      activeJobs,
      postWaitingJobs,
      postDelayedJobs,
      postPrioritizedJobs,
      postActiveJobs,
    ] = await Promise.all([
      prisma.crawl.findFirst({
        where: { projectId: project.id, status: "RUNNING" },
        select: { id: true },
      }),
      prisma.crawl.findFirst({
        where: { projectId: project.id, status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        select: { id: true, diff: true },
      }),
      crawlQueue.getJobs(["waiting"]),
      crawlQueue.getJobs(["delayed"]),
      crawlQueue.getJobs(["prioritized"]),
      crawlQueue.getJobs(["active"]),
      postCrawlQueue.getJobs(["waiting"]),
      postCrawlQueue.getJobs(["delayed"]),
      postCrawlQueue.getJobs(["prioritized"]),
      postCrawlQueue.getJobs(["active"]),
    ]);

    const queuedForProject = [...waitingJobs, ...delayedJobs, ...prioritizedJobs, ...activeJobs].some(
      (job) => job.data?.projectId === project.id
    );
    const queuedPostProcessingForProject = [
      ...postWaitingJobs,
      ...postDelayedJobs,
      ...postPrioritizedJobs,
      ...postActiveJobs,
    ].some((job) => job.data?.projectId === project.id);

    if (runningCrawl || queuedForProject || queuedPostProcessingForProject) {
      return NextResponse.json(
        { success: false, error: "A crawl or post-processing pipeline is already running or queued for this project" },
        { status: 409 }
      );
    }

    const lockResult = await prisma.project.updateMany({
      where: {
        id: projectId,
        userId: session.user.id,
        status: { notIn: ["CRAWLING", "INITIALIZING"] },
      },
      data: { status: "CRAWLING" },
    });

    if (lockResult.count === 0) {
      return NextResponse.json(
        { success: false, error: "A crawl is already in progress for this project" },
        { status: 409 }
      );
    }

    if (latestCompletedCrawl && !hasCompletedPostProcessing(latestCompletedCrawl.diff)) {
      console.info("[Crawl API] Recovering missing post-crawl processing", {
        projectId,
        crawlId: latestCompletedCrawl.id,
      });

      await postCrawlQueue.add(
        "post-crawl",
        {
          projectId: project.id,
          crawlId: latestCompletedCrawl.id,
          requestedAt: new Date().toISOString(),
        },
        {
          jobId: `post-crawl-${latestCompletedCrawl.id}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        }
      );

      return NextResponse.json({
        success: true,
        message: "Recovered crawl and resumed post-processing pipeline",
        data: {
          resumedPostProcessingForCrawlId: latestCompletedCrawl.id,
        },
      });
    }

    console.info("[Crawl API] Enqueue requested", {
      projectId,
      referer: req.headers.get("referer"),
      origin: req.headers.get("origin"),
      userAgent: req.headers.get("user-agent"),
    });

    await crawlQueue.add("crawl", {
      projectId: project.id,
      siteUrl: project.siteUrl,
      maxPages: project.maxCrawlPages,
      isInitial: false,
      requestedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: "Crawl job enqueued",
    });
  } catch (error) {
    console.error("Failed to enqueue crawl:", error);
    await prisma.project.update({
      where: { id: projectId },
      data: { status: project.status || "ACTIVE" },
    });
    return NextResponse.json(
      { success: false, error: "Failed to start crawl" },
      { status: 500 }
    );
  }
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

  try {
    const { crawlQueue, postCrawlQueue } = await import("@/lib/queue");

    const [waitingJobs, delayedJobs, prioritizedJobs] = await Promise.all([
      crawlQueue.getJobs(["waiting"]),
      crawlQueue.getJobs(["delayed"]),
      crawlQueue.getJobs(["prioritized"]),
    ]);

    const queuedJobs = [...waitingJobs, ...delayedJobs, ...prioritizedJobs].filter(
      (job) => job.data?.projectId === projectId
    );

    for (const job of queuedJobs) {
      await job.remove();
    }

    const [postWaitingJobs, postDelayedJobs, postPrioritizedJobs] = await Promise.all([
      postCrawlQueue.getJobs(["waiting"]),
      postCrawlQueue.getJobs(["delayed"]),
      postCrawlQueue.getJobs(["prioritized"]),
    ]);

    const queuedPostJobs = [...postWaitingJobs, ...postDelayedJobs, ...postPrioritizedJobs].filter(
      (job) => job.data?.projectId === projectId
    );

    for (const job of queuedPostJobs) {
      await job.remove();
    }

    const runningCrawl = await prisma.crawl.findFirst({
      where: { projectId, status: "RUNNING" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (runningCrawl) {
      await prisma.crawl.update({
        where: { id: runningCrawl.id },
        data: {
          status: "CANCELLED",
          errorMessage: "Cancelled by user",
        },
      });
    }

    await prisma.project.update({
      where: { id: projectId },
      data: { status: "ACTIVE" },
    });

    if (!runningCrawl && queuedJobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: queuedPostJobs.length > 0 ? "Queued post-processing jobs removed" : "No active or queued crawl found",
      });
    }

    return NextResponse.json({
      success: true,
      message: runningCrawl
        ? "Cancellation requested. Active crawl will stop shortly."
        : "Queued crawl jobs removed",
      data: {
        hadActiveCrawl: Boolean(runningCrawl),
        removedQueuedJobs: queuedJobs.length,
        removedPostProcessingJobs: queuedPostJobs.length,
      },
    });
  } catch (error) {
    console.error("Failed to cancel crawl:", error);
    return NextResponse.json(
      { success: false, error: "Failed to cancel crawl" },
      { status: 500 }
    );
  }
}
