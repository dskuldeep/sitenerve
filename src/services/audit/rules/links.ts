import type { AuditRule, PageData, AuditIssue } from "../audit-engine";
import { normalizeComparableUrl } from "@/lib/url-normalization";

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

function getPageLookup(allPages: PageData[]): Map<string, PageData> {
  const cached = pageLookupCache.get(allPages);
  if (cached) return cached;

  const lookup = new Map<string, PageData>();
  for (const page of allPages) {
    lookup.set(normalizeUrl(page.url), page);
  }

  pageLookupCache.set(allPages, lookup);
  return lookup;
}

export const linkRules: AuditRule[] = [
  {
    id: "LNK-001",
    category: "links",
    severity: "medium",
    title: "No internal links on page",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode !== 200) return null;
      if (!page.internalLinks || page.internalLinks.length === 0) {
        return {
          ruleId: "LNK-001",
          category: "links",
          severity: "medium",
          title: "No internal links on page",
          description:
            "This page contains no internal links. Internal links are crucial for helping search engines discover content and distributing link equity throughout the site. Add relevant internal links to other pages to improve crawlability and site structure.",
          affectedUrl: page.url,
          evidence: {
            internalLinkCount: 0,
          },
        };
      }
      return null;
    },
  },
  {
    id: "LNK-002",
    category: "links",
    severity: "low",
    title: "Very few internal links",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode !== 200) return null;
      if (!page.internalLinks) return null;
      if (page.internalLinks.length > 0 && page.internalLinks.length < 3) {
        return {
          ruleId: "LNK-002",
          category: "links",
          severity: "low",
          title: "Very few internal links",
          description:
            `This page has only ${page.internalLinks.length} internal link(s). Pages with few internal links may not effectively distribute PageRank or help users navigate the site. Add contextually relevant internal links to improve interlinking.`,
          affectedUrl: page.url,
          evidence: {
            internalLinkCount: page.internalLinks.length,
            minRecommended: 3,
          },
        };
      }
      return null;
    },
  },
  {
    id: "LNK-003",
    category: "links",
    severity: "medium",
    title: "Excessive external links",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.externalLinks) return null;
      if (page.externalLinks.length > 100) {
        return {
          ruleId: "LNK-003",
          category: "links",
          severity: "medium",
          title: "Excessive external links",
          description:
            `This page has ${page.externalLinks.length} external links, which is unusually high. Pages with too many outbound links may appear spammy and dilute link equity. Review external links and remove any that are not essential or valuable to users.`,
          affectedUrl: page.url,
          evidence: {
            externalLinkCount: page.externalLinks.length,
            threshold: 100,
          },
        };
      }
      return null;
    },
  },
  {
    id: "LNK-004",
    category: "links",
    severity: "low",
    title: "Links with empty anchor text",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      const emptyAnchors: string[] = [];

      if (page.internalLinks) {
        for (const link of page.internalLinks) {
          if (!link.text || link.text.trim().length === 0) {
            emptyAnchors.push(link.href);
          }
        }
      }
      if (page.externalLinks) {
        for (const link of page.externalLinks) {
          if (!link.text || link.text.trim().length === 0) {
            emptyAnchors.push(link.href);
          }
        }
      }

      if (emptyAnchors.length > 0) {
        return {
          ruleId: "LNK-004",
          category: "links",
          severity: "low",
          title: "Links with empty anchor text",
          description:
            `${emptyAnchors.length} link(s) on this page have empty anchor text. Empty anchor text provides no context to search engines or users about the linked page. Add descriptive anchor text that indicates the topic of the destination page.`,
          affectedUrl: page.url,
          evidence: {
            emptyAnchorCount: emptyAnchors.length,
            examples: emptyAnchors.slice(0, 10),
          },
        };
      }
      return null;
    },
  },
  {
    id: "LNK-005",
    category: "links",
    severity: "low",
    title: "Generic anchor text used",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      const genericPhrases = [
        "click here", "read more", "learn more", "here",
        "more", "link", "this", "go", "details",
      ];

      const genericLinks: Array<{ href: string; text: string }> = [];

      const checkLinks = (links: Array<{ href: string; text: string }>) => {
        for (const link of links) {
          if (link.text && genericPhrases.includes(link.text.trim().toLowerCase())) {
            genericLinks.push(link);
          }
        }
      };

      if (page.internalLinks) checkLinks(page.internalLinks);
      if (page.externalLinks) checkLinks(page.externalLinks);

      if (genericLinks.length > 3) {
        return {
          ruleId: "LNK-005",
          category: "links",
          severity: "low",
          title: "Generic anchor text used",
          description:
            `${genericLinks.length} link(s) use generic anchor text such as "click here" or "read more". Descriptive anchor text helps search engines understand the context of linked pages and improves accessibility. Replace generic text with descriptive phrases that indicate the link destination.`,
          affectedUrl: page.url,
          evidence: {
            genericLinkCount: genericLinks.length,
            examples: genericLinks.map((l) => ({
              href: l.href,
              text: l.text,
            })),
          },
        };
      }
      return null;
    },
  },
  {
    id: "LNK-006",
    category: "links",
    severity: "medium",
    title: "Links pointing to redirected URLs",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      if (!page.internalLinks) return null;

      const redirectedTargets: Array<{ href: string; statusCode: number }> = [];
      const pageLookup = getPageLookup(allPages);

      for (const link of page.internalLinks) {
        const resolvedTargetUrl = resolveHref(link.href, page.url);
        if (!resolvedTargetUrl) continue;
        const target = pageLookup.get(resolvedTargetUrl);
        if (target && target.statusCode !== null && target.statusCode >= 300 && target.statusCode < 400) {
          redirectedTargets.push({
            href: resolvedTargetUrl,
            statusCode: target.statusCode,
          });
        }
      }

      if (redirectedTargets.length > 0) {
        return {
          ruleId: "LNK-006",
          category: "links",
          severity: "medium",
          title: "Links pointing to redirected URLs",
          description:
            `${redirectedTargets.length} internal link(s) point to URLs that redirect. Each redirect adds latency and wastes crawl budget. Update the links to point directly to the final destination URL.`,
          affectedUrl: page.url,
          evidence: {
            redirectedLinkCount: redirectedTargets.length,
            examples: redirectedTargets,
          },
        };
      }
      return null;
    },
  },
  {
    id: "LNK-007",
    category: "links",
    severity: "high",
    title: "Links pointing to broken pages",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      if (!page.internalLinks) return null;

      const brokenTargets: Array<{ href: string; statusCode: number | null }> = [];
      const pageLookup = getPageLookup(allPages);

      for (const link of page.internalLinks) {
        const resolvedTargetUrl = resolveHref(link.href, page.url);
        if (!resolvedTargetUrl) continue;
        const target = pageLookup.get(resolvedTargetUrl);
        if (target && target.statusCode !== null && target.statusCode >= 400) {
          brokenTargets.push({
            href: resolvedTargetUrl,
            statusCode: target.statusCode,
          });
        }
      }

      if (brokenTargets.length > 0) {
        return {
          ruleId: "LNK-007",
          category: "links",
          severity: "high",
          title: "Links pointing to broken pages",
          description:
            `${brokenTargets.length} internal link(s) on this page point to URLs returning error status codes. Broken links harm user experience and waste crawl budget. Fix or remove these links.`,
          affectedUrl: page.url,
          evidence: {
            brokenLinkCount: brokenTargets.length,
            examples: brokenTargets,
          },
        };
      }
      return null;
    },
  },
  {
    id: "LNK-008",
    category: "links",
    severity: "medium",
    title: "Self-referencing internal links",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.internalLinks) return null;

      const pageNorm = normalizeUrl(page.url);
      const selfLinks = page.internalLinks.filter(
        (link) => resolveHref(link.href, page.url) === pageNorm
      );

      if (selfLinks.length > 2) {
        return {
          ruleId: "LNK-008",
          category: "links",
          severity: "medium",
          title: "Excessive self-referencing internal links",
          description:
            `This page has ${selfLinks.length} links pointing to itself. While a single self-referencing link (e.g., in navigation) is normal, excessive self-links waste link equity and can confuse crawlers. Remove unnecessary self-referencing links.`,
          affectedUrl: page.url,
          evidence: {
            selfLinkCount: selfLinks.length,
            examples: selfLinks.slice(0, 5).map((l) => l.text),
          },
        };
      }
      return null;
    },
  },
  {
    id: "LNK-009",
    category: "links",
    severity: "high",
    title: "Broken external links detected",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.externalLinks || page.externalLinks.length === 0) return null;

      const broken = page.externalLinks
        .filter((link) => {
          const statusCode = link.statusCode ?? null;
          if (link.isBroken) return true;
          if (statusCode === null || statusCode === undefined) return false;
          return statusCode >= 400 || statusCode === 0;
        })
        .map((link) => ({
          href: link.href,
          statusCode: link.statusCode ?? 0,
          error: link.error,
        }));

      if (broken.length === 0) return null;

      return {
        ruleId: "LNK-009",
        category: "links",
        severity: "high",
        title: "Broken external links detected",
        description:
          `${broken.length} external link(s) on this page appear broken or unreachable. Broken outbound links reduce trust and harm user experience. Replace or remove dead links and update references to live destinations.`,
        affectedUrl: page.url,
        evidence: {
          brokenExternalLinkCount: broken.length,
          examples: broken.slice(0, 50),
        },
      };
    },
  },
  {
    id: "LNK-010",
    category: "links",
    severity: "low",
    title: "External links redirecting",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.externalLinks || page.externalLinks.length === 0) return null;

      const redirecting = page.externalLinks
        .filter((link) => {
          if ((link.redirectChain?.length || 0) > 0) return true;
          const statusCode = link.statusCode ?? null;
          return statusCode !== null && statusCode >= 300 && statusCode < 400;
        })
        .map((link) => ({
          href: link.href,
          statusCode: link.statusCode ?? 0,
          redirectChain: link.redirectChain || [],
        }));

      if (redirecting.length === 0) return null;

      return {
        ruleId: "LNK-010",
        category: "links",
        severity: "low",
        title: "External links redirecting",
        description:
          `${redirecting.length} external link(s) redirect before reaching a final destination. Redirect-heavy outbound references can slow user navigation and create maintenance drift. Link to the final canonical destination where possible.`,
        affectedUrl: page.url,
        evidence: {
          redirectingExternalLinkCount: redirecting.length,
          examples: redirecting.slice(0, 50),
        },
      };
    },
  },
];
