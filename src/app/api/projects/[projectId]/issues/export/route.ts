import { NextRequest, NextResponse } from "next/server";
import { IssueCategory, IssueSeverity, IssueStatus, Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeComparableUrl } from "@/lib/url-normalization";

type CrawlPageForLinks = {
  url: string;
  internalLinks: Prisma.JsonValue | null;
  externalLinks: Prisma.JsonValue | null;
};

type ExportIssueRow = {
  id: string;
  ruleId: string;
  category: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  affectedUrl: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  linkPresence: "PRESENT" | "NOT_PRESENT";
  linkedFromCount: number;
  linkedFromUrls: string[];
  evidence: Prisma.JsonValue | null;
};

function extractLinkHrefs(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  const hrefs: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      hrefs.push(item);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.href === "string") {
      hrefs.push(record.href);
    }
  }
  return hrefs;
}

function toCsvField(value: unknown): string {
  const str =
    typeof value === "string" ? value : value === null || value === undefined ? "" : JSON.stringify(value);
  const escaped = str.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

function toCsv(rows: ExportIssueRow[]): string {
  const headers = [
    "Issue ID",
    "Rule ID",
    "Severity",
    "Category",
    "Status",
    "Title",
    "Description",
    "Affected URL",
    "Link Presence",
    "Linked From Count",
    "Linked From URLs",
    "First Detected",
    "Last Detected",
    "Evidence",
  ];

  const dataRows = rows.map((row) =>
    [
      row.id,
      row.ruleId,
      row.severity,
      row.category,
      row.status,
      row.title,
      row.description,
      row.affectedUrl,
      row.linkPresence,
      row.linkedFromCount,
      row.linkedFromUrls.join(" | "),
      row.firstDetectedAt,
      row.lastDetectedAt,
      row.evidence || {},
    ]
      .map((cell) => toCsvField(cell))
      .join(",")
  );

  return [headers.map((header) => toCsvField(header)).join(","), ...dataRows].join("\n");
}

function buildIssueWhere(projectId: string, searchParams: URLSearchParams): Prisma.IssueWhereInput {
  const severity = searchParams.get("severity");
  const category = searchParams.get("category");
  const status = searchParams.get("status") || "ACTIVE";
  const search = searchParams.get("search");
  const affectedUrl = searchParams.get("affectedUrl");
  const pageId = searchParams.get("pageId");

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

  if (affectedUrl) {
    where.affectedUrl = { contains: affectedUrl, mode: "insensitive" };
  }
  if (pageId) {
    where.pageId = pageId;
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

  return where;
}

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
  const format = (searchParams.get("format") || "json").toLowerCase();

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: { id: true, name: true, siteUrl: true },
  });

  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  const where = buildIssueWhere(projectId, searchParams);

  const [issues, latestCrawl] = await Promise.all([
    prisma.issue.findMany({
      where,
      orderBy: [{ severity: "desc" }, { lastDetectedAt: "desc" }],
      select: {
        id: true,
        ruleId: true,
        category: true,
        severity: true,
        status: true,
        title: true,
        description: true,
        affectedUrl: true,
        firstDetectedAt: true,
        lastDetectedAt: true,
        evidence: true,
      },
    }),
    prisma.crawl.findFirst({
      where: {
        projectId,
        status: { in: ["COMPLETED", "FAILED", "CANCELLED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
  ]);

  const pagesForLinks: CrawlPageForLinks[] = latestCrawl
    ? (
        await prisma.crawlPage.findMany({
          where: { crawlId: latestCrawl.id },
          select: {
            page: {
              select: {
                url: true,
                internalLinks: true,
                externalLinks: true,
              },
            },
          },
        })
      ).map((row) => row.page)
    : await prisma.page.findMany({
        where: { projectId },
        select: {
          url: true,
          internalLinks: true,
          externalLinks: true,
        },
      });

  const sourceUrlsByTarget = new Map<string, Set<string>>();
  for (const page of pagesForLinks) {
    const sourceUrl = page.url;
    const hrefs = [
      ...extractLinkHrefs(page.internalLinks),
      ...extractLinkHrefs(page.externalLinks),
    ];

    for (const href of hrefs) {
      try {
        const normalizedTarget = normalizeComparableUrl(href, sourceUrl);
        if (!sourceUrlsByTarget.has(normalizedTarget)) {
          sourceUrlsByTarget.set(normalizedTarget, new Set());
        }
        sourceUrlsByTarget.get(normalizedTarget)!.add(sourceUrl);
      } catch {
        // Ignore malformed href values.
      }
    }
  }

  const rows: ExportIssueRow[] = issues.map((issue) => {
    let normalizedAffected = issue.affectedUrl;
    try {
      normalizedAffected = normalizeComparableUrl(issue.affectedUrl, project.siteUrl);
    } catch {
      normalizedAffected = issue.affectedUrl;
    }
    const linkedFromUrls = Array.from(sourceUrlsByTarget.get(normalizedAffected) || []).sort();
    return {
      id: issue.id,
      ruleId: issue.ruleId,
      category: issue.category,
      severity: issue.severity,
      status: issue.status,
      title: issue.title,
      description: issue.description,
      affectedUrl: issue.affectedUrl,
      firstDetectedAt: issue.firstDetectedAt.toISOString(),
      lastDetectedAt: issue.lastDetectedAt.toISOString(),
      linkPresence: linkedFromUrls.length > 0 ? "PRESENT" : "NOT_PRESENT",
      linkedFromCount: linkedFromUrls.length,
      linkedFromUrls,
      evidence: issue.evidence,
    };
  });

  if (format === "csv") {
    const csv = toCsv(rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "Content-Disposition": `attachment; filename=\"${project.name}-issues-export.csv\"`,
      },
    });
  }

  const grouped = new Map<
    string,
    {
      ruleId: string;
      title: string;
      category: string;
      severity: string;
      description: string;
      totalInstances: number;
      affectedUrls: Array<{
        url: string;
        status: string;
        linkedFromCount: number;
        linkedFromUrls: string[];
      }>;
    }
  >();

  for (const row of rows) {
    const key = `${row.ruleId}::${row.title}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        ruleId: row.ruleId,
        title: row.title,
        category: row.category,
        severity: row.severity,
        description: row.description,
        totalInstances: 1,
        affectedUrls: [
          {
            url: row.affectedUrl,
            status: row.status,
            linkedFromCount: row.linkedFromCount,
            linkedFromUrls: row.linkedFromUrls,
          },
        ],
      });
    } else {
      current.totalInstances += 1;
      current.affectedUrls.push({
        url: row.affectedUrl,
        status: row.status,
        linkedFromCount: row.linkedFromCount,
        linkedFromUrls: row.linkedFromUrls,
      });
    }
  }

  const severityCounts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.severity] = (acc[row.severity] || 0) + 1;
    return acc;
  }, {});

  const categoryCounts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.category] = (acc[row.category] || 0) + 1;
    return acc;
  }, {});

  const presentLinkCount = rows.filter((row) => row.linkPresence === "PRESENT").length;

  return NextResponse.json(
    {
      success: true,
      data: {
        project: {
          id: project.id,
          name: project.name,
          siteUrl: project.siteUrl,
          latestTerminalCrawlId: latestCrawl?.id || null,
          crawledPagesUsedForLinkMapping: pagesForLinks.length,
        },
        exportedAt: new Date().toISOString(),
        filters: {
          severity: searchParams.get("severity"),
          category: searchParams.get("category"),
          status: searchParams.get("status") || "ACTIVE",
          search: searchParams.get("search"),
          affectedUrl: searchParams.get("affectedUrl"),
          pageId: searchParams.get("pageId"),
        },
        summary: {
          totalIssues: rows.length,
          severityCounts,
          categoryCounts,
          linkPresence: {
            present: presentLinkCount,
            notPresent: rows.length - presentLinkCount,
          },
        },
        groupedIssues: Array.from(grouped.values()),
        issues: rows,
      },
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
