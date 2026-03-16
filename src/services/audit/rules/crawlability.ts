import type { AuditRule, PageData, AuditIssue } from "../audit-engine";
import {
  normalizeComparableUrl,
} from "@/lib/url-normalization";

function normalizeUrl(url: string): string {
  try {
    return normalizeComparableUrl(url);
  } catch {
    return url.replace(/\/$/, "");
  }
}

function resolveHref(href: string, baseUrl: string): string | null {
  try {
    return normalizeUrl(new URL(href, baseUrl).href);
  } catch {
    return null;
  }
}

const pageLookupCache = new WeakMap<PageData[], Map<string, PageData>>();
const linkingPagesByTargetCache = new WeakMap<PageData[], Map<string, string[]>>();

function getPageLookup(allPages: PageData[]): Map<string, PageData> {
  const cached = pageLookupCache.get(allPages);
  if (cached) return cached;

  const lookup = new Map<string, PageData>();
  for (const p of allPages) {
    lookup.set(normalizeUrl(p.url), p);
  }

  pageLookupCache.set(allPages, lookup);
  return lookup;
}

function getLinkingPagesByTarget(allPages: PageData[]): Map<string, string[]> {
  const cached = linkingPagesByTargetCache.get(allPages);
  if (cached) return cached;

  const map = new Map<string, Set<string>>();
  for (const sourcePage of allPages) {
    if (!sourcePage.internalLinks || sourcePage.internalLinks.length === 0) continue;
    for (const link of sourcePage.internalLinks) {
      const target = resolveHref(link.href, sourcePage.url);
      if (!target) continue;
      if (!map.has(target)) {
        map.set(target, new Set());
      }
      map.get(target)!.add(sourcePage.url);
    }
  }

  const frozen = new Map<string, string[]>();
  for (const [target, sources] of map.entries()) {
    frozen.set(target, Array.from(sources));
  }
  linkingPagesByTargetCache.set(allPages, frozen);
  return frozen;
}

