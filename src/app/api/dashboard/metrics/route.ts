import { NextResponse } from "next/server";
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
  score: number;
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

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const today = startOfDay(new Date());
  const windowStart = addDays(today, -6);

  const [recentIssues, projectsWithCrawl] = await Promise.all([
    prisma.issue.findMany({
      where: {
        project: { userId: session.user.id },
        firstDetectedAt: { gte: windowStart },
      },
      select: {
        severity: true,
        firstDetectedAt: true,
      },
    }),
    prisma.project.findMany({
      where: {
        userId: session.user.id,
        lastCrawlAt: { gte: windowStart },
      },
      select: {
        healthScore: true,
        lastCrawlAt: true,
      },
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
    const key = dateKey(issue.firstDetectedAt);
    const bucket = issueBuckets.get(key);
    if (!bucket) continue;

    if (issue.severity === "CRITICAL") bucket.critical += 1;
    if (issue.severity === "HIGH") bucket.high += 1;
    if (issue.severity === "MEDIUM") bucket.medium += 1;
    if (issue.severity === "LOW") bucket.low += 1;
    issueTotal += 1;
  }

  const healthAggregate = new Map<string, { sum: number; count: number; label: string }>();
  for (const project of projectsWithCrawl) {
    if (!project.lastCrawlAt) continue;
    const key = dateKey(project.lastCrawlAt);
    const label = dateLabel(project.lastCrawlAt);
    const aggregate = healthAggregate.get(key) ?? { sum: 0, count: 0, label };
    aggregate.sum += project.healthScore;
    aggregate.count += 1;
    healthAggregate.set(key, aggregate);
  }

  const healthScoreTrend: HealthScorePoint[] = Array.from(healthAggregate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, value]) => ({
      date: value.label,
      score: Math.round((value.sum / value.count) * 10) / 10,
    }));

  return NextResponse.json({
    success: true,
    data: {
      issuesBySeverity: issueTotal > 0 ? Array.from(issueBuckets.values()) : [],
      healthScoreTrend,
    },
  });
}
