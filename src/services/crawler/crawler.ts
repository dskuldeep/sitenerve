import { createHash } from "node:crypto";
import { CheerioCrawler, Configuration } from "crawlee";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { RobotsParser } from "./robots-parser";
import { extractPageData, type ExtractedPageData } from "./page-extractor";
import { computeCrawlDiff } from "./diff-engine";
import { SitemapParser } from "./sitemap-parser";
import { MAX_CRAWL_DEPTH, MAX_CRAWL_PAGES } from "@/lib/constants";
import {
  isSameSiteHostname,
  normalizeHostname,
  normalizeComparableUrl as normalizeComparableSiteUrl,
} from "@/lib/url-normalization";

interface CrawlOptions {
  projectId: string;
  siteUrl: string;
  maxDepth?: number;
  maxPages?: number;
  isInitial?: boolean;
}

interface PageSnapshot {
  url: string;
  title: string | null;
  metaDescription: string | null;
  statusCode: number | null;
  h1: string[];
  wordCount: number | null;
  contentHash: string;
}

interface CrawlFailureDetail {
  url: string;
  stage: "navigation" | "extraction" | "sitemap" | "robots" | "crawl" | "external-link-check";
  message: string;
  timestamp: string;
}

const RULE_MISSING_FROM_SITEMAP = "CRW-SITEMAP-001";
const RULE_SITEMAP_NOT_DISCOVERED = "CRW-SITEMAP-002";
const RULE_SITEMAP_MISSING_CONFIGURATION = "CRW-SITEMAP-003";
const MAX_DIAGNOSTIC_FAILURES = 100;
const MAX_SITEMAP_DIFF_URLS = 500;
const MAX_LIVE_LOG_LINES = 1200;
const MAX_LIVE_LOG_LINES_IN_DB = 350;
const CANCEL_CHECK_INTERVAL_MS = 2000;
const DEFAULT_CRAWLER_MEMORY_MBYTES = Number(process.env.CRAWLER_MEMORY_MBYTES || "1024");
const EXTERNAL_LINK_CHECK_MAX = 1200;
const EXTERNAL_LINK_CHECK_CONCURRENCY = 20;
const EXTERNAL_LINK_CHECK_TIMEOUT_MS = 10000;
const EXTERNAL_LINK_MAX_REDIRECTS = 8;
const PAGE_UPSERT_CONCURRENCY = 25;

class CrawlCancelledError extends Error {
  constructor(message: string = "Crawl cancelled by user") {
    super(message);
    this.name = "CrawlCancelledError";
  }
}

function normalizeCrawlUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hostname = normalizeHostname(parsed.hostname);
  if (
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80")
  ) {
    parsed.port = "";
  }
  parsed.hash = "";
  return parsed.href;
}

function buildContentHash(snapshot: Omit<PageSnapshot, "contentHash">): string {
  const stablePayload = JSON.stringify({
    title: snapshot.title,
    metaDescription: snapshot.metaDescription,
    statusCode: snapshot.statusCode,
    h1: snapshot.h1,
    wordCount: snapshot.wordCount,
  });

  return createHash("sha256").update(stablePayload).digest("hex");
}

function toSnapshot(data: {
  url: string;
  title: string | null;
  metaDescription: string | null;
  statusCode: number | null;
  h1: string[];
  wordCount: number | null;
}): PageSnapshot {
  const normalizedUrl = normalizeCrawlUrl(data.url);
  const base = {
    url: normalizedUrl,
    title: data.title,
    metaDescription: data.metaDescription,
    statusCode: data.statusCode,
    h1: data.h1 || [],
    wordCount: data.wordCount,
  };

  return {
    ...base,
    contentHash: buildContentHash(base),
  };
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function enqueueCrawlNotification(input: {
  type: "CRAWL_COMPLETED" | "CRAWL_FAILED";
  projectId: string;
  crawlId: string;
  errorMessage?: string;
}): Promise<void> {
  try {
    const { notificationQueue } = await import("@/lib/queue");
    await notificationQueue.add("crawl-status", input);
  } catch (error) {
    console.error("[Crawler] Failed to enqueue crawl notification:", error);
  }
}

async function syncCoverageIssue(input: {
  projectId: string;
  siteUrl: string;
  ruleId: string;
  title: string;
  description: string;
  severity: "HIGH" | "MEDIUM";
  evidence: Record<string, unknown>;
  hasIssue: boolean;
}): Promise<void> {
  const existing = await prisma.issue.findFirst({
    where: {
      projectId: input.projectId,
      ruleId: input.ruleId,
      status: { not: "RESOLVED" },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!input.hasIssue) {
    if (existing) {
      await prisma.issue.updateMany({
        where: {
          projectId: input.projectId,
          ruleId: input.ruleId,
          status: { not: "RESOLVED" },
        },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
        },
      });
    }
    return;
  }

  if (existing) {
    await prisma.issue.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        description: input.description,
        severity: input.severity,
        evidence: toInputJsonValue(input.evidence),
        lastDetectedAt: new Date(),
        resolvedAt: null,
      },
    });
    return;
  }

  await prisma.issue.create({
    data: {
      projectId: input.projectId,
      ruleId: input.ruleId,
      category: "CRAWLABILITY",
      severity: input.severity,
      title: input.title,
      description: input.description,
      affectedUrl: input.siteUrl,
      evidence: toInputJsonValue(input.evidence),
    },
  });
}

