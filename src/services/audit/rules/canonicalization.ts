import type { AuditRule, PageData, AuditIssue } from "../audit-engine";
import {
  isSameSiteHostname,
  normalizeComparableUrl,
} from "@/lib/url-normalization";

const pageByNormalizedUrlCache = new WeakMap<PageData[], Map<string, PageData>>();
const canonicalIncomingUrlsCache = new WeakMap<PageData[], Map<string, string[]>>();

function getPageByNormalizedUrl(allPages: PageData[]): Map<string, PageData> {
  const cached = pageByNormalizedUrlCache.get(allPages);
  if (cached) return cached;

  const map = new Map<string, PageData>();
  for (const page of allPages) {
    const normalized = normalizeComparableUrl(page.url);
    map.set(normalized, page);
  }

  pageByNormalizedUrlCache.set(allPages, map);
  return map;
}

function getCanonicalIncomingUrls(allPages: PageData[]): Map<string, string[]> {
  const cached = canonicalIncomingUrlsCache.get(allPages);
  if (cached) return cached;

  const map = new Map<string, string[]>();
  for (const page of allPages) {
    if (!page.canonicalUrl) continue;
    const target = normalizeComparableUrl(page.canonicalUrl, page.url);
    const source = normalizeComparableUrl(page.url);
    if (target === source) continue;

    const urls = map.get(target);
    if (urls) {
      urls.push(page.url);
    } else {
      map.set(target, [page.url]);
    }
  }

  canonicalIncomingUrlsCache.set(allPages, map);
  return map;
}

