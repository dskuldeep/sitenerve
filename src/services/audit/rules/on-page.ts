import type { AuditRule, PageData, AuditIssue } from "../audit-engine";

const titleToUrlsCache = new WeakMap<PageData[], Map<string, string[]>>();

function getTitleToUrls(allPages: PageData[]): Map<string, string[]> {
  const cached = titleToUrlsCache.get(allPages);
  if (cached) return cached;

  const map = new Map<string, string[]>();
  for (const p of allPages) {
    if (p.statusCode !== 200 || p.title === null) continue;
    const normalizedTitle = p.title.trim().toLowerCase();
    if (!normalizedTitle) continue;
    const urls = map.get(normalizedTitle);
    if (urls) {
      urls.push(p.url);
    } else {
      map.set(normalizedTitle, [p.url]);
    }
  }

  titleToUrlsCache.set(allPages, map);
  return map;
}

export const onPageRules: AuditRule[] = [
  {
    id: "OPG-001",
    category: "on-page",
    severity: "high",
    title: "Missing title tag",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode !== 200) return null;
      if (!page.title || page.title.trim().length === 0) {
        return {
          ruleId: "OPG-001",
          category: "on-page",
          severity: "high",
          title: "Missing title tag",
          description:
            "This page has no title tag or the title tag is empty. The title tag is one of the most important on-page SEO elements and is displayed in search results. Add a unique, descriptive title tag between 10 and 60 characters that accurately describes the page content.",
          affectedUrl: page.url,
          evidence: {
            title: page.title,
          },
        };
      }
      return null;
    },
  },
  {
    id: "OPG-002",
    category: "on-page",
    severity: "medium",
    title: "Duplicate title tag",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      if (!page.title || page.title.trim().length === 0) return null;
      if (page.statusCode !== 200) return null;

      const normalizedTitle = page.title.trim().toLowerCase();
      const titleUrls = getTitleToUrls(allPages).get(normalizedTitle) || [];
      const duplicates = titleUrls.filter((url) => url !== page.url);

      if (duplicates.length > 0) {
        return {
          ruleId: "OPG-002",
          category: "on-page",
          severity: "medium",
          title: "Duplicate title tag",
          description:
            `This page shares its title tag with ${duplicates.length} other page(s). Duplicate titles make it harder for search engines to determine which page to rank for a given query and can confuse users in search results. Create unique, descriptive titles for each page.`,
          affectedUrl: page.url,
          evidence: {
            title: page.title,
            duplicateUrls: duplicates.slice(0, 10),
            duplicateCount: duplicates.length,
          },
        };
      }
      return null;
    },
  },
  {
    id: "OPG-003",
    category: "on-page",
    severity: "low",
    title: "Title tag too long",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.title) return null;
      if (page.title.length > 60) {
        return {
          ruleId: "OPG-003",
          category: "on-page",
          severity: "low",
          title: "Title tag too long",
          description:
            `This page's title tag is ${page.title.length} characters long, exceeding the recommended maximum of 60 characters. Titles longer than 60 characters are typically truncated in search results, which may cut off important information. Shorten the title while keeping it descriptive and keyword-rich.`,
          affectedUrl: page.url,
          evidence: {
            title: page.title,
            length: page.title.length,
            maxRecommended: 60,
          },
        };
      }
      return null;
    },
  },
  {
    id: "OPG-004",
    category: "on-page",
    severity: "high",
    title: "Missing H1 heading",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode !== 200) return null;
      if (page.h1.length === 0) {
        return {
          ruleId: "OPG-004",
          category: "on-page",
          severity: "high",
          title: "Missing H1 heading",
          description:
            "This page has no H1 heading tag. The H1 is a critical on-page SEO element that helps search engines understand the main topic of the page. Add exactly one H1 tag that clearly describes the page's primary content and includes relevant keywords.",
          affectedUrl: page.url,
          evidence: {
            h1Count: 0,
          },
        };
      }
      return null;
    },
  },
  {
    id: "OPG-005",
    category: "on-page",
    severity: "medium",
    title: "Multiple H1 headings",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.h1.length > 1) {
        return {
          ruleId: "OPG-005",
          category: "on-page",
          severity: "medium",
          title: "Multiple H1 headings",
          description:
            `This page has ${page.h1.length} H1 headings. While HTML5 technically allows multiple H1s, best practice for SEO is to use a single H1 that clearly defines the page's main topic. Consolidate your H1 tags into one and use H2-H6 tags for subheadings.`,
          affectedUrl: page.url,
          evidence: {
            h1Count: page.h1.length,
            h1Tags: page.h1,
          },
        };
      }
      return null;
    },
  },
  {
    id: "OPG-006",
    category: "on-page",
    severity: "medium",
    title: "Missing meta description",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode !== 200) return null;
      if (page.metaDescription === null) {
        return {
          ruleId: "OPG-006",
          category: "on-page",
          severity: "medium",
          title: "Missing meta description",
          description:
            "This page has no meta description tag. While not a direct ranking factor, the meta description is often used as the snippet in search results and influences click-through rate. Add a compelling meta description between 120 and 160 characters that summarizes the page content and includes a call to action.",
          affectedUrl: page.url,
          evidence: {
            metaDescription: null,
          },
        };
      }
      return null;
    },
  },
  {
    id: "OPG-007",
    category: "on-page",
    severity: "low",
    title: "Meta description too long",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.metaDescription) return null;
      if (page.metaDescription.length > 160) {
        return {
          ruleId: "OPG-007",
          category: "on-page",
          severity: "low",
          title: "Meta description too long",
          description:
            `This page's meta description is ${page.metaDescription.length} characters long, exceeding the recommended maximum of 160 characters. Longer descriptions are truncated in search results, which can reduce their effectiveness. Shorten the meta description to 120-160 characters while keeping it informative and compelling.`,
          affectedUrl: page.url,
          evidence: {
            metaDescription: page.metaDescription,
            length: page.metaDescription.length,
            maxRecommended: 160,
          },
        };
      }
      return null;
    },
  },
  {
    id: "OPG-008",
    category: "on-page",
    severity: "low",
    title: "Thin content",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode !== 200) return null;
      if (page.wordCount !== null && page.wordCount < 300 && page.wordCount > 0) {
        return {
          ruleId: "OPG-008",
          category: "on-page",
          severity: "low",
          title: "Thin content",
          description:
            `This page has only ${page.wordCount} words, which is below the recommended minimum of 300 words. Thin content pages may be perceived as low-quality by search engines and rank poorly. Add more valuable, relevant content, or consider consolidating this page with related content on another page.`,
          affectedUrl: page.url,
          evidence: {
            wordCount: page.wordCount,
            minRecommended: 300,
          },
        };
      }
      return null;
    },
  },
  {
    id: "OPG-009",
    category: "on-page",
    severity: "low",
    title: "Title tag too short",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.title) return null;
      if (page.title.trim().length > 0 && page.title.trim().length < 10) {
        return {
          ruleId: "OPG-009",
          category: "on-page",
          severity: "low",
          title: "Title tag too short",
          description:
            `This page's title tag is only ${page.title.trim().length} characters long. Very short titles miss the opportunity to include relevant keywords and may not adequately describe the page content. Expand the title to 10-60 characters with a descriptive, keyword-rich phrase.`,
          affectedUrl: page.url,
          evidence: {
            title: page.title,
            length: page.title.trim().length,
            minRecommended: 10,
          },
        };
      }
      return null;
    },
  },
  {
    id: "OPG-010",
    category: "on-page",
    severity: "medium",
    title: "Empty meta description",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode !== 200) return null;
      if (page.metaDescription !== null && page.metaDescription.trim().length === 0) {
        return {
          ruleId: "OPG-010",
          category: "on-page",
          severity: "medium",
          title: "Empty meta description",
          description:
            "This page has a meta description tag but it is empty. An empty meta description is worse than a missing one, as it signals to search engines that the tag was intentionally left blank. Either populate it with a compelling summary of the page content (120-160 characters) or remove the empty tag entirely.",
          affectedUrl: page.url,
          evidence: {
            metaDescription: page.metaDescription,
          },
        };
      }
      return null;
    },
  },
];
