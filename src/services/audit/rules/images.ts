import type { AuditRule, PageData, AuditIssue } from "../audit-engine";

export const imageRules: AuditRule[] = [
  {
    id: "IMG-001",
    category: "images",
    severity: "high",
    title: "Images missing alt text",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.images || page.images.length === 0) return null;

      const missingAlt = page.images.filter(
        (img) => !img.alt || img.alt.trim().length === 0
      );

      if (missingAlt.length > 0) {
        return {
          ruleId: "IMG-001",
          category: "images",
          severity: "high",
          title: "Images missing alt text",
          description:
            `${missingAlt.length} image(s) on this page are missing alt text. Alt text is essential for accessibility (screen readers) and helps search engines understand image content. Add descriptive, concise alt text to every informational image.`,
          affectedUrl: page.url,
          evidence: {
            totalImages: page.images.length,
            missingAltCount: missingAlt.length,
            examples: missingAlt.slice(0, 5).map((img) => img.src),
          },
        };
      }
      return null;
    },
  },
  {
    id: "IMG-002",
    category: "images",
    severity: "medium",
    title: "Images with very long alt text",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.images || page.images.length === 0) return null;

      const longAlt = page.images.filter(
        (img) => img.alt && img.alt.length > 125
      );

      if (longAlt.length > 0) {
        return {
          ruleId: "IMG-002",
          category: "images",
          severity: "medium",
          title: "Images with very long alt text",
          description:
            `${longAlt.length} image(s) have alt text exceeding 125 characters. Overly long alt text can be truncated by screen readers and may appear as keyword stuffing. Keep alt text concise and descriptive, ideally under 125 characters.`,
          affectedUrl: page.url,
          evidence: {
            longAltCount: longAlt.length,
            examples: longAlt.slice(0, 5).map((img) => ({
              src: img.src,
              altLength: img.alt.length,
            })),
          },
        };
      }
      return null;
    },
  },
  {
    id: "IMG-003",
    category: "images",
    severity: "low",
    title: "Image missing explicit dimensions",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.images || page.images.length === 0) return null;

      const missingDimensions = page.images.filter(
        (img) => img.width === undefined || img.height === undefined
      );

      if (missingDimensions.length > 0) {
        return {
          ruleId: "IMG-003",
          category: "images",
          severity: "low",
          title: "Image missing explicit dimensions",
          description:
            `${missingDimensions.length} image(s) do not have explicit width and height attributes. Missing dimensions cause layout shifts as images load (poor CLS score). Add width and height attributes to all images to reserve space and prevent layout shifts.`,
          affectedUrl: page.url,
          evidence: {
            totalImages: page.images.length,
            missingDimensionsCount: missingDimensions.length,
            examples: missingDimensions.slice(0, 5).map((img) => img.src),
          },
        };
      }
      return null;
    },
  },
  {
    id: "IMG-004",
    category: "images",
    severity: "medium",
    title: "Oversized image dimensions",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.images || page.images.length === 0) return null;

      const oversized = page.images.filter(
        (img) =>
          (img.width !== undefined && img.width > 2000) ||
          (img.height !== undefined && img.height > 2000)
      );

      if (oversized.length > 0) {
        return {
          ruleId: "IMG-004",
          category: "images",
          severity: "medium",
          title: "Oversized image dimensions",
          description:
            `${oversized.length} image(s) have dimensions exceeding 2000px. Very large images consume excessive bandwidth and slow page loading. Resize images to the maximum display size needed, use responsive images with srcset, and serve appropriately sized images for each device.`,
          affectedUrl: page.url,
          evidence: {
            oversizedCount: oversized.length,
            examples: oversized.slice(0, 5).map((img) => ({
              src: img.src,
              width: img.width,
              height: img.height,
            })),
          },
        };
      }
      return null;
    },
  },
  {
    id: "IMG-005",
    category: "images",
    severity: "low",
    title: "Image with generic alt text",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.images || page.images.length === 0) return null;

      const genericPatterns = [
        "image", "photo", "picture", "img", "untitled",
        "screenshot", "banner", "icon", "logo",
      ];

      const genericAlt = page.images.filter((img) => {
        if (!img.alt) return false;
        const alt = img.alt.trim().toLowerCase();
        return genericPatterns.includes(alt) || /^img[-_]?\d+$/i.test(alt) || /^dsc[-_]?\d+$/i.test(alt);
      });

      if (genericAlt.length > 0) {
        return {
          ruleId: "IMG-005",
          category: "images",
          severity: "low",
          title: "Image with generic alt text",
          description:
            `${genericAlt.length} image(s) have generic, non-descriptive alt text (e.g., "image", "photo"). Generic alt text provides no SEO value and poor accessibility. Replace with descriptive alt text that explains the image content and context.`,
          affectedUrl: page.url,
          evidence: {
            genericAltCount: genericAlt.length,
            examples: genericAlt.slice(0, 5).map((img) => ({
              src: img.src,
              alt: img.alt,
            })),
          },
        };
      }
      return null;
    },
  },
  {
    id: "IMG-006",
    category: "images",
    severity: "high",
    title: "Images loaded over HTTP on HTTPS page",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.url.startsWith("https://")) return null;
      if (!page.images || page.images.length === 0) return null;

      const httpImages = page.images.filter((img) =>
        img.src.startsWith("http://")
      );

      if (httpImages.length > 0) {
        return {
          ruleId: "IMG-006",
          category: "images",
          severity: "high",
          title: "Images loaded over HTTP on HTTPS page",
          description:
            `${httpImages.length} image(s) are loaded over insecure HTTP on this HTTPS page. Modern browsers may block these images, causing broken visuals. Update all image URLs to use HTTPS to prevent mixed content warnings and ensure images display correctly.`,
          affectedUrl: page.url,
          evidence: {
            httpImageCount: httpImages.length,
            examples: httpImages.slice(0, 5).map((img) => img.src),
          },
        };
      }
      return null;
    },
  },
  {
    id: "IMG-007",
    category: "images",
    severity: "medium",
    title: "Too many images without lazy loading potential",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.images) return null;
      if (page.images.length > 30) {
        return {
          ruleId: "IMG-007",
          category: "images",
          severity: "medium",
          title: "Page has excessive number of images",
          description:
            `This page contains ${page.images.length} images. Pages with many images should implement lazy loading (loading="lazy") for offscreen images to reduce initial page load time and bandwidth. Consider using intersection observer or native lazy loading for images below the fold.`,
          affectedUrl: page.url,
          evidence: {
            imageCount: page.images.length,
            threshold: 30,
          },
        };
      }
      return null;
    },
  },
  {
    id: "IMG-008",
    category: "images",
    severity: "low",
    title: "All images missing alt text",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.images || page.images.length === 0) return null;
      if (page.images.length < 3) return null;

      const allMissing = page.images.every(
        (img) => !img.alt || img.alt.trim().length === 0
      );

      if (allMissing) {
        return {
          ruleId: "IMG-008",
          category: "images",
          severity: "low",
          title: "All images missing alt text",
          description:
            `Every image on this page (${page.images.length} total) is missing alt text, suggesting alt attributes are systematically omitted. This severely impacts accessibility for screen reader users and prevents search engines from indexing image content. Implement alt text across the entire page as a priority.`,
          affectedUrl: page.url,
          evidence: {
            imageCount: page.images.length,
            missingAltCount: page.images.length,
          },
        };
      }
      return null;
    },
  },
];
