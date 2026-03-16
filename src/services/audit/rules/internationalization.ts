import type { AuditRule, PageData, AuditIssue } from "../audit-engine";

const pageByNormalizedUrlCache = new WeakMap<PageData[], Map<string, PageData>>();
const siteLanguagesCache = new WeakMap<PageData[], Set<string>>();

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function getPageByNormalizedUrl(allPages: PageData[]): Map<string, PageData> {
  const cached = pageByNormalizedUrlCache.get(allPages);
  if (cached) return cached;

  const map = new Map<string, PageData>();
  for (const page of allPages) {
    map.set(normalizeUrl(page.url), page);
  }

  pageByNormalizedUrlCache.set(allPages, map);
  return map;
}

function getSiteLanguages(allPages: PageData[]): Set<string> {
  const cached = siteLanguagesCache.get(allPages);
  if (cached) return cached;

  const siteLanguages = new Set<string>();
  for (const p of allPages) {
    if (!p.hreflangTags) continue;
    for (const tag of p.hreflangTags) {
      siteLanguages.add(tag.lang.toLowerCase());
    }
  }

  siteLanguagesCache.set(allPages, siteLanguages);
  return siteLanguages;
}

export const internationalizationRules: AuditRule[] = [
  {
    id: "I18N-001",
    category: "internationalization",
    severity: "high",
    title: "Hreflang missing self-reference",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.hreflangTags || page.hreflangTags.length === 0) return null;

      const pageNorm = page.url.replace(/\/$/, "");
      const hasSelfRef = page.hreflangTags.some(
        (tag) => tag.href.replace(/\/$/, "") === pageNorm
      );

      if (!hasSelfRef) {
        return {
          ruleId: "I18N-001",
          category: "internationalization",
          severity: "high",
          title: "Hreflang missing self-reference",
          description:
            "This page has hreflang tags but does not include a self-referencing entry for its own URL. Every page with hreflang annotations must include a tag pointing to itself. Add a hreflang tag with the appropriate language code that references this page's URL.",
          affectedUrl: page.url,
          evidence: {
            hreflangTags: page.hreflangTags,
            pageUrl: page.url,
          },
        };
      }
      return null;
    },
  },
  {
    id: "I18N-002",
    category: "internationalization",
    severity: "medium",
    title: "Hreflang missing x-default",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.hreflangTags || page.hreflangTags.length === 0) return null;

      const hasXDefault = page.hreflangTags.some(
        (tag) => tag.lang.toLowerCase() === "x-default"
      );

      if (!hasXDefault) {
        return {
          ruleId: "I18N-002",
          category: "internationalization",
          severity: "medium",
          title: "Hreflang missing x-default",
          description:
            "This page has hreflang tags but is missing the x-default annotation. The x-default value specifies the fallback URL for users whose language doesn't match any listed hreflang. Add an x-default hreflang tag pointing to the most appropriate default page.",
          affectedUrl: page.url,
          evidence: {
            hreflangTags: page.hreflangTags,
            languages: page.hreflangTags.map((t) => t.lang),
          },
        };
      }
      return null;
    },
  },
  {
    id: "I18N-003",
    category: "internationalization",
    severity: "high",
    title: "Non-reciprocal hreflang link",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      if (!page.hreflangTags || page.hreflangTags.length === 0) return null;

      const nonReciprocal: Array<{ lang: string; href: string }> = [];
      const pageNorm = normalizeUrl(page.url);
      const pageLookup = getPageByNormalizedUrl(allPages);

      for (const tag of page.hreflangTags) {
        const targetNorm = normalizeUrl(tag.href);
        if (targetNorm === pageNorm) continue;

        const targetPage = pageLookup.get(targetNorm);

        if (targetPage) {
          if (!targetPage.hreflangTags || targetPage.hreflangTags.length === 0) {
            nonReciprocal.push(tag);
          } else {
            const linksBack = targetPage.hreflangTags.some(
              (t) => normalizeUrl(t.href) === pageNorm
            );
            if (!linksBack) {
              nonReciprocal.push(tag);
            }
          }
        }
      }

      if (nonReciprocal.length > 0) {
        return {
          ruleId: "I18N-003",
          category: "internationalization",
          severity: "high",
          title: "Non-reciprocal hreflang link",
          description:
            `${nonReciprocal.length} hreflang target(s) do not link back to this page. Hreflang annotations must be reciprocal — if page A references page B with hreflang, page B must also reference page A. Add the missing hreflang annotations on the target pages.`,
          affectedUrl: page.url,
          evidence: {
            nonReciprocalCount: nonReciprocal.length,
            nonReciprocalTargets: nonReciprocal,
          },
        };
      }
      return null;
    },
  },
  {
    id: "I18N-004",
    category: "internationalization",
    severity: "medium",
    title: "Invalid hreflang language code",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.hreflangTags || page.hreflangTags.length === 0) return null;

      // Basic ISO 639-1 language code validation (2-letter or language-region format)
      const validPattern = /^(x-default|[a-z]{2}(-[a-zA-Z]{2,3})?)$/;
      const invalidTags = page.hreflangTags.filter(
        (tag) => !validPattern.test(tag.lang.toLowerCase())
      );

      if (invalidTags.length > 0) {
        return {
          ruleId: "I18N-004",
          category: "internationalization",
          severity: "medium",
          title: "Invalid hreflang language code",
          description:
            `${invalidTags.length} hreflang tag(s) use invalid language codes. Hreflang language codes must follow ISO 639-1 format (e.g., "en", "fr-CA"). Invalid codes are ignored by search engines. Correct the language codes to valid ISO 639-1 values.`,
          affectedUrl: page.url,
          evidence: {
            invalidTags: invalidTags.map((t) => ({ lang: t.lang, href: t.href })),
          },
        };
      }
      return null;
    },
  },
  {
    id: "I18N-005",
    category: "internationalization",
    severity: "medium",
    title: "Hreflang target returns non-200",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      if (!page.hreflangTags || page.hreflangTags.length === 0) return null;

      const badTargets: Array<{ lang: string; href: string; statusCode: number }> = [];
      const pageLookup = getPageByNormalizedUrl(allPages);

      for (const tag of page.hreflangTags) {
        const target = pageLookup.get(normalizeUrl(tag.href));
        if (target && target.statusCode !== null && target.statusCode !== 200) {
          badTargets.push({
            lang: tag.lang,
            href: tag.href,
            statusCode: target.statusCode,
          });
        }
      }

      if (badTargets.length > 0) {
        return {
          ruleId: "I18N-005",
          category: "internationalization",
          severity: "medium",
          title: "Hreflang target returns non-200",
          description:
            `${badTargets.length} hreflang target(s) do not return a 200 status code. Hreflang annotations should point to accessible, indexable pages. Fix the target URLs or update the hreflang tags to point to valid destinations.`,
          affectedUrl: page.url,
          evidence: {
            badTargets,
          },
        };
      }
      return null;
    },
  },
  {
    id: "I18N-006",
    category: "internationalization",
    severity: "low",
    title: "Duplicate hreflang language code",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.hreflangTags || page.hreflangTags.length === 0) return null;

      const langCounts: Record<string, number> = {};
      for (const tag of page.hreflangTags) {
        const lang = tag.lang.toLowerCase();
        langCounts[lang] = (langCounts[lang] || 0) + 1;
      }

      const duplicates = Object.entries(langCounts).filter(([, count]) => count > 1);

      if (duplicates.length > 0) {
        return {
          ruleId: "I18N-006",
          category: "internationalization",
          severity: "low",
          title: "Duplicate hreflang language code",
          description:
            `${duplicates.length} language code(s) appear more than once in the hreflang annotations. Each language-region combination should appear only once. Remove duplicate entries to avoid confusing search engines.`,
          affectedUrl: page.url,
          evidence: {
            duplicates: duplicates.map(([lang, count]) => ({ lang, count })),
          },
        };
      }
      return null;
    },
  },
  {
    id: "I18N-007",
    category: "internationalization",
    severity: "medium",
    title: "Hreflang tags with relative URLs",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.hreflangTags || page.hreflangTags.length === 0) return null;

      const relativeUrls = page.hreflangTags.filter(
        (tag) => !tag.href.startsWith("http://") && !tag.href.startsWith("https://")
      );

      if (relativeUrls.length > 0) {
        return {
          ruleId: "I18N-007",
          category: "internationalization",
          severity: "medium",
          title: "Hreflang tags with relative URLs",
          description:
            `${relativeUrls.length} hreflang tag(s) use relative URLs instead of absolute URLs. Hreflang annotations require fully qualified absolute URLs to be valid. Update all hreflang href attributes to use complete URLs including the protocol and domain.`,
          affectedUrl: page.url,
          evidence: {
            relativeUrlCount: relativeUrls.length,
            examples: relativeUrls.slice(0, 5),
          },
        };
      }
      return null;
    },
  },
  {
    id: "I18N-008",
    category: "internationalization",
    severity: "low",
    title: "Incomplete hreflang coverage across site",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      if (!page.hreflangTags || page.hreflangTags.length === 0) return null;

      const siteLanguages = getSiteLanguages(allPages);

      const pageLanguages = new Set(
        page.hreflangTags.map((t) => t.lang.toLowerCase())
      );

      const missingLanguages = Array.from(siteLanguages).filter(
        (lang) => !pageLanguages.has(lang)
      );

      if (missingLanguages.length > 0 && siteLanguages.size > 2) {
        return {
          ruleId: "I18N-008",
          category: "internationalization",
          severity: "low",
          title: "Incomplete hreflang coverage across site",
          description:
            `This page is missing hreflang annotations for ${missingLanguages.length} language(s) that are used elsewhere on the site. Incomplete hreflang coverage can confuse search engines about the available language versions. Add the missing language annotations or confirm that this content is not available in those languages.`,
          affectedUrl: page.url,
          evidence: {
            pageLanguages: Array.from(pageLanguages),
            missingLanguages,
            siteLanguages: Array.from(siteLanguages),
          },
        };
      }
      return null;
    },
  },
];
