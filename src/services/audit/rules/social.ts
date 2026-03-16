import type { AuditRule, PageData, AuditIssue } from "../audit-engine";
import { areEquivalentUrls } from "@/lib/url-normalization";

export const socialRules: AuditRule[] = [
  {
    id: "SOC-001",
    category: "social",
    severity: "medium",
    title: "Missing Open Graph tags",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode !== 200) return null;
      if (!page.ogTags || Object.keys(page.ogTags).length === 0) {
        return {
          ruleId: "SOC-001",
          category: "social",
          severity: "medium",
          title: "Missing Open Graph tags",
          description:
            "This page has no Open Graph (og:) meta tags. Open Graph tags control how the page appears when shared on social media platforms like Facebook, LinkedIn, and Twitter. Add at minimum og:title, og:description, og:image, and og:url tags to ensure attractive social media previews.",
          affectedUrl: page.url,
          evidence: {
            ogTags: null,
          },
        };
      }
      return null;
    },
  },
  {
    id: "SOC-002",
    category: "social",
    severity: "high",
    title: "Missing og:title",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.ogTags || Object.keys(page.ogTags).length === 0) return null;
      if (!page.ogTags["og:title"] || page.ogTags["og:title"].trim().length === 0) {
        return {
          ruleId: "SOC-002",
          category: "social",
          severity: "high",
          title: "Missing og:title",
          description:
            "This page has Open Graph tags but is missing the og:title property. The og:title is the most prominent element in social media previews. Add an og:title tag with a compelling title (ideally 60-90 characters) that encourages clicks from social media.",
          affectedUrl: page.url,
          evidence: {
            ogTags: page.ogTags,
            missingTag: "og:title",
          },
        };
      }
      return null;
    },
  },
  {
    id: "SOC-003",
    category: "social",
    severity: "high",
    title: "Missing og:description",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.ogTags || Object.keys(page.ogTags).length === 0) return null;
      if (!page.ogTags["og:description"] || page.ogTags["og:description"].trim().length === 0) {
        return {
          ruleId: "SOC-003",
          category: "social",
          severity: "high",
          title: "Missing og:description",
          description:
            "This page is missing the og:description Open Graph tag. The description appears below the title in social media previews and influences whether users click through. Add an og:description with a concise summary (up to 200 characters) that complements the og:title.",
          affectedUrl: page.url,
          evidence: {
            ogTags: page.ogTags,
            missingTag: "og:description",
          },
        };
      }
      return null;
    },
  },
  {
    id: "SOC-004",
    category: "social",
    severity: "high",
    title: "Missing og:image",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.ogTags || Object.keys(page.ogTags).length === 0) return null;
      if (!page.ogTags["og:image"] || page.ogTags["og:image"].trim().length === 0) {
        return {
          ruleId: "SOC-004",
          category: "social",
          severity: "high",
          title: "Missing og:image",
          description:
            "This page is missing the og:image Open Graph tag. Posts shared without an image receive significantly less engagement on social media. Add an og:image tag with a high-quality image (recommended 1200x630 pixels) that represents the page content.",
          affectedUrl: page.url,
          evidence: {
            ogTags: page.ogTags,
            missingTag: "og:image",
          },
        };
      }
      return null;
    },
  },
  {
    id: "SOC-005",
    category: "social",
    severity: "medium",
    title: "Missing og:url",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.ogTags || Object.keys(page.ogTags).length === 0) return null;
      if (!page.ogTags["og:url"] || page.ogTags["og:url"].trim().length === 0) {
        return {
          ruleId: "SOC-005",
          category: "social",
          severity: "medium",
          title: "Missing og:url",
          description:
            "This page is missing the og:url Open Graph tag. The og:url tells social platforms the canonical URL for the shared content, ensuring likes and shares are consolidated to one URL. Add og:url with the canonical URL of the page.",
          affectedUrl: page.url,
          evidence: {
            ogTags: page.ogTags,
            missingTag: "og:url",
          },
        };
      }
      return null;
    },
  },
  {
    id: "SOC-006",
    category: "social",
    severity: "low",
    title: "Missing og:type",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.ogTags || Object.keys(page.ogTags).length === 0) return null;
      if (!page.ogTags["og:type"]) {
        return {
          ruleId: "SOC-006",
          category: "social",
          severity: "low",
          title: "Missing og:type",
          description:
            "This page is missing the og:type Open Graph tag. The og:type tells social platforms what kind of content the page represents (e.g., 'website', 'article', 'product'). Add an appropriate og:type tag to help platforms display the content correctly.",
          affectedUrl: page.url,
          evidence: {
            ogTags: page.ogTags,
            missingTag: "og:type",
          },
        };
      }
      return null;
    },
  },
  {
    id: "SOC-007",
    category: "social",
    severity: "medium",
    title: "og:image uses HTTP URL",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.ogTags) return null;
      const ogImage = page.ogTags["og:image"];
      if (!ogImage) return null;

      if (ogImage.startsWith("http://")) {
        return {
          ruleId: "SOC-007",
          category: "social",
          severity: "medium",
          title: "og:image uses HTTP URL",
          description:
            "The og:image URL uses HTTP instead of HTTPS. Some social platforms may not display images served over insecure connections, and it can trigger mixed content warnings. Update the og:image URL to use HTTPS.",
          affectedUrl: page.url,
          evidence: {
            ogImage,
          },
        };
      }
      return null;
    },
  },
  {
    id: "SOC-008",
    category: "social",
    severity: "medium",
    title: "og:url mismatch with canonical URL",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.ogTags || !page.canonicalUrl) return null;
      const ogUrl = page.ogTags["og:url"];
      if (!ogUrl) return null;

      if (!areEquivalentUrls(ogUrl, page.canonicalUrl, page.url)) {
        return {
          ruleId: "SOC-008",
          category: "social",
          severity: "medium",
          title: "og:url mismatch with canonical URL",
          description:
            "The og:url value does not match the canonical URL. This inconsistency can cause social platforms to attribute shares to a different URL than search engines consider canonical. Align the og:url with the canonical URL to ensure consistent URL signals.",
          affectedUrl: page.url,
          evidence: {
            ogUrl,
            canonicalUrl: page.canonicalUrl,
          },
        };
      }
      return null;
    },
  },
];
