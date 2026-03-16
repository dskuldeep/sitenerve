import type { AuditRule, PageData, AuditIssue } from "../audit-engine";
import {
  normalizeComparableUrl,
} from "@/lib/url-normalization";

const pageByNormalizedUrlCache = new WeakMap<PageData[], Map<string, PageData>>();
const inboundInternalLinkCountCache = new WeakMap<PageData[], Map<string, number>>();

function normalizeUrl(url: string, baseUrl?: string): string | null {
  try {
    return normalizeComparableUrl(url, baseUrl);
  } catch {
    return null;
  }
}

function getPageByNormalizedUrl(allPages: PageData[]): Map<string, PageData> {
  const cached = pageByNormalizedUrlCache.get(allPages);
  if (cached) return cached;

  const map = new Map<string, PageData>();
  for (const p of allPages) {
    const normalized = normalizeUrl(p.url);
    if (!normalized) continue;
    map.set(normalized, p);
  }

  pageByNormalizedUrlCache.set(allPages, map);
  return map;
}

function getInboundInternalLinkCount(allPages: PageData[]): Map<string, number> {
  const cached = inboundInternalLinkCountCache.get(allPages);
  if (cached) return cached;

  const counts = new Map<string, number>();
  for (const sourcePage of allPages) {
    if (!sourcePage.internalLinks || sourcePage.internalLinks.length === 0) continue;
    for (const link of sourcePage.internalLinks) {
      const target = normalizeUrl(link.href, sourcePage.url);
      if (!target) continue;
      counts.set(target, (counts.get(target) || 0) + 1);
    }
  }

  inboundInternalLinkCountCache.set(allPages, counts);
  return counts;
}