interface ExternalLinkCheckResult {
  statusCode: number;
  isBroken: boolean;
  redirectChain: string[];
  error?: string;
}

async function checkExternalLinkStatus(
  rawUrl: string,
  userAgent: string
): Promise<ExternalLinkCheckResult> {
  let currentUrl = rawUrl;
  const redirectChain: string[] = [];
  const visited = new Set<string>();

  for (let i = 0; i < EXTERNAL_LINK_MAX_REDIRECTS; i += 1) {
    if (visited.has(currentUrl)) {
      return {
        statusCode: 0,
        isBroken: true,
        redirectChain,
        error: "Redirect loop detected",
      };
    }
    visited.add(currentUrl);

    const method = i === 0 ? "HEAD" : "GET";
    try {
      const response = await fetch(currentUrl, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(EXTERNAL_LINK_CHECK_TIMEOUT_MS),
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      const statusCode = response.status;
      if (statusCode === 405 && method === "HEAD") {
        // HEAD not supported, retry as GET on same URL.
        continue;
      }

      const isRedirect = statusCode >= 300 && statusCode < 400;
      if (!isRedirect) {
        return {
          statusCode,
          isBroken: statusCode >= 400 || statusCode === 0,
          redirectChain,
        };
      }

      const location = response.headers.get("location");
      if (!location) {
        return {
          statusCode,
          isBroken: false,
          redirectChain,
        };
      }

      redirectChain.push(currentUrl);
      currentUrl = new URL(location, currentUrl).href;
    } catch (error) {
      return {
        statusCode: 0,
        isBroken: true,
        redirectChain,
        error: error instanceof Error ? error.message : "Request failed",
      };
    }
  }

  return {
    statusCode: 0,
    isBroken: true,
    redirectChain,
    error: "Too many redirects",
  };
}

async function enrichExternalLinksWithStatus(input: {
  pages: ExtractedPageData[];
  userAgent: string;
  pushLog: (message: string, level?: "INFO" | "WARN" | "ERROR") => void;
  failureDetails: CrawlFailureDetail[];
}): Promise<{
  checkedCount: number;
  brokenCount: number;
  redirectingCount: number;
}> {
  const candidateUrls: string[] = [];
  const seen = new Set<string>();

  for (const page of input.pages) {
    for (const link of page.externalLinks || []) {
      if (!link.href || !/^https?:\/\//i.test(link.href)) continue;
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      candidateUrls.push(link.href);
      if (candidateUrls.length >= EXTERNAL_LINK_CHECK_MAX) break;
    }
    if (candidateUrls.length >= EXTERNAL_LINK_CHECK_MAX) break;
  }

  if (candidateUrls.length === 0) {
    return { checkedCount: 0, brokenCount: 0, redirectingCount: 0 };
  }

  input.pushLog(
    `Checking ${candidateUrls.length} unique external links for status/redirect health`
  );

  const results = new Map<string, ExternalLinkCheckResult>();
  let index = 0;

  const worker = async () => {
    while (index < candidateUrls.length) {
      const next = candidateUrls[index];
      index += 1;
      const result = await checkExternalLinkStatus(next, input.userAgent);
      results.set(next, result);
      if (result.error && input.failureDetails.length < MAX_DIAGNOSTIC_FAILURES) {
        input.failureDetails.push({
          url: next,
          stage: "external-link-check",
          message: result.error,
          timestamp: new Date().toISOString(),
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(EXTERNAL_LINK_CHECK_CONCURRENCY, candidateUrls.length) }).map(() =>
      worker()
    )
  );

  let brokenCount = 0;
  let redirectingCount = 0;

  for (const page of input.pages) {
    page.externalLinks = (page.externalLinks || []).map((link) => {
      const result = results.get(link.href);
      if (!result) return link;

      if (result.isBroken) brokenCount += 1;
      if (result.redirectChain.length > 0 || (result.statusCode >= 300 && result.statusCode < 400)) {
        redirectingCount += 1;
      }

      return {
        ...link,
        statusCode: result.statusCode,
        isBroken: result.isBroken,
        redirectChain: result.redirectChain,
        error: result.error,
      };
    });
  }

  input.pushLog(
    `External link checks complete: checked=${candidateUrls.length}, broken=${brokenCount}, redirecting=${redirectingCount}`
  );

  return {
    checkedCount: candidateUrls.length,
    brokenCount,
    redirectingCount,
  };
}

export async function runCrawl(options: CrawlOptions): Promise<string> {
  const {
    projectId,
    siteUrl,
    maxDepth = MAX_CRAWL_DEPTH,
    maxPages = MAX_CRAWL_PAGES,
    isInitial = false,
  } = options;
  const crawlSiteUrl = normalizeCrawlUrl(siteUrl);

  // Create crawl record
  const crawl = await prisma.crawl.create({
    data: {
      projectId,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  // Update project status
  await prisma.project.update({
    where: { id: projectId },
    data: { status: "CRAWLING" },
  });

  const previousPages = await prisma.page.findMany({
    where: { projectId },
    select: {
      url: true,
      title: true,
      metaDescription: true,
      statusCode: true,
      h1: true,
      wordCount: true,
    },
  });
  const previousSnapshots = previousPages.map(toSnapshot);

  const projectConfig = await prisma.project.findUnique({
    where: { id: projectId },
    select: { sitemapUrl: true },
  });

  const robotsParser = new RobotsParser();
  await robotsParser.fetch(crawlSiteUrl);

  const siteOrigin = new URL(crawlSiteUrl).origin;
  const siteHostname = new URL(crawlSiteUrl).hostname;
  const robotsSitemaps = robotsParser.getSitemaps();
  const configuredSitemapUrl = projectConfig?.sitemapUrl || null;
  const sitemapParser = new SitemapParser(crawlSiteUrl);
  const sitemapResult = await sitemapParser.discover({
    robotsSitemaps,
    userProvidedSitemap: configuredSitemapUrl,
  });
  const sitemapPageUrls = sitemapResult.pageUrls
    .map((url) => {
      try {
        return normalizeCrawlUrl(url);
      } catch {
        return null;
      }
    })
    .filter((url): url is string => Boolean(url))
    .filter((url) => {
      try {
        return isSameSiteHostname(new URL(url).hostname, siteHostname);
      } catch {
        return false;
      }
    });
  const sitemapNotConfigured = sitemapResult.sitemapUrlsDiscovered.length === 0;

  const normalizedSiteUrl = normalizeCrawlUrl(crawlSiteUrl);
  const seedUrls = new Set<string>([normalizedSiteUrl]);
  for (const sitemapPageUrl of sitemapPageUrls) {
    if (seedUrls.size >= maxPages) break;
    seedUrls.add(sitemapPageUrl);
  }

  const seedRequests = Array.from(seedUrls).map((url) => ({
    url,
    userData: {
      depth: 0,
      source: url === normalizedSiteUrl ? "root" : "sitemap",
    },
  }));
  const scheduledUrls = new Set<string>(Array.from(seedUrls));

  const sitemapSeedSet = new Set<string>(
    Array.from(seedUrls).filter((url) => url !== normalizedSiteUrl)
  );

  const visitedUrls = new Set<string>();
  const discoveredByLinks = new Set<string>();
  const extractedPages: ExtractedPageData[] = [];
  const failureDetails: CrawlFailureDetail[] = [];
  const crawlLogs: string[] = [];
  let crawlPhase:
    | "initializing"
    | "loading_robots"
    | "discovering_sitemaps"
    | "crawling"
    | "persisting"
    | "cancelled"
    | "completed"
    | "failed" = "initializing";
  let errorCount = 0;
  let progressUpdateInFlight = false;
  let lastProgressUpdatedAt = Date.now();
  let lastCancelCheckAt = 0;
  let cancellationRequested = false;
  let cancellationLogEmitted = false;
  let hardLimitLogEmitted = false;
  let crawler: CheerioCrawler | null = null;

  const pushLog = (message: string, level: "INFO" | "WARN" | "ERROR" = "INFO"): void => {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    crawlLogs.push(line);
    if (crawlLogs.length > MAX_LIVE_LOG_LINES) {
      crawlLogs.splice(0, crawlLogs.length - MAX_LIVE_LOG_LINES);
    }
  };

  const checkCancellationRequest = async (force = false): Promise<boolean> => {
    if (cancellationRequested) return true;

    const now = Date.now();
    if (!force && now - lastCancelCheckAt < CANCEL_CHECK_INTERVAL_MS) {
      return false;
    }
    lastCancelCheckAt = now;

    try {
      const crawlState = await prisma.crawl.findUnique({
        where: { id: crawl.id },
        select: { status: true },
      });

      if (crawlState?.status === "CANCELLED") {
        cancellationRequested = true;
        if (!cancellationLogEmitted) {
          pushLog("Cancellation requested by user. Stopping crawl...", "WARN");
          cancellationLogEmitted = true;
        }
      }
    } catch {
      // Ignore cancellation polling errors.
    }

    return cancellationRequested;
  };

  const abortCrawlerIfRequested = async (): Promise<void> => {
    if (!cancellationRequested || !crawler) return;
    const pool = (
      crawler as unknown as { autoscaledPool?: { abort: () => Promise<void> } }
    ).autoscaledPool;
    if (!pool) return;
    await pool.abort();
  };

  const finalizeCancelled = async (reason: string): Promise<string> => {
    crawlPhase = "cancelled";
    pushLog(`Crawl cancelled: ${reason}`, "WARN");

    await prisma.crawl.update({
      where: { id: crawl.id },
      data: {
        status: "CANCELLED",
        errorMessage: reason,
        errorCount,
        completedAt: new Date(),
        diff: toInputJsonValue({
          mode: "robots-and-user-sitemap-seeded-link-discovery",
          failureDetails,
          logs: crawlLogs.slice(-MAX_LIVE_LOG_LINES_IN_DB),
          live: {
            phase: "cancelled",
            visitedUrls: visitedUrls.size,
            extractedPages: extractedPages.length,
            errorCount,
            logs: crawlLogs.slice(-MAX_LIVE_LOG_LINES_IN_DB),
            updatedAt: new Date().toISOString(),
          },
        }),
      },
    });

    await prisma.project.update({
      where: { id: projectId },
      data: { status: "ACTIVE" },
    });

    return crawl.id;
  };

  pushLog(`Crawl started for ${crawlSiteUrl}`);
  crawlPhase = "loading_robots";
  pushLog("robots.txt step completed");

  for (const sitemapError of sitemapResult.errors) {
    if (failureDetails.length >= MAX_DIAGNOSTIC_FAILURES) break;
    failureDetails.push({
      url: sitemapError.sitemapUrl,
      stage: "sitemap",
      message: sitemapError.message,
      timestamp: new Date().toISOString(),
    });
    pushLog(`Sitemap fetch error for ${sitemapError.sitemapUrl}: ${sitemapError.message}`, "WARN");
  }

  if (!robotsParser.hasRobotsTxt() && robotsParser.getFetchError()) {
    failureDetails.push({
      url: robotsParser.getRobotsUrl() || `${siteOrigin}/robots.txt`,
      stage: "robots",
      message: robotsParser.getFetchError()!,
      timestamp: new Date().toISOString(),
    });
    pushLog(
      `robots.txt unavailable (${robotsParser.getFetchError()}) - continuing with permissive crawl`,
      "WARN"
    );
  } else {
    pushLog("robots.txt loaded successfully");
  }
  crawlPhase = "discovering_sitemaps";
  pushLog(
    `Sitemap sources: ${robotsSitemaps.length} from robots.txt, ${configuredSitemapUrl ? "1" : "0"} user-provided`
  );
  pushLog(
    `Sitemap discovery complete: ${sitemapResult.sitemapUrlsDiscovered.length} discovered, ${sitemapResult.sitemapUrlsParsed.length} parsed, ${sitemapPageUrls.length} sitemap URLs found`
  );
  if (sitemapNotConfigured) {
    const missingSitemapMessage =
      "No sitemap URL found in robots.txt and no sitemap URL was configured for this project.";
    if (failureDetails.length < MAX_DIAGNOSTIC_FAILURES) {
      failureDetails.push({
        url: robotsParser.getRobotsUrl() || `${siteOrigin}/robots.txt`,
        stage: "sitemap",
        message: missingSitemapMessage,
        timestamp: new Date().toISOString(),
      });
    }
    pushLog(`${missingSitemapMessage} Continuing with root URL + link discovery crawl.`, "WARN");
  }
  if (sitemapPageUrls.length === 0) {
    pushLog("No crawlable page URLs were discovered in sitemap sources.", "WARN");
  }

  const config = new Configuration({
    persistStorage: false,
    purgeOnStart: true,
    memoryMbytes:
      Number.isFinite(DEFAULT_CRAWLER_MEMORY_MBYTES) && DEFAULT_CRAWLER_MEMORY_MBYTES > 0
        ? DEFAULT_CRAWLER_MEMORY_MBYTES
        : 1024,
  });

  const updateProgress = async (force = false): Promise<void> => {
    const now = Date.now();
    if (!force && now - lastProgressUpdatedAt < 4000) return;
    if (progressUpdateInFlight) return;

    progressUpdateInFlight = true;
    lastProgressUpdatedAt = now;

    try {
      await prisma.crawl.update({
        where: { id: crawl.id },
        data: {
          totalPages: visitedUrls.size,
          errorCount,
          diff: toInputJsonValue({
            live: {
              phase: crawlPhase,
              visitedUrls: visitedUrls.size,
              extractedPages: extractedPages.length,
              errorCount,
              logs: crawlLogs.slice(-MAX_LIVE_LOG_LINES_IN_DB),
              updatedAt: new Date().toISOString(),
            },
          }),
        },
      });

      if (await checkCancellationRequest()) {
        await abortCrawlerIfRequested();
      }
    } catch {
      // Ignore transient progress update failures.
    } finally {
      progressUpdateInFlight = false;
    }
  };

  crawler = new CheerioCrawler(
    {
      maxConcurrency: 50,
      maxRequestsPerCrawl: maxPages,
      maxRequestsPerMinute: 2000,
      maxRequestRetries: 2,
      requestHandlerTimeoutSecs: 60,
      navigationTimeoutSecs: 45,

      async requestHandler({ request, $, response, enqueueLinks, log, body }) {
        if (await checkCancellationRequest()) return;

        const url = normalizeCrawlUrl(request.loadedUrl || request.url);
        if (!scheduledUrls.has(url)) {
          if (scheduledUrls.size >= maxPages) return;
          scheduledUrls.add(url);
        }

        if (visitedUrls.has(url)) return;
        if (visitedUrls.size >= maxPages) {
          if (!hardLimitLogEmitted) {
            hardLimitLogEmitted = true;
            pushLog(`Hard page limit reached (${maxPages}). Finalizing crawl frontier.`);
          }
          return;
        }

        const depth = (request.userData?.depth as number) ?? 0;
        const source = (request.userData?.source as string) ?? "link";
        if (depth > maxDepth) return;

        if (!robotsParser.isAllowed(url)) {
          pushLog(`Blocked by robots.txt: ${url}`, "WARN");
          log.info(`Blocked by robots.txt: ${url}`);
          return;
        }

        visitedUrls.add(url);
        if (source === "link") {
          discoveredByLinks.add(url);
        }
        pushLog(`Crawling ${url}`);
        void updateProgress();

        const startTime = Date.now();
        const statusCode = response?.statusCode || 200;
        const responseTime = Date.now() - startTime; // Cheerio is instantaneous post-fetch, so estimate 0 or small
        const pageContent = body.toString();
        const pageSize = Buffer.byteLength(pageContent, "utf-8");

        // --- Enqueue discovered links BEFORE extraction ---
        // This ensures link discovery works even if extraction throws
        let enqueuedCount = 0;
        if (depth < maxDepth) {
          try {
            const result = await enqueueLinks({
              strategy: "same-domain",
              userData: { depth: depth + 1, source: "link" },
              transformRequestFunction: (req) => {
                let normalizedReqUrl: string;
                try {
                  normalizedReqUrl = normalizeCrawlUrl(req.url);
                } catch {
                  return false;
                }

                if (visitedUrls.has(normalizedReqUrl) || visitedUrls.size >= maxPages) {
                  return false;
                }
                if (scheduledUrls.has(normalizedReqUrl) || scheduledUrls.size >= maxPages) {
                  return false;
                }
                if (cancellationRequested) {
                  return false;
                }
                if (!robotsParser.isAllowed(normalizedReqUrl)) {
                  return false;
                }
                scheduledUrls.add(normalizedReqUrl);
                req.url = normalizedReqUrl;
                req.userData = {
                  ...(req.userData || {}),
                  depth: depth + 1,
                  source: "link",
                };
                return req;
              },
            });
            enqueuedCount = result.processedRequests.length;
          } catch (linkError) {
            pushLog(
              `enqueueLinks failed for ${url}: ${linkError instanceof Error ? linkError.message : "unknown"}`,
              "WARN"
            );
          }

          // Fallback: if enqueueLinks found nothing, manually extract <a> hrefs
          if (enqueuedCount === 0) {
            try {
              const pageLinks = $("a[href]")
                .map((_, a) => {
                  try {
                    return new URL($(a).attr("href")!, url).href;
                  } catch {
                    return null;
                  }
                })
                .get()
                .filter((href): href is string => {
                  if (!href) return false;
                  try {
                    const u = new URL(href);
                    return isSameSiteHostname(u.hostname, siteHostname) && u.protocol.startsWith("http");
                  } catch {
                    return false;
                  }
                });

              const uniqueLinks = [...new Set(pageLinks)];
              pushLog(
                `enqueueLinks found 0, manual fallback found ${uniqueLinks.length} links on ${url}`
              );

              if (uniqueLinks.length > 0) {
                const fallbackRequests = uniqueLinks
                  .map((href) => {
                    try {
                      const normalizedHref = normalizeCrawlUrl(href);
                      if (visitedUrls.has(normalizedHref) || visitedUrls.size >= maxPages) return null;
                      if (scheduledUrls.has(normalizedHref) || scheduledUrls.size >= maxPages) return null;
                      if (!robotsParser.isAllowed(normalizedHref)) return null;
                      scheduledUrls.add(normalizedHref);
                      return {
                        url: normalizedHref,
                        userData: { depth: depth + 1, source: "link" },
                      };
                    } catch {
                      return null;
                    }
                  })
                  .filter(Boolean) as Array<{ url: string; userData: Record<string, unknown> }>;

                if (fallbackRequests.length > 0) {
                  await crawler!.addRequests(fallbackRequests);
                  pushLog(`Manually enqueued ${fallbackRequests.length} links from ${url}`);
                }
              }
            } catch (fallbackError) {
              pushLog(
                `Manual link extraction failed for ${url}: ${fallbackError instanceof Error ? fallbackError.message : "unknown"}`,
                "WARN"
              );
            }
          }
        }

        // --- Extract page data ---
        try {
          const pageData = extractPageData(
            $,
            url,
            siteOrigin,
            responseTime,
            statusCode,
            pageSize
          );
          extractedPages.push(pageData);
          pushLog(
            `Extracted ${url} (status=${statusCode}, links=${pageData.internalLinks.length}, enqueued=${enqueuedCount}, words=${pageData.wordCount})`
          );
        } catch (error) {
          errorCount++;
          if (failureDetails.length < MAX_DIAGNOSTIC_FAILURES) {
            failureDetails.push({
              url,
              stage: "extraction",
              message: error instanceof Error ? error.message : "Unknown extraction error",
              timestamp: new Date().toISOString(),
            });
          }
          pushLog(
            `Extraction failed for ${url}: ${error instanceof Error ? error.message : "Unknown extraction error"}`,
            "ERROR"
          );
          log.error(`Error extracting page data from ${url}: ${error}`);
        }
      },

      async failedRequestHandler({ request, log }) {
        errorCount++;
        if (failureDetails.length < MAX_DIAGNOSTIC_FAILURES) {
          const lastError = request.errorMessages?.[request.errorMessages.length - 1];
          failureDetails.push({
            url: request.url,
            stage: "navigation",
            message: lastError || "Request failed after retries",
            timestamp: new Date().toISOString(),
          });
        }
        pushLog(
          `Request failed for ${request.url}: ${request.errorMessages?.[request.errorMessages.length - 1] || "Request failed after retries"}`,
          "ERROR"
        );
        log.error(`Request failed: ${request.url}`);
      },
    },
    config
  );

  const cancellationWatcher = setInterval(() => {
    void (async () => {
      try {
        const shouldCancel = await checkCancellationRequest(true);
        if (shouldCancel) {
          await abortCrawlerIfRequested();
        }
      } catch {
        // Ignore cancellation watcher errors.
      }
    })();
  }, CANCEL_CHECK_INTERVAL_MS);

  try {
    crawlPhase = "crawling";
    pushLog(
      `Starting crawl frontier with ${seedUrls.size} seed URLs (${sitemapSeedSet.size} from sitemap)`
    );
    await updateProgress(true);
    await crawler.run(seedRequests);
    await updateProgress(true);

    if (await checkCancellationRequest(true)) {
      return await finalizeCancelled("Cancelled by user");
    }

    if (extractedPages.length === 0) {
      const rootBlocked = !robotsParser.isAllowed(normalizedSiteUrl);
      const failureHint = rootBlocked
        ? "Root URL is blocked by robots.txt."
        : failureDetails[0]?.message || "No page content could be extracted from any crawled request.";
      throw new Error(`Crawl extracted 0 pages. ${failureHint}`);
    }

    const externalLinkCheckStats = await enrichExternalLinksWithStatus({
      pages: extractedPages,
      userAgent: "Mozilla/5.0 (compatible; SiteNerveAuditBot/1.0; +https://sitenerve.app/bot)",
      pushLog,
      failureDetails,
    });

    crawlPhase = "persisting";
    pushLog("Persisting crawl results to database");

    const currentSnapshots = extractedPages.map((pageData) =>
      toSnapshot({
        url: pageData.url,
        title: pageData.title,
        metaDescription: pageData.metaDescription,
        statusCode: pageData.statusCode,
        h1: pageData.h1,
        wordCount: pageData.wordCount,
      })
    );

    const previousSnapshotByUrl = new Map(
      previousSnapshots.map((snapshot) => [normalizeComparableSiteUrl(snapshot.url), snapshot])
    );

    const currentSnapshotByUrl = new Map(
      currentSnapshots.map((snapshot) => [normalizeComparableSiteUrl(snapshot.url), snapshot])
    );

    const diff = computeCrawlDiff(
      previousSnapshots.map((snapshot) => ({
        url: normalizeComparableSiteUrl(snapshot.url),
        title: snapshot.title,
        metaDescription: snapshot.metaDescription,
        statusCode: snapshot.statusCode,
        h1: snapshot.h1,
      })),
      currentSnapshots.map((snapshot) => ({
        url: normalizeComparableSiteUrl(snapshot.url),
        title: snapshot.title,
        metaDescription: snapshot.metaDescription,
        statusCode: snapshot.statusCode,
        h1: snapshot.h1,
      }))
    );

    const contentChangedPages = Array.from(currentSnapshotByUrl.entries())
      .filter(([url, currentSnapshot]) => {
        const previousSnapshot = previousSnapshotByUrl.get(url);
        if (!previousSnapshot) return false;
        return previousSnapshot.contentHash !== currentSnapshot.contentHash;
      })
      .map(([url, snapshot]) => ({
        url,
        previousHash: previousSnapshotByUrl.get(url)?.contentHash,
        currentHash: snapshot.contentHash,
      }));

    const sitemapComparable = new Set(
      sitemapPageUrls.map((url) => normalizeComparableSiteUrl(url))
    );
    const crawledComparable = new Set(
      currentSnapshots.map((snapshot) => normalizeComparableSiteUrl(snapshot.url))
    );
    const hasSitemapCoverageBaseline = sitemapComparable.size > 0;

    const missingFromSitemap = hasSitemapCoverageBaseline
      ? Array.from(crawledComparable).filter((url) => !sitemapComparable.has(url))
      : [];
    const sitemapOnlyUrls = hasSitemapCoverageBaseline
      ? Array.from(sitemapComparable).filter((url) => !crawledComparable.has(url))
      : [];

    const changedUrlSet = new Set<string>([
      ...diff.changedPages.map((page) => page.url),
      ...contentChangedPages.map((page) => page.url),
    ]);

    // Store pages in database (parallelized with bounded concurrency).
    const crawlPageRows: Array<{ crawlId: string; pageId: string }> = [];
    let upsertIndex = 0;
    const upsertWorkers = Math.min(PAGE_UPSERT_CONCURRENCY, extractedPages.length);

    const upsertPageWorker = async (): Promise<void> => {
      while (upsertIndex < extractedPages.length) {
        const currentIndex = upsertIndex;
        upsertIndex += 1;
        const pageData = extractedPages[currentIndex];
        if (!pageData) break;

        const now = new Date();
        const page = await prisma.page.upsert({
          where: {
            projectId_url: {
              projectId,
              url: pageData.url,
            },
          },
          create: {
            projectId,
            url: pageData.url,
            canonicalUrl: pageData.canonicalUrl,
            statusCode: pageData.statusCode,
            responseTime: pageData.responseTime,
            title: pageData.title,
            metaDescription: pageData.metaDescription,
            metaRobots: pageData.metaRobots,
            h1: pageData.h1,
            h2: pageData.h2,
            h3: pageData.h3,
            h4: pageData.h4,
            h5: pageData.h5,
            h6: pageData.h6,
            ogTags: pageData.ogTags,
            jsonLd: toInputJsonValue(pageData.jsonLd),
            internalLinks: toInputJsonValue(pageData.internalLinks),
            externalLinks: toInputJsonValue(pageData.externalLinks),
            images: toInputJsonValue(pageData.images),
            wordCount: pageData.wordCount,
            hreflangTags: toInputJsonValue(pageData.hreflangTags),
            pageSize: pageData.pageSize,
            lastCrawledAt: now,
          },
          update: {
            canonicalUrl: pageData.canonicalUrl,
            statusCode: pageData.statusCode,
            responseTime: pageData.responseTime,
            title: pageData.title,
            metaDescription: pageData.metaDescription,
            metaRobots: pageData.metaRobots,
            h1: pageData.h1,
            h2: pageData.h2,
            h3: pageData.h3,
            h4: pageData.h4,
            h5: pageData.h5,
            h6: pageData.h6,
            ogTags: pageData.ogTags,
            jsonLd: toInputJsonValue(pageData.jsonLd),
            internalLinks: toInputJsonValue(pageData.internalLinks),
            externalLinks: toInputJsonValue(pageData.externalLinks),
            images: toInputJsonValue(pageData.images),
            wordCount: pageData.wordCount,
            hreflangTags: toInputJsonValue(pageData.hreflangTags),
            pageSize: pageData.pageSize,
            lastCrawledAt: now,
          },
        });

        crawlPageRows.push({ crawlId: crawl.id, pageId: page.id });
      }
    };

    if (upsertWorkers > 0) {
      await Promise.all(Array.from({ length: upsertWorkers }, () => upsertPageWorker()));
    }

    if (crawlPageRows.length > 0) {
      await prisma.crawlPage.createMany({
        data: crawlPageRows,
        skipDuplicates: true,
      });
    }

    await syncCoverageIssue({
      projectId,
      siteUrl: siteOrigin,
      ruleId: RULE_MISSING_FROM_SITEMAP,
      title: "Pages discovered by crawling but missing from XML sitemap",
      description:
        "Some internal pages are crawlable and discovered from links, but they are not listed in the XML sitemap. This can lead to weaker indexing coverage and delayed discovery for important URLs.",
      severity: "HIGH",
      evidence: {
        missingCount: missingFromSitemap.length,
        examples: missingFromSitemap.slice(0, 25),
        hasSitemapCoverageBaseline,
      },
      hasIssue: hasSitemapCoverageBaseline && missingFromSitemap.length > 0,
    });

    await syncCoverageIssue({
      projectId,
      siteUrl: siteOrigin,
      ruleId: RULE_SITEMAP_NOT_DISCOVERED,
      title: "URLs listed in XML sitemap were not discovered during crawl",
      description:
        "Some sitemap URLs were not reached during this crawl run. This may indicate redirects, canonical inconsistencies, blocked URLs, or stale sitemap entries.",
      severity: "MEDIUM",
      evidence: {
        missingCount: sitemapOnlyUrls.length,
        examples: sitemapOnlyUrls.slice(0, 25),
        hasSitemapCoverageBaseline,
      },
      hasIssue: hasSitemapCoverageBaseline && sitemapOnlyUrls.length > 0,
    });

    await syncCoverageIssue({
      projectId,
      siteUrl: siteOrigin,
      ruleId: RULE_SITEMAP_MISSING_CONFIGURATION,
      title: "No XML sitemap source configured for crawl",
      description:
        "No sitemap URL was found in robots.txt, and no sitemap URL is configured for this project. Add a sitemap URL so crawl coverage and sitemap diagnostics can run accurately.",
      severity: "MEDIUM",
      evidence: {
        robotsTxtUrl: robotsParser.getRobotsUrl(),
        robotsTxtFound: robotsParser.hasRobotsTxt(),
        robotsTxtSitemapCount: robotsSitemaps.length,
        userProvidedSitemapUrl: configuredSitemapUrl,
      },
      hasIssue: sitemapNotConfigured,
    });

    const crawlDiagnostics = {
      crawlType: isInitial ? "initial" : "manual_or_scheduled",
      mode: "robots-and-user-sitemap-seeded-link-discovery",
      robots: {
        url: robotsParser.getRobotsUrl(),
        found: robotsParser.hasRobotsTxt(),
        fetchError: robotsParser.getFetchError(),
      },
      sitemap: {
        sourceSummary: sitemapResult.sourceSummary,
        userProvidedSitemap: configuredSitemapUrl,
        missingSitemapConfiguration: sitemapNotConfigured,
        discoveredSitemaps: sitemapResult.sitemapUrlsDiscovered,
        parsedSitemaps: sitemapResult.sitemapUrlsParsed,
        sitemapErrors: sitemapResult.errors,
        sitemapUrlCount: sitemapPageUrls.length,
      },
      coverage: {
        hasSitemapCoverageBaseline,
        crawledPages: currentSnapshots.length,
        missingFromSitemapCount: missingFromSitemap.length,
        missingFromSitemap: missingFromSitemap.slice(0, MAX_SITEMAP_DIFF_URLS),
        sitemapOnlyCount: sitemapOnlyUrls.length,
        sitemapOnly: sitemapOnlyUrls.slice(0, MAX_SITEMAP_DIFF_URLS),
      },
      discovery: {
        seedUrlCount: seedUrls.size,
        sitemapSeedCount: sitemapSeedSet.size,
        discoveredViaLinksCount: discoveredByLinks.size,
      },
      externalLinkChecks: externalLinkCheckStats,
      content: {
        previousSnapshotCount: previousSnapshots.length,
        currentSnapshotCount: currentSnapshots.length,
        contentChangedCount: contentChangedPages.length,
        contentChangedPages: contentChangedPages.slice(0, MAX_SITEMAP_DIFF_URLS),
      },
      crawlDiff: diff,
      failureDetails,
      logs: crawlLogs.slice(-MAX_LIVE_LOG_LINES_IN_DB),
      live: {
        phase: "completed",
        visitedUrls: visitedUrls.size,
        extractedPages: currentSnapshots.length,
        errorCount,
        logs: crawlLogs.slice(-MAX_LIVE_LOG_LINES_IN_DB),
        updatedAt: new Date().toISOString(),
      },
      pageSnapshots: currentSnapshots,
    };

    // Update crawl record
    await prisma.crawl.update({
      where: { id: crawl.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        totalPages: extractedPages.length,
        newPages: diff.newPages.length,
        removedPages: diff.removedPages.length,
        changedPages: changedUrlSet.size,
        errorCount,
        diff: toInputJsonValue(crawlDiagnostics),
      },
    });
    crawlPhase = "completed";
    pushLog(
      `Crawl completed: pages=${extractedPages.length}, new=${diff.newPages.length}, removed=${diff.removedPages.length}, changed=${changedUrlSet.size}`
    );

    // Keep project in CRAWLING while downstream pipeline (audit/keywords/graph/agents) runs.
    // crawl-worker will mark ACTIVE when all post-crawl processing has completed.
    const totalPages = await prisma.page.count({ where: { projectId } });
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: "CRAWLING",
        lastCrawlAt: new Date(),
        totalPages,
      },
    });

    await enqueueCrawlNotification({
      type: "CRAWL_COMPLETED",
      projectId,
      crawlId: crawl.id,
    });
  } catch (error) {
    if (await checkCancellationRequest(true) || error instanceof CrawlCancelledError) {
      return await finalizeCancelled("Cancelled by user");
    }

    crawlPhase = "failed";
    const rawErrorMessage =
      error instanceof Error ? error.message : "Unknown crawl error";
    const errorMessage = rawErrorMessage.includes("spawn ps ENOENT")
      ? `${rawErrorMessage}. Worker environment missing 'ps' binary (install procps and restart worker).`
      : rawErrorMessage;
    pushLog(`Crawl failed: ${errorMessage}`, "ERROR");
    if (failureDetails.length < MAX_DIAGNOSTIC_FAILURES) {
      failureDetails.push({
        url: crawlSiteUrl,
        stage: "crawl",
        message: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }

    await prisma.crawl.update({
      where: { id: crawl.id },
      data: {
        status: "FAILED",
        errorMessage,
        errorCount,
        completedAt: new Date(),
        diff: toInputJsonValue({
          mode: "robots-and-user-sitemap-seeded-link-discovery",
          robots: {
            url: robotsParser.getRobotsUrl(),
            found: robotsParser.hasRobotsTxt(),
            fetchError: robotsParser.getFetchError(),
          },
          sitemap: {
            sourceSummary: sitemapResult.sourceSummary,
            userProvidedSitemap: configuredSitemapUrl,
            missingSitemapConfiguration: sitemapNotConfigured,
            discoveredSitemaps: sitemapResult.sitemapUrlsDiscovered,
            parsedSitemaps: sitemapResult.sitemapUrlsParsed,
            sitemapErrors: sitemapResult.errors,
          },
          failureDetails,
          logs: crawlLogs.slice(-MAX_LIVE_LOG_LINES_IN_DB),
          live: {
            phase: "failed",
            visitedUrls: visitedUrls.size,
            extractedPages: extractedPages.length,
            errorCount,
            logs: crawlLogs.slice(-MAX_LIVE_LOG_LINES_IN_DB),
            updatedAt: new Date().toISOString(),
          },
        }),
      },
    });

    await prisma.project.update({
      where: { id: projectId },
      data: { status: "ERROR" },
    });

    await enqueueCrawlNotification({
      type: "CRAWL_FAILED",
      projectId,
      crawlId: crawl.id,
      errorMessage,
    });

    throw error;
  } finally {
    clearInterval(cancellationWatcher);
  }

  return crawl.id;
}
