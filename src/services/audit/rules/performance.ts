import type { AuditRule, PageData, AuditIssue } from "../audit-engine";

type PerformanceAverages = {
  responseSampleSize: number;
  avgResponseTime: number;
  pageSizeSampleSize: number;
  avgPageSize: number;
};

const performanceAveragesCache = new WeakMap<PageData[], PerformanceAverages>();

function getPerformanceAverages(allPages: PageData[]): PerformanceAverages {
  const cached = performanceAveragesCache.get(allPages);
  if (cached) return cached;

  let responseSum = 0;
  let responseSampleSize = 0;
  let pageSizeSum = 0;
  let pageSizeSampleSize = 0;

  for (const page of allPages) {
    if (page.responseTime !== null) {
      responseSum += page.responseTime;
      responseSampleSize += 1;
    }
    if (page.pageSize !== null) {
      pageSizeSum += page.pageSize;
      pageSizeSampleSize += 1;
    }
  }

  const result: PerformanceAverages = {
    responseSampleSize,
    avgResponseTime: responseSampleSize > 0 ? responseSum / responseSampleSize : 0,
    pageSizeSampleSize,
    avgPageSize: pageSizeSampleSize > 0 ? pageSizeSum / pageSizeSampleSize : 0,
  };
  performanceAveragesCache.set(allPages, result);
  return result;
}