export const canonicalizationRules: AuditRule[] = [
  {
    id: "CAN-001",
    category: "canonicalization",
    severity: "high",
    title: "Missing canonical tag",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode !== 200) return null;
      if (!page.canonicalUrl) {
        return {
          ruleId: "CAN-001",
          category: "canonicalization",
          severity: "high",
          title: "Missing canonical tag",
          description:
            "This page has no canonical tag. Without a canonical tag, search engines must guess the preferred version of this URL, which can lead to duplicate content issues and diluted rankings. Add a self-referencing canonical tag or point it to the preferred URL.",
          affectedUrl: page.url,
          evidence: {
            canonicalUrl: null,
          },
        };
      }
      return null;
    },
  },
  {
    id: "CAN-002",
    category: "canonicalization",
    severity: "medium",
    title: "Canonical points to different domain",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.canonicalUrl) return null;

      try {
        const pageHost = new URL(page.url).hostname;
        const canonicalHost = new URL(page.canonicalUrl, page.url).hostname;

        if (!isSameSiteHostname(pageHost, canonicalHost)) {
          return {
            ruleId: "CAN-002",
            category: "canonicalization",
            severity: "medium",
            title: "Canonical points to different domain",
            description:
              `The canonical URL points to a different domain (${canonicalHost}) than the current page (${pageHost}). Cross-domain canonicals transfer all ranking signals to the other domain. Verify this is intentional; if not, update the canonical to reference the correct domain.`,
            affectedUrl: page.url,
            evidence: {
              pageHost,
              canonicalHost,
              canonicalUrl: page.canonicalUrl,
            },
          };
        }
      } catch {
        // Invalid URL
      }
      return null;
    },
  },
  {
    id: "CAN-003",
    category: "canonicalization",
    severity: "high",
    title: "Canonical chain detected",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      if (!page.canonicalUrl) return null;
      const pageNorm = normalizeComparableUrl(page.url);
      const canonNorm = normalizeComparableUrl(page.canonicalUrl, page.url);
      if (pageNorm === canonNorm) return null;

      // Check if the canonical target also has a different canonical
      const target = getPageByNormalizedUrl(allPages).get(canonNorm);

      if (target && target.canonicalUrl) {
        const targetCanonNorm = normalizeComparableUrl(target.canonicalUrl, target.url);
        if (targetCanonNorm !== canonNorm) {
          return {
            ruleId: "CAN-003",
            category: "canonicalization",
            severity: "high",
            title: "Canonical chain detected",
            description:
              "This page's canonical target has its own different canonical URL, creating a canonical chain. Search engines may not follow canonical chains and could ignore the signal entirely. Update this page's canonical to point directly to the final preferred URL.",
            affectedUrl: page.url,
            evidence: {
              pageCanonical: page.canonicalUrl,
              targetCanonical: target.canonicalUrl,
            },
          };
        }
      }
      return null;
    },
  },
  {
    id: "CAN-004",
    category: "canonicalization",
    severity: "medium",
    title: "Canonical URL has query parameters",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.canonicalUrl) return null;

      try {
        const canonUrl = new URL(page.canonicalUrl);
        const paramCount = Array.from(canonUrl.searchParams).length;

        if (paramCount > 0) {
          return {
            ruleId: "CAN-004",
            category: "canonicalization",
            severity: "medium",
            title: "Canonical URL has query parameters",
            description:
              `The canonical URL contains ${paramCount} query parameter(s). Canonical URLs should typically be clean, parameter-free URLs. Query parameters in canonicals can cause confusion about the preferred URL version. Remove unnecessary parameters from the canonical URL.`,
            affectedUrl: page.url,
            evidence: {
              canonicalUrl: page.canonicalUrl,
              paramCount,
              params: Object.fromEntries(canonUrl.searchParams),
            },
          };
        }
      } catch {
        // Invalid URL
      }
      return null;
    },
  },
  {
    id: "CAN-005",
    category: "canonicalization",
    severity: "medium",
    title: "Canonical URL uses HTTP instead of HTTPS",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.canonicalUrl) return null;

      if (page.url.startsWith("https://") && page.canonicalUrl.startsWith("http://")) {
        return {
          ruleId: "CAN-005",
          category: "canonicalization",
          severity: "medium",
          title: "Canonical URL uses HTTP instead of HTTPS",
          description:
            "This HTTPS page has a canonical tag pointing to an HTTP URL. This mismatch can cause search engines to prefer the insecure version. Update the canonical URL to use HTTPS to align with the secure version of the page.",
          affectedUrl: page.url,
          evidence: {
            pageUrl: page.url,
            canonicalUrl: page.canonicalUrl,
          },
        };
      }
      return null;
    },
  },
  {
    id: "CAN-006",
    category: "canonicalization",
    severity: "low",
    title: "Canonical URL is relative",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.canonicalUrl) return null;

      if (!page.canonicalUrl.startsWith("http://") && !page.canonicalUrl.startsWith("https://")) {
        return {
          ruleId: "CAN-006",
          category: "canonicalization",
          severity: "low",
          title: "Canonical URL is relative",
          description:
            "The canonical tag uses a relative URL instead of an absolute URL. While browsers can resolve relative canonical URLs, it is best practice to use absolute URLs to avoid ambiguity. Update the canonical tag to include the full URL with protocol and domain.",
          affectedUrl: page.url,
          evidence: {
            canonicalUrl: page.canonicalUrl,
          },
        };
      }
      return null;
    },
  },
  {
    id: "CAN-007",
    category: "canonicalization",
    severity: "high",
    title: "Noindex page with canonical to different URL",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.canonicalUrl || !page.metaRobots) return null;

      const directives = page.metaRobots.toLowerCase().split(",").map((d) => d.trim());
      const pageNorm = normalizeComparableUrl(page.url);
      const canonNorm = normalizeComparableUrl(page.canonicalUrl, page.url);

      if (directives.includes("noindex") && pageNorm !== canonNorm) {
        return {
          ruleId: "CAN-007",
          category: "canonicalization",
          severity: "high",
          title: "Noindex page with canonical to different URL",
          description:
            "This page is marked as noindex but also has a canonical tag pointing to a different URL. This sends conflicting signals to search engines — noindex says 'don't index' while the canonical says 'index the other URL instead.' Choose one approach: either use noindex to block the page or use a canonical to consolidate, but not both.",
          affectedUrl: page.url,
          evidence: {
            metaRobots: page.metaRobots,
            canonicalUrl: page.canonicalUrl,
          },
        };
      }
      return null;
    },
  },
  {
    id: "CAN-008",
    category: "canonicalization",
    severity: "medium",
    title: "Multiple pages canonicalizing to same URL",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      if (!page.canonicalUrl) return null;

      const canonNorm = normalizeComparableUrl(page.canonicalUrl, page.url);
      const pageNorm = normalizeComparableUrl(page.url);

      // Only check from the canonical target's perspective
      if (canonNorm !== pageNorm) return null;

      const pagesPointingHere = getCanonicalIncomingUrls(allPages).get(pageNorm) || [];

      if (pagesPointingHere.length > 5) {
        return {
          ruleId: "CAN-008",
          category: "canonicalization",
          severity: "medium",
          title: "Many pages canonicalizing to this URL",
          description:
            `${pagesPointingHere.length} other pages have canonical tags pointing to this URL. While some canonicalization is normal (e.g., parameter variants), a high number may indicate duplicate content issues that should be resolved at the source. Investigate why so many pages need to canonicalize here and consider consolidating or redirecting.`,
          affectedUrl: page.url,
          evidence: {
            canonicalizingPageCount: pagesPointingHere.length,
            examples: pagesPointingHere.slice(0, 10),
          },
        };
      }
      return null;
    },
  },
];
