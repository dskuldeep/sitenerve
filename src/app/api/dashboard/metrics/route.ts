import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface IssuesBySeverityPoint {
  crawl: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

interface HealthScorePoint {
  date: string;
  score: number | null;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function dateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function extractHealthScore(diff: unknown): number | null {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return null;

  const postProcessing = (diff as Record<string, unknown>).postProcessing;
  if (
    !postProcessing ||
    typeof postProcessing !== "object" ||
    Array.isArray(postProcessing)
  ) {
    return null;
  }

  const healthScore = (postProcessing as Record<string, unknown>).healthScore;
  return typeof healthScore === "number" && Number.isFinite(healthScore) ? healthScore : null;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const selectedProjectId = req.nextUrl.searchParams.get("projectId")?.trim() || null;
  const today = startOfDay(new Date());
  const windowStart = addDays(today, -6);
  const projectWhere = selectedProjectId
    ? { id: selectedProjectId, userId: session.user.id }
    : { userId: session.user.id };

  if (selectedProjectId) {
    const project = await prisma.project.findFirst({
      where: { id: selectedProjectId, userId: session.user.id },
      select: { id: true },
    });

    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }
  }

  const [recentIssues, recentCrawls] = await Promise.all([
    prisma.issue.findMany({
      where: {
        project: projectWhere,
        status: { in: ["ACTIVE", "WHITELISTED"] },
        lastDetectedAt: { gte: windowStart },
      },
      select: {
        severity: true,
        lastDetectedAt: true,
      },
    }),
    prisma.crawl.findMany({
      where: {
        project: projectWhere,
        status: "COMPLETED",
        completedAt: { gte: windowStart },
      },
      select: {
        projectId: true,
        completedAt: true,
        diff: true,
      },
      orderBy: { completedAt: "asc" },
    }),
  ]);

  const issueBuckets = new Map<string, IssuesBySeverityPoint>();
  for (let i = 0; i < 7; i++) {
    const day = addDays(windowStart, i);
    issueBuckets.set(dateKey(day), {
      crawl: dateLabel(day),
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    });
  }

  let issueTotal = 0;
  for (const issue of recentIssues) {
    const key = dateKey(issue.lastDetectedAt);
    const bucket = issueBuckets.get(key);
    if (!bucket) continue;

    if (issue.severity === "CRITICAL") bucket.critical += 1;
    if (issue.severity === "HIGH") bucket.high += 1;
    if (issue.severity === "MEDIUM") bucket.medium += 1;
    if (issue.severity === "LOW") bucket.low += 1;
    issueTotal += 1;
  }

  const healthAggregate = new Map<string, { sum: number; count: number }>();
  for (const crawl of recentCrawls) {
    if (!crawl.completedAt) continue;
    const healthScore = extractHealthScore(crawl.diff);
    if (healthScore === null) continue;

    const key = dateKey(crawl.completedAt);
    const aggregate = healthAggregate.get(key) ?? { sum: 0, count: 0 };
    aggregate.sum += healthScore;
    aggregate.count += 1;
    healthAggregate.set(key, aggregate);
  }

  const healthScoreTrend: HealthScorePoint[] = [];
  let healthPointCount = 0;
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(windowStart, i);
    const key = dateKey(day);
    const aggregate = healthAggregate.get(key);
    const score =
      aggregate && aggregate.count > 0
        ? Math.round((aggregate.sum / aggregate.count) * 10) / 10
        : null;

    if (score !== null) {
      healthPointCount += 1;
    }

    healthScoreTrend.push({
      date: dateLabel(day),
      score,
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      issuesBySeverity: issueTotal > 0 ? Array.from(issueBuckets.values()) : [],
      healthScoreTrend: healthPointCount > 0 ? healthScoreTrend : [],
    },
  });
}
