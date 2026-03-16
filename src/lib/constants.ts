export const APP_NAME = "SiteNerve";

export const SEVERITY_WEIGHTS: Record<string, number> = {
  CRITICAL: 10,
  HIGH: 5,
  MEDIUM: 3,
  LOW: 1,
  INFO: 0,
};

export const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "#EF4444",
  HIGH: "#F97316",
  MEDIUM: "#F59E0B",
  LOW: "#3B82F6",
  INFO: "#64748B",
};

export const NODE_HEALTH_COLORS: Record<string, string> = {
  healthy: "#10B981",
  low: "#F59E0B",
  medium: "#F97316",
  high: "#EF4444",
  unreachable: "#64748B",
};

export const MAX_CRAWL_DEPTH = 10;
export const MAX_CRAWL_PAGES = 10000;
export const DEFAULT_CRAWL_RATE = 2; // requests per second

export const ISSUE_CATEGORIES = [
  "INDEXABILITY",
  "CRAWLABILITY",
  "ON_PAGE",
  "PERFORMANCE",
  "STRUCTURED_DATA",
  "IMAGES",
  "LINKS",
  "INTERNATIONALIZATION",
  "CANONICALIZATION",
  "SECURITY",
  "MOBILE",
  "SOCIAL",
] as const;

export const TRIGGER_TYPES = [
  { value: "POST_CRAWL", label: "Post-Crawl" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "ON_NEW_ISSUES", label: "On New Issues" },
  { value: "ON_NEW_PAGES", label: "On New Pages" },
  { value: "MANUAL", label: "Manual" },
  { value: "WEBHOOK_INBOUND", label: "Webhook Inbound" },
] as const;
