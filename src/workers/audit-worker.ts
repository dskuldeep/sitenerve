import { IssueCategory, IssueSeverity, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuditRule, PageData } from "@/services/audit/audit-engine";
import { calculateHealthScore } from "@/services/audit/health-score";

// Import all rule sets
import { indexabilityRules } from "@/services/audit/rules/indexability";
import { crawlabilityRules } from "@/services/audit/rules/crawlability";
import { onPageRules } from "@/services/audit/rules/on-page";
import { performanceRules } from "@/services/audit/rules/performance";
import { structuredDataRules } from "@/services/audit/rules/structured-data";
import { imageRules } from "@/services/audit/rules/images";
import { linkRules } from "@/services/audit/rules/links";
import { internationalizationRules } from "@/services/audit/rules/internationalization";
import { canonicalizationRules } from "@/services/audit/rules/canonicalization";
import { securityRules } from "@/services/audit/rules/security";
import { mobileRules } from "@/services/audit/rules/mobile";
import { socialRules } from "@/services/audit/rules/social";

const allRules: AuditRule[] = [
  ...indexabilityRules,
  ...crawlabilityRules,
  ...onPageRules,
  ...performanceRules,
  ...structuredDataRules,
  ...imageRules,
  ...linkRules,
  ...internationalizationRules,
  ...canonicalizationRules,
  ...securityRules,
  ...mobileRules,
  ...socialRules,
];

const ISSUE_CREATE_BATCH_SIZE = 500;
const ISSUE_UPDATE_CONCURRENCY = 20;
const EVENT_LOOP_YIELD_INTERVAL = 50;
const AUDIT_PROGRESS_LOG_INTERVAL = 5000;

type DetectedIssueRecord = {
  key: string;
  pageId: string | null;
  ruleId: string;
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  affectedUrl: string;
  evidence: Prisma.InputJsonValue;
};

type ExistingIssueRecord = {
  id: string;
  ruleId: string;
  affectedUrl: string;
  isWhitelisted: boolean;
  pageId: string | null;
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  evidence: Prisma.JsonValue | null;
};

function normalizeCategory(input: string): IssueCategory {
  const normalized = input.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const mapping: Record<string, IssueCategory> = {
    indexability: "INDEXABILITY",
    crawlability: "CRAWLABILITY",
    on_page: "ON_PAGE",
    performance: "PERFORMANCE",
    structured_data: "STRUCTURED_DATA",
    images: "IMAGES",
    links: "LINKS",
    internationalization: "INTERNATIONALIZATION",
    canonicalization: "CANONICALIZATION",
    security: "SECURITY",
    mobile: "MOBILE",
    social: "SOCIAL",
  };

  return mapping[normalized] || "ON_PAGE";
}

function normalizeSeverity(input: string): IssueSeverity {
  const normalized = input.trim().toUpperCase();
  const mapping: Record<string, IssueSeverity> = {
    INFO: "INFO",
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH",
    CRITICAL: "CRITICAL",
  };

  return mapping[normalized] || "MEDIUM";
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  runner: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  let index = 0;

  const worker = async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) break;
      await runner(items[current]);
    }
  };

  await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));
}

