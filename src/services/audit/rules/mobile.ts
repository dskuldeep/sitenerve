import type { AuditRule, PageData, AuditIssue } from "../audit-engine";

export const mobileRules: AuditRule[] = [
  {
    id: "MOB-001",
    category: "mobile",
    severity: "high",
    title: "Page likely missing viewport meta tag",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode !== 200) return null;

      // Heuristic: if the page has content but very large image dimensions without responsive attributes
      // it may not have a viewport tag. We check indirectly via page metadata.
      // Since PageData doesn't include viewport directly, we flag pages with large fixed-dimension images
      // and no responsive indicators.
      if (!page.images || page.images.length === 0) return null;

      const fixedWideImages = page.images.filter(
        (img) => img.width !== undefined && img.width > 1200 && img.height !== undefined
      );

      // If most images have very large fixed dimensions, viewport may not be set
      if (fixedWideImages.length > 3 && fixedWideImages.length > page.images.length * 0.5) {
        return {
          ruleId: "MOB-001",
          category: "mobile",
          severity: "high",
          title: "Page may lack viewport configuration",
          description:
            `This page has ${fixedWideImages.length} images with fixed widths over 1200px, suggesting the page may not be optimized for mobile viewports. Ensure the page includes a <meta name="viewport" content="width=device-width, initial-scale=1"> tag and uses responsive image techniques.`,
          affectedUrl: page.url,
          evidence: {
            largeFixedImageCount: fixedWideImages.length,
            totalImages: page.images.length,
            examples: fixedWideImages.slice(0, 3).map((img) => ({
              src: img.src,
              width: img.width,
            })),
          },
        };
      }
      return null;
    },
  },
  {
    id: "MOB-002",
    category: "mobile",
    severity: "medium",
    title: "Very long title may truncate on mobile",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.title) return null;
      if (page.title.length > 50) {
        return {
          ruleId: "MOB-002",
          category: "mobile",
          severity: "medium",
          title: "Title may truncate on mobile SERPs",
          description:
            `This page's title is ${page.title.length} characters. On mobile search results, titles are typically truncated around 50 characters. Consider front-loading the most important keywords and keeping mobile-friendly titles concise.`,
          affectedUrl: page.url,
          evidence: {
            title: page.title,
            length: page.title.length,
            mobileLimit: 50,
          },
        };
      }
      return null;
    },
  },
  {
    id: "MOB-003",
    category: "mobile",
    severity: "medium",
    title: "Large page size impacts mobile loading",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.pageSize === null) return null;
      const mobileThreshold = 500 * 1024; // 500KB
      if (page.pageSize > mobileThreshold) {
        return {
          ruleId: "MOB-003",
          category: "mobile",
          severity: "medium",
          title: "Large page size impacts mobile loading",
          description:
            `This page is ${(page.pageSize / 1024).toFixed(0)} KB, which can be slow to load on mobile networks. Mobile users often have limited bandwidth and data caps. Optimize images, minify resources, and implement lazy loading to reduce page size below 500 KB.`,
          affectedUrl: page.url,
          evidence: {
            pageSizeKB: (page.pageSize / 1024).toFixed(0),
            thresholdKB: 500,
          },
        };
      }
      return null;
    },
  },
  {
    id: "MOB-004",
    category: "mobile",
    severity: "low",
    title: "Slow response time affects mobile experience",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.responseTime === null) return null;
      if (page.responseTime > 2000) {
        return {
          ruleId: "MOB-004",
          category: "mobile",
          severity: "low",
          title: "Slow response time affects mobile experience",
          description:
            `This page's server response time is ${(page.responseTime / 1000).toFixed(1)} seconds. On mobile devices with higher latency, this compounds into significantly longer total load times. Aim for server response times under 1 second by optimizing server-side processing and using edge caching.`,
          affectedUrl: page.url,
          evidence: {
            responseTimeMs: page.responseTime,
            mobileImpact: "High latency on mobile networks amplifies slow response times",
          },
        };
      }
      return null;
    },
  },
  {
    id: "MOB-005",
    category: "mobile",
    severity: "medium",
    title: "Too many resources for mobile",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      const imageCount = page.images?.length ?? 0;
      const internalLinkCount = page.internalLinks?.length ?? 0;
      const externalLinkCount = page.externalLinks?.length ?? 0;
      const totalResources = imageCount + internalLinkCount + externalLinkCount;

      if (totalResources > 200) {
        return {
          ruleId: "MOB-005",
          category: "mobile",
          severity: "medium",
          title: "Too many resources for mobile",
          description:
            `This page references ${totalResources} combined resources (images, internal links, external links). On mobile devices, processing many DOM elements and resources is expensive. Simplify the page structure, reduce the number of elements, and prioritize above-the-fold content.`,
          affectedUrl: page.url,
          evidence: {
            imageCount,
            internalLinkCount,
            externalLinkCount,
            totalResources,
          },
        };
      }
      return null;
    },
  },
  {
    id: "MOB-006",
    category: "mobile",
    severity: "low",
    title: "Deep page may have poor mobile navigation",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      try {
        const url = new URL(page.url);
        const depth = url.pathname.split("/").filter((s) => s.length > 0).length;
        if (depth > 4) {
          return {
            ruleId: "MOB-006",
            category: "mobile",
            severity: "low",
            title: "Deep page may have poor mobile navigation",
            description:
              `This page is ${depth} levels deep. On mobile devices, deep navigation structures are harder to use. Consider implementing breadcrumb navigation and ensuring important content is accessible within 3 taps from the homepage.`,
            affectedUrl: page.url,
            evidence: {
              depth,
              path: url.pathname,
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
    id: "MOB-007",
    category: "mobile",
    severity: "medium",
    title: "Excessive word count for mobile readability",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.wordCount === null) return null;
      if (page.wordCount > 5000) {
        return {
          ruleId: "MOB-007",
          category: "mobile",
          severity: "medium",
          title: "Excessive word count for mobile readability",
          description:
            `This page has ${page.wordCount} words. Very long pages can be difficult to read and navigate on mobile devices. Consider breaking the content into multiple pages, using a table of contents with anchor links, or implementing accordion/expandable sections for mobile users.`,
          affectedUrl: page.url,
          evidence: {
            wordCount: page.wordCount,
            threshold: 5000,
          },
        };
      }
      return null;
    },
  },
  {
    id: "MOB-008",
    category: "mobile",
    severity: "high",
    title: "Images without dimensions cause mobile layout shifts",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.images || page.images.length === 0) return null;

      const noDimensions = page.images.filter(
        (img) => img.width === undefined || img.height === undefined
      );

      const ratio = noDimensions.length / page.images.length;

      if (noDimensions.length > 5 && ratio > 0.5) {
        return {
          ruleId: "MOB-008",
          category: "mobile",
          severity: "high",
          title: "Images without dimensions cause mobile layout shifts",
          description:
            `${noDimensions.length} of ${page.images.length} images lack explicit width and height attributes. On mobile devices, this causes significant Cumulative Layout Shift (CLS) as images load and push content around. Set width and height attributes on all images and use CSS aspect-ratio for responsive sizing.`,
          affectedUrl: page.url,
          evidence: {
            missingDimensionsCount: noDimensions.length,
            totalImages: page.images.length,
            percentageMissing: (ratio * 100).toFixed(0) + "%",
          },
        };
      }
      return null;
    },
  },
];