export const performanceRules: AuditRule[] = [
  {
    id: "PRF-001",
    category: "performance",
    severity: "critical",
    title: "Extremely slow response time (>5s)",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.responseTime === null) return null;
      if (page.responseTime > 5000) {
        return {
          ruleId: "PRF-001",
          category: "performance",
          severity: "critical",
          title: "Extremely slow response time (>5s)",
          description:
            `This page took ${(page.responseTime / 1000).toFixed(1)} seconds to respond, far exceeding acceptable thresholds. Extremely slow pages lead to high bounce rates and may be deprioritized by search engines. Investigate server-side bottlenecks, optimize database queries, implement caching, and consider upgrading hosting infrastructure.`,
          affectedUrl: page.url,
          evidence: {
            responseTimeMs: page.responseTime,
            threshold: 5000,
          },
        };
      }
      return null;
    },
  },
  {
    id: "PRF-002",
    category: "performance",
    severity: "high",
    title: "Large page size (>3MB)",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.pageSize === null) return null;
      const threeMB = 3 * 1024 * 1024;
      if (page.pageSize > threeMB) {
        return {
          ruleId: "PRF-002",
          category: "performance",
          severity: "high",
          title: "Large page size (>3MB)",
          description:
            `This page is ${(page.pageSize / (1024 * 1024)).toFixed(2)} MB, exceeding the 3 MB threshold. Large pages take longer to download, especially on mobile connections, and increase data usage. Compress images, minify CSS/JS, remove unused code, and consider lazy loading offscreen content.`,
          affectedUrl: page.url,
          evidence: {
            pageSizeBytes: page.pageSize,
            pageSizeMB: (page.pageSize / (1024 * 1024)).toFixed(2),
            threshold: "3 MB",
          },
        };
      }
      return null;
    },
  },
  {
    id: "PRF-003",
    category: "performance",
    severity: "medium",
    title: "Slow response time (>1s)",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.responseTime === null) return null;
      if (page.responseTime > 1000 && page.responseTime <= 3000) {
        return {
          ruleId: "PRF-003",
          category: "performance",
          severity: "medium",
          title: "Slow response time (>1s)",
          description:
            `This page took ${(page.responseTime / 1000).toFixed(1)} seconds to respond. While not critically slow, response times over 1 second can impact user experience and Core Web Vitals. Optimize server response by enabling compression, using a CDN, and reducing server-side processing time.`,
          affectedUrl: page.url,
          evidence: {
            responseTimeMs: page.responseTime,
            threshold: 1000,
          },
        };
      }
      return null;
    },
  },
  {
    id: "PRF-004",
    category: "performance",
    severity: "medium",
    title: "Page size over 1MB",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.pageSize === null) return null;
      const oneMB = 1024 * 1024;
      const threeMB = 3 * 1024 * 1024;
      if (page.pageSize > oneMB && page.pageSize <= threeMB) {
        return {
          ruleId: "PRF-004",
          category: "performance",
          severity: "medium",
          title: "Page size over 1MB",
          description:
            `This page is ${(page.pageSize / 1024).toFixed(0)} KB. Pages over 1 MB can be slow to load on mobile networks. Audit the page for large images, unminified scripts, and redundant resources. Consider implementing code splitting and lazy loading.`,
          affectedUrl: page.url,
          evidence: {
            pageSizeBytes: page.pageSize,
            pageSizeKB: (page.pageSize / 1024).toFixed(0),
            threshold: "1 MB",
          },
        };
      }
      return null;
    },
  },
  {
    id: "PRF-005",
    category: "performance",
    severity: "low",
    title: "Too many images on page",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.images) return null;
      if (page.images.length > 50) {
        return {
          ruleId: "PRF-005",
          category: "performance",
          severity: "low",
          title: "Too many images on page",
          description:
            `This page contains ${page.images.length} images. A high number of images increases page weight and HTTP requests, slowing page load. Implement lazy loading for offscreen images, use responsive image srcsets, and consider whether all images are necessary.`,
          affectedUrl: page.url,
          evidence: {
            imageCount: page.images.length,
            threshold: 50,
          },
        };
      }
      return null;
    },
  },
  {
    id: "PRF-006",
    category: "performance",
    severity: "medium",
    title: "Excessive internal links on page",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.internalLinks) return null;
      if (page.internalLinks.length > 200) {
        return {
          ruleId: "PRF-006",
          category: "performance",
          severity: "medium",
          title: "Excessive internal links on page",
          description:
            `This page has ${page.internalLinks.length} internal links, which exceeds the recommended maximum. Excessive links dilute PageRank passed to each linked page and can make the page appear spammy. Reduce the number of links by removing unnecessary navigation elements and consolidating link lists.`,
          affectedUrl: page.url,
          evidence: {
            internalLinkCount: page.internalLinks.length,
            threshold: 200,
          },
        };
      }
      return null;
    },
  },
  {
    id: "PRF-007",
    category: "performance",
    severity: "high",
    title: "Response time slower than site average by 3x",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      if (page.responseTime === null) return null;
      const { responseSampleSize, avgResponseTime } = getPerformanceAverages(allPages);
      if (responseSampleSize < 3) return null;

      if (page.responseTime > avgResponseTime * 3 && page.responseTime > 500) {
        return {
          ruleId: "PRF-007",
          category: "performance",
          severity: "high",
          title: "Response time slower than site average by 3x",
          description:
            `This page's response time (${(page.responseTime / 1000).toFixed(1)}s) is more than 3 times the site average (${(avgResponseTime / 1000).toFixed(1)}s). This outlier suggests a page-specific performance issue. Investigate queries, rendering logic, or resource loading unique to this page.`,
          affectedUrl: page.url,
          evidence: {
            responseTimeMs: page.responseTime,
            siteAverageMs: Math.round(avgResponseTime),
            multiplier: (page.responseTime / avgResponseTime).toFixed(1),
          },
        };
      }
      return null;
    },
  },
  {
    id: "PRF-008",
    category: "performance",
    severity: "low",
    title: "Page larger than site average by 5x",
    check: (page: PageData, allPages: PageData[]): AuditIssue | null => {
      if (page.pageSize === null) return null;
      const { pageSizeSampleSize, avgPageSize } = getPerformanceAverages(allPages);
      if (pageSizeSampleSize < 3) return null;

      if (page.pageSize > avgPageSize * 5 && page.pageSize > 100 * 1024) {
        return {
          ruleId: "PRF-008",
          category: "performance",
          severity: "low",
          title: "Page larger than site average by 5x",
          description:
            `This page (${(page.pageSize / 1024).toFixed(0)} KB) is more than 5 times the site average (${(avgPageSize / 1024).toFixed(0)} KB). Investigate whether this page has unnecessarily large resources or duplicated content that can be optimized.`,
          affectedUrl: page.url,
          evidence: {
            pageSizeKB: (page.pageSize / 1024).toFixed(0),
            siteAverageKB: (avgPageSize / 1024).toFixed(0),
            multiplier: (page.pageSize / avgPageSize).toFixed(1),
          },
        };
      }
      return null;
    },
  },
];