function issueKey(ruleId: string, affectedUrl: string): string {
  return `${ruleId}::${affectedUrl}`;
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export async function runAudit(projectId: string, crawlId: string) {
  console.log(`[Audit Engine] Starting audit for project ${projectId}, crawl ${crawlId}`);

  const crawlPageRows = await prisma.crawlPage.findMany({
    where: { crawlId },
    select: {
      page: true,
    },
  });

  const crawlPages = crawlPageRows.map((row) => row.page).filter((page) => page.projectId === projectId);
  const pages =
    crawlPages.length > 0
      ? crawlPages
      : await prisma.page.findMany({
          where: { projectId },
        });
  const pageIdByUrl = new Map(pages.map((page) => [page.url, page.id]));

  const pageDataList: PageData[] = pages.map((p) => ({
    url: p.url,
    canonicalUrl: p.canonicalUrl,
    statusCode: p.statusCode,
    responseTime: p.responseTime,
    title: p.title,
    metaDescription: p.metaDescription,
    metaRobots: p.metaRobots,
    h1: p.h1,
    h2: p.h2,
    h3: p.h3,
    ogTags: p.ogTags as Record<string, string> | null,
    jsonLd: p.jsonLd as unknown[] | null,
    internalLinks: p.internalLinks as Array<{
      href: string;
      text: string;
      rel?: string;
      nofollow?: boolean;
    }> | null,
    externalLinks: p.externalLinks as Array<{
      href: string;
      text: string;
      rel?: string;
      nofollow?: boolean;
      statusCode?: number;
      isBroken?: boolean;
      redirectChain?: string[];
      error?: string;
    }> | null,
    images: p.images as Array<{ src: string; alt: string; width?: number; height?: number }> | null,
    wordCount: p.wordCount,
    hreflangTags: p.hreflangTags as Array<{ lang: string; href: string }> | null,
    pageSize: p.pageSize,
  }));

  const detectedIssueMap = new Map<string, DetectedIssueRecord>();
  let evaluatedChecks = 0;
  for (const page of pageDataList) {
    for (const rule of allRules) {
      try {
        const issue = rule.check(page, pageDataList);
        evaluatedChecks += 1;
        if (evaluatedChecks % AUDIT_PROGRESS_LOG_INTERVAL === 0) {
          console.log(
            `[Audit Engine] Progress: evaluated ${evaluatedChecks} checks (${detectedIssueMap.size} unique issues found)`
          );
        }
        if (evaluatedChecks % EVENT_LOOP_YIELD_INTERVAL === 0) {
          await yieldToEventLoop();
        }
        if (!issue) continue;
        const key = issueKey(issue.ruleId, issue.affectedUrl);
        if (detectedIssueMap.has(key)) continue;
        detectedIssueMap.set(key, {
          key,
          pageId: pageIdByUrl.get(page.url) || null,
          ruleId: issue.ruleId,
          category: normalizeCategory(issue.category),
          severity: normalizeSeverity(issue.severity),
          title: issue.title,
          description: issue.description,
          affectedUrl: issue.affectedUrl,
          evidence: (issue.evidence || {}) as Prisma.InputJsonValue,
        });
      } catch (error) {
        console.error(`[Audit Worker] Rule ${rule.id} failed for ${page.url}:`, error);
      }
    }
  }

  const unresolvedIssues = await prisma.issue.findMany({
    where: {
      projectId,
      status: { in: ["ACTIVE", "WHITELISTED"] },
    },
    select: {
      id: true,
      ruleId: true,
      affectedUrl: true,
      isWhitelisted: true,
      pageId: true,
      category: true,
      severity: true,
      title: true,
      description: true,
      evidence: true,
    },
    orderBy: { lastDetectedAt: "desc" },
  });

  const existingByKey = new Map<string, ExistingIssueRecord>();
  const duplicateIssueIds: string[] = [];
  for (const issue of unresolvedIssues) {
    const key = issueKey(issue.ruleId, issue.affectedUrl);
    if (!existingByKey.has(key)) {
      existingByKey.set(key, issue);
    } else {
      duplicateIssueIds.push(issue.id);
    }
  }

  const now = new Date();
  const staleIssueIds: string[] = [];
  const issuesToCreate: Array<Prisma.IssueCreateManyInput> = [];
  const issuesToUpdate: Array<{
    id: string;
    data: Prisma.IssueUpdateInput;
  }> = [];

  for (const [key, detectedIssue] of detectedIssueMap.entries()) {
    const existing = existingByKey.get(key);

    if (!existing) {
      issuesToCreate.push({
        projectId,
        pageId: detectedIssue.pageId,
        ruleId: detectedIssue.ruleId,
        category: detectedIssue.category,
        severity: detectedIssue.severity,
        title: detectedIssue.title,
        description: detectedIssue.description,
        affectedUrl: detectedIssue.affectedUrl,
        evidence: detectedIssue.evidence,
        status: "ACTIVE",
        firstDetectedAt: now,
        lastDetectedAt: now,
        resolvedAt: null,
      });
      continue;
    }

    const expectedStatus = existing.isWhitelisted ? "WHITELISTED" : "ACTIVE";
    const evidenceChanged =
      JSON.stringify(existing.evidence || {}) !== JSON.stringify(detectedIssue.evidence || {});
    const needsUpdate =
      existing.pageId !== detectedIssue.pageId ||
      existing.category !== detectedIssue.category ||
      existing.severity !== detectedIssue.severity ||
      existing.title !== detectedIssue.title ||
      existing.description !== detectedIssue.description ||
      evidenceChanged;

    const updateData: Prisma.IssueUpdateInput = {
      lastDetectedAt: now,
      resolvedAt: null,
      status: expectedStatus,
    };

    if (needsUpdate) {
      updateData.page = detectedIssue.pageId
        ? { connect: { id: detectedIssue.pageId } }
        : { disconnect: true };
      updateData.category = detectedIssue.category;
      updateData.severity = detectedIssue.severity;
      updateData.title = detectedIssue.title;
      updateData.description = detectedIssue.description;
      updateData.evidence = detectedIssue.evidence;
    }

    issuesToUpdate.push({
      id: existing.id,
      data: updateData,
    });
  }

  const detectedIssueKeys = new Set(detectedIssueMap.keys());
  for (const issue of unresolvedIssues) {
    const key = issueKey(issue.ruleId, issue.affectedUrl);
    if (!detectedIssueKeys.has(key)) {
      staleIssueIds.push(issue.id);
    }
  }

  if (issuesToCreate.length > 0) {
    for (const chunk of chunkArray(issuesToCreate, ISSUE_CREATE_BATCH_SIZE)) {
      await prisma.issue.createMany({
        data: chunk,
      });
    }
  }

  await runWithConcurrency(issuesToUpdate, ISSUE_UPDATE_CONCURRENCY, async (entry) => {
    await prisma.issue.update({
      where: { id: entry.id },
      data: entry.data,
    });
  });

  const allStaleIds = Array.from(new Set([...staleIssueIds, ...duplicateIssueIds]));
  if (allStaleIds.length > 0) {
    for (const chunk of chunkArray(allStaleIds, ISSUE_CREATE_BATCH_SIZE)) {
      await prisma.issue.updateMany({
        where: { id: { in: chunk } },
        data: {
          status: "RESOLVED",
          resolvedAt: now,
        },
      });
    }
  }

  const allIssues = await prisma.issue.findMany({
    where: { projectId, status: { not: "RESOLVED" } },
    select: { severity: true, isWhitelisted: true, ruleId: true, affectedUrl: true },
  });

  const healthScore = calculateHealthScore(allIssues, pageDataList.length);

  await prisma.project.update({
    where: { id: projectId },
    data: {
      healthScore,
      totalIssues: allIssues.filter((i) => !i.isWhitelisted).length,
    },
  });

  const issueCount = issuesToCreate.length;

  console.log(
    `[Audit Engine] Audit complete: ${issueCount} new issues, health score: ${healthScore}`
  );

  return { issueCount, healthScore };
}