export const indexabilityRules: AuditRule[] = [
  {
    id: "IDX-001",
    category: "indexability",
    severity: "critical",
    title: "Page blocked by robots meta tag",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.metaRobots) return null;
      const directives = page.metaRobots.toLowerCase().split(",").map((d) => d.trim());
      if (directives.includes("noindex")) {
        return {
          ruleId: "IDX-001",
          category: "indexability",
          severity: "critical",
          title: "Page blocked by robots meta tag",
          description:
            "This page has a 'noindex' directive in its meta robots tag, which prevents search engines from indexing it. If this page should appear in search results, remove the noindex directive from the meta robots tag or the X-Robots-Tag HTTP header.",
          affectedUrl: page.url,
          evidence: {
            metaRobots: page.metaRobots,
            detectedDirectives: directives,
          },
        };
      }
      return null;
    },
  },
  {
    id: "IDX-002",
    category: "indexability",
    severity: "high",
    title: "Noindex on key page",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.metaRobots) return null;
      const directives = page.metaRobots.toLowerCase().split(",").map((d) => d.trim());
      if (!directives.includes("noindex")) return null;

      // Consider a page "key" if it has significant content or is linked to by many pages
      const isKeyPage =
        (page.wordCount !== null && page.wordCount > 500) ||
        (page.title !== null && page.title.length > 0) ||
        (page.h1.length > 0);

      if (isKeyPage) {
        return {
          ruleId: "IDX-002",
          category: "indexability",
          severity: "high",
          title: "Noindex on key page",
          description:
            "This page has substantial content (title, H1, or significant word count) but is marked as noindex. This may unintentionally hide valuable content from search engines. Review whether the noindex directive is intentional for this page.",
          affectedUrl: page.url,
          evidence: {
            metaRobots: page.metaRobots,
            wordCount: page.wordCount,
            title: page.title,
            h1Count: page.h1.length,
          },
        };
      }
      return null;
    },
  },
  {
    id: "IDX-003",
    category: "indexability",
    severity: "medium",
    title: "Orphan page (no inbound internal links)",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      const pageUrl = normalizeUrl(page.url);
      if (!pageUrl) return null;
      const inboundCount = getInboundInternalLinkCount(allPages).get(pageUrl) || 0;
      const hasInboundLink = inboundCount > 0;

      if (!hasInboundLink) {
        return {
          ruleId: "IDX-003",
          category: "indexability",
          severity: "medium",
          title: "Orphan page (no inbound internal links)",
          description:
            "No other crawled page links to this URL. Orphan pages are difficult for search engines to discover and may not get indexed. Add internal links from relevant pages to ensure this content is discoverable by both users and crawlers.",
          affectedUrl: page.url,
          evidence: {
            totalPagesChecked: allPages.length,
            inboundLinkCount: 0,
          },
        };
      }
      return null;
    },
  },
  {
    id: "IDX-004",
    category: "indexability",
    severity: "medium",
    title: "Non-200 canonical target",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      if (!page.canonicalUrl) return null;
      const pageNorm = normalizeUrl(page.url);
      const canonicalNorm = normalizeUrl(page.canonicalUrl, page.url);
      if (!pageNorm || !canonicalNorm || pageNorm === canonicalNorm) return null;

      const canonicalTarget = getPageByNormalizedUrl(allPages).get(canonicalNorm);

      if (canonicalTarget && canonicalTarget.statusCode !== null && canonicalTarget.statusCode !== 200) {
        return {
          ruleId: "IDX-004",
          category: "indexability",
          severity: "medium",
          title: "Non-200 canonical target",
          description:
            "The canonical URL specified on this page does not return a 200 status code. Search engines may ignore the canonical signal or index the wrong URL. Ensure the canonical target URL is accessible and returns a 200 status.",
          affectedUrl: page.url,
          evidence: {
            canonicalUrl: page.canonicalUrl,
            canonicalStatusCode: canonicalTarget.statusCode,
          },
        };
      }
      return null;
    },
  },
  {
    id: "IDX-005",
    category: "indexability",
    severity: "high",
    title: "Missing from sitemap but linked internally",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      // Check if this page is linked to by other pages but might not be in the sitemap
      // We detect this by looking for pages that have no canonical set but are linked internally
      const pageUrl = normalizeUrl(page.url);
      if (!pageUrl) return null;
      const inboundLinkCount = getInboundInternalLinkCount(allPages).get(pageUrl) || 0;

      // If the page has good content and inbound links but returns a non-standard status,
      // it may indicate it should be in the sitemap but isn't properly configured
      if (
        inboundLinkCount >= 3 &&
        page.statusCode === 200 &&
        page.metaRobots === null &&
        page.canonicalUrl === null
      ) {
        return {
          ruleId: "IDX-005",
          category: "indexability",
          severity: "high",
          title: "Missing from sitemap but linked internally",
          description:
            "This page is linked to from multiple internal pages but lacks a canonical URL and may not be included in the XML sitemap. Pages with significant internal link equity should be included in the sitemap to ensure consistent crawling and indexing. Add this URL to your XML sitemap and set a self-referencing canonical tag.",
          affectedUrl: page.url,
          evidence: {
            inboundLinkCount,
            hasCanonical: false,
            statusCode: page.statusCode,
          },
        };
      }
      return null;
    },
  },
  {
    id: "IDX-006",
    category: "indexability",
    severity: "medium",
    title: "Nofollow on internal links",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.metaRobots) return null;
      const directives = page.metaRobots.toLowerCase().split(",").map((d) => d.trim());
      if (directives.includes("nofollow")) {
        const internalLinkCount = page.internalLinks?.length ?? 0;
        if (internalLinkCount > 0) {
          return {
            ruleId: "IDX-006",
            category: "indexability",
            severity: "medium",
            title: "Nofollow on internal links",
            description:
              "This page has a 'nofollow' meta robots directive, which prevents search engines from following any links on this page. This wastes internal link equity and may prevent important pages from being discovered. Remove the nofollow directive unless you have a specific reason to block link crawling from this page.",
            affectedUrl: page.url,
            evidence: {
              metaRobots: page.metaRobots,
              internalLinkCount,
            },
          };
        }
      }
      return null;
    },
  },
  {
    id: "IDX-007",
    category: "indexability",
    severity: "low",
    title: "Page too deep in site architecture",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      // Estimate depth from URL path segments
      try {
        const url = new URL(page.url);
        const pathSegments = url.pathname.split("/").filter((s) => s.length > 0);
        const depth = pathSegments.length;

        if (depth > 5) {
          return {
            ruleId: "IDX-007",
            category: "indexability",
            severity: "low",
            title: "Page too deep in site architecture",
            description:
              `This page is ${depth} levels deep in the site hierarchy. Pages deeper than 5 levels are less likely to be crawled frequently and may receive less link equity. Consider restructuring your site architecture to bring important pages closer to the root, or add direct internal links from higher-level pages.`,
            affectedUrl: page.url,
            evidence: {
              depth,
              pathSegments,
            },
          };
        }
      } catch {
        // Invalid URL, skip check
      }
      return null;
    },
  },
  {
    id: "IDX-008",
    category: "indexability",
    severity: "medium",
    title: "Low content page might be excluded from index",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.wordCount === null) return null;
      if (page.wordCount < 50 && page.statusCode === 200) {
        const hasNoindex = page.metaRobots?.toLowerCase().includes("noindex") ?? false;
        if (!hasNoindex) {
          return {
            ruleId: "IDX-008",
            category: "indexability",
            severity: "medium",
            title: "Low content page might be excluded from index",
            description:
              "This page has very little text content (fewer than 50 words). Search engines may consider it thin content and choose not to index it, or it may rank poorly. Add meaningful, unique content to the page or consider whether it should be consolidated with another page.",
            affectedUrl: page.url,
            evidence: {
              wordCount: page.wordCount,
              title: page.title,
            },
          };
        }
      }
      return null;
    },
  },
];