export const crawlabilityRules: AuditRule[] = [
  {
    id: "CRW-001",
    category: "crawlability",
    severity: "critical",
    title: "Redirect loop detected",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode === null || page.statusCode < 300 || page.statusCode >= 400) return null;

      // Check if the canonical or any redirect target points back to this page
      if (page.canonicalUrl) {
        const canonicalNorm = normalizeUrl(page.canonicalUrl);
        const pageNorm = normalizeUrl(page.url);

        // Follow the chain: if canonical target also redirects back
        const target = getPageLookup(allPages).get(canonicalNorm);
        if (target && target.canonicalUrl) {
          const targetCanonicalNorm = normalizeUrl(target.canonicalUrl);
          if (targetCanonicalNorm === pageNorm) {
            return {
              ruleId: "CRW-001",
              category: "crawlability",
              severity: "critical",
              title: "Redirect loop detected",
              description:
                "This page is part of a redirect loop where the redirect target eventually points back to this URL. Redirect loops waste crawl budget and prevent users and search engines from reaching the intended content. Fix the redirect chain so it terminates at a final 200 destination.",
              affectedUrl: page.url,
              evidence: {
                statusCode: page.statusCode,
                canonicalUrl: page.canonicalUrl,
                targetCanonicalUrl: target.canonicalUrl,
              },
            };
          }
        }
      }
      return null;
    },
  },
  {
    id: "CRW-002",
    category: "crawlability",
    severity: "high",
    title: "Broken internal link (4xx)",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode === null) return null;
      if (page.statusCode >= 400 && page.statusCode < 500) {
        const pageNorm = normalizeUrl(page.url);
        const linkingPages = pageNorm
          ? (getLinkingPagesByTarget(allPages).get(pageNorm) || [])
          : [];

        if (linkingPages.length > 0) {
          return {
            ruleId: "CRW-002",
            category: "crawlability",
            severity: "high",
            title: "Broken internal link (4xx)",
            description:
              `This URL returns a ${page.statusCode} status code and is linked to from ${linkingPages.length} internal page(s). Broken links harm user experience and waste crawl budget. Either fix the target URL, update the linking pages to point to a valid destination, or implement a redirect.`,
            affectedUrl: page.url,
            evidence: {
              statusCode: page.statusCode,
              linkingPages,
              linkingPageCount: linkingPages.length,
            },
          };
        }
      }
      return null;
    },
  },
  {
    id: "CRW-003",
    category: "crawlability",
    severity: "high",
    title: "Server error (5xx)",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode === null) return null;
      if (page.statusCode >= 500) {
        return {
          ruleId: "CRW-003",
          category: "crawlability",
          severity: "high",
          title: "Server error (5xx)",
          description:
            `This URL returns a ${page.statusCode} server error. Server errors indicate backend issues that prevent content from being served. Search engines will eventually drop pages that consistently return 5xx errors. Investigate server logs and fix the underlying issue causing the error.`,
          affectedUrl: page.url,
          evidence: {
            statusCode: page.statusCode,
          },
        };
      }
      return null;
    },
  },
  {
    id: "CRW-004",
    category: "crawlability",
    severity: "medium",
    title: "Redirect chain (3+ hops)",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode === null || page.statusCode < 300 || page.statusCode >= 400) return null;
      if (!page.canonicalUrl) return null;

      // Follow the redirect chain
      const chain: string[] = [page.url];
      let current = page.canonicalUrl;
      let hops = 1;
      const visited = new Set<string>([normalizeUrl(page.url)]);

      while (hops < 10) {
        const normalizedCurrent = normalizeUrl(current);
        if (visited.has(normalizedCurrent)) break;
        visited.add(normalizedCurrent);
        chain.push(current);

        const nextPage = getPageLookup(allPages).get(normalizedCurrent);
        if (!nextPage || nextPage.statusCode === null || nextPage.statusCode < 300 || nextPage.statusCode >= 400) break;
        if (!nextPage.canonicalUrl) break;
        current = nextPage.canonicalUrl;
        hops++;
      }

      if (hops >= 3) {
        return {
          ruleId: "CRW-004",
          category: "crawlability",
          severity: "medium",
          title: "Redirect chain (3+ hops)",
          description:
            `This URL is part of a redirect chain with ${hops} hops. Long redirect chains slow down page loading and may cause search engines to stop following the chain. Consolidate the redirects so each URL redirects directly to the final destination in a single hop.`,
          affectedUrl: page.url,
          evidence: {
            hops,
            chain: chain.slice(0, 10),
          },
        };
      }
      return null;
    },
  },
  {
    id: "CRW-005",
    category: "crawlability",
    severity: "medium",
    title: "Soft 404 detected",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode !== 200) return null;

      // Detect soft 404: page returns 200 but has very little content and error-like title
      const title = (page.title ?? "").toLowerCase();
      const softErrorPatterns = [
        "page not found",
        "404",
        "not found",
        "error",
        "page doesn't exist",
        "page does not exist",
        "no longer available",
        "oops",
      ];

      const isSoft404 = softErrorPatterns.some((pattern) => title.includes(pattern));
      const isThinContent = page.wordCount !== null && page.wordCount < 100;

      if (isSoft404 && isThinContent) {
        return {
          ruleId: "CRW-005",
          category: "crawlability",
          severity: "medium",
          title: "Soft 404 detected",
          description:
            "This page returns a 200 status code but appears to be an error page based on its title and low content. Search engines may still index it as a valid page. Return a proper 404 or 410 status code for pages that no longer exist, or add meaningful content if the page is valid.",
          affectedUrl: page.url,
          evidence: {
            statusCode: page.statusCode,
            title: page.title,
            wordCount: page.wordCount,
          },
        };
      }
      return null;
    },
  },
  {
    id: "CRW-006",
    category: "crawlability",
    severity: "low",
    title: "Excessive URL parameters",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      try {
        const url = new URL(page.url);
        const paramCount = Array.from(url.searchParams).length;
        if (paramCount > 3) {
          return {
            ruleId: "CRW-006",
            category: "crawlability",
            severity: "low",
            title: "Excessive URL parameters",
            description:
              `This URL has ${paramCount} query parameters. Excessive URL parameters can generate near-duplicate URLs that waste crawl budget and dilute link equity. Use canonical tags to consolidate parameter variations, or configure URL parameter handling in Google Search Console.`,
            affectedUrl: page.url,
            evidence: {
              paramCount,
              params: Object.fromEntries(url.searchParams),
            },
          };
        }
      } catch {
        // Invalid URL, skip
      }
      return null;
    },
  },
  {
    id: "CRW-007",
    category: "crawlability",
    severity: "high",
    title: "Mixed content URLs on page",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      const mixedContentItems: string[] = [];

      // Check images for HTTP URLs on an HTTPS page
      if (page.url.startsWith("https://") && page.images) {
        for (const img of page.images) {
          if (img.src.startsWith("http://")) {
            mixedContentItems.push(img.src);
          }
        }
      }

      // Check internal links for HTTP on an HTTPS page
      if (page.url.startsWith("https://") && page.internalLinks) {
        for (const link of page.internalLinks) {
          if (link.href.startsWith("http://")) {
            mixedContentItems.push(link.href);
          }
        }
      }

      if (mixedContentItems.length > 0) {
        return {
          ruleId: "CRW-007",
          category: "crawlability",
          severity: "high",
          title: "Mixed content URLs on page",
          description:
            `This HTTPS page references ${mixedContentItems.length} resource(s) over insecure HTTP. Mixed content can trigger browser warnings, block resource loading, and negatively impact user trust and SEO. Update all resource URLs to use HTTPS.`,
          affectedUrl: page.url,
          evidence: {
            mixedContentCount: mixedContentItems.length,
            examples: mixedContentItems,
          },
        };
      }
      return null;
    },
  },
  {
    id: "CRW-008",
    category: "crawlability",
    severity: "medium",
    title: "Very slow response time",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.responseTime === null) return null;
      if (page.responseTime > 3000) {
        return {
          ruleId: "CRW-008",
          category: "crawlability",
          severity: "medium",
          title: "Very slow response time",
          description:
            `This page took ${(page.responseTime / 1000).toFixed(1)} seconds to respond, exceeding the 3-second threshold. Slow response times hurt user experience and can cause search engines to reduce crawl rate. Optimize server performance, enable caching, reduce database queries, and consider using a CDN.`,
          affectedUrl: page.url,
          evidence: {
            responseTimeMs: page.responseTime,
            responseTimeSec: (page.responseTime / 1000).toFixed(1),
            threshold: 3000,
          },
        };
      }
      return null;
    },
  },
  {
    id: "CRW-009",
    category: "crawlability",
    severity: "high",
    title: "Page is unreachable (4xx)",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode === null) return null;
      if (page.statusCode >= 400 && page.statusCode < 500) {
        return {
          ruleId: "CRW-009",
          category: "crawlability",
          severity: "high",
          title: "Page is unreachable (4xx)",
          description:
            `This URL currently returns ${page.statusCode} and cannot be accessed as a valid page. If this URL should exist, restore content or redirect to the closest valid equivalent. If it was intentionally removed, make sure internal links and sitemaps are updated.`,
          affectedUrl: page.url,
          evidence: {
            statusCode: page.statusCode,
          },
        };
      }
      return null;
    },
  },
  {
    id: "CRW-010",
    category: "crawlability",
    severity: "medium",
    title: "Page is redirecting (3xx)",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode === null) return null;
      if (page.statusCode >= 300 && page.statusCode < 400) {
        return {
          ruleId: "CRW-010",
          category: "crawlability",
          severity: "medium",
          title: "Page is redirecting (3xx)",
          description:
            `This URL returns a ${page.statusCode} redirect response. Redirecting URLs should not be primary internal destinations. Update internal links, canonicals, and sitemap entries to use the final destination URL.`,
          affectedUrl: page.url,
          evidence: {
            statusCode: page.statusCode,
            canonicalTarget: page.canonicalUrl,
          },
        };
      }
      return null;
    },
  },
];
