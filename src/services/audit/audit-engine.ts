export interface PageData {
  url: string;
  canonicalUrl: string | null;
  statusCode: number | null;
  responseTime: number | null;
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  ogTags: Record<string, string> | null;
  jsonLd: unknown[] | null;
  internalLinks: Array<{
    href: string;
    text: string;
    rel?: string;
    nofollow?: boolean;
  }> | null;
  externalLinks: Array<{
    href: string;
    text: string;
    rel?: string;
    nofollow?: boolean;
    statusCode?: number;
    isBroken?: boolean;
    redirectChain?: string[];
    error?: string;
  }> | null;
  images: Array<{ src: string; alt: string; width?: number; height?: number }> | null;
  wordCount: number | null;
  hreflangTags: Array<{ lang: string; href: string }> | null;
  pageSize: number | null;
}

export interface AuditIssue {
  ruleId: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  affectedUrl: string;
  evidence: Record<string, unknown>;
}

export interface AuditRule {
  id: string;
  category: string;
  severity: string;
  title: string;
  check: (page: PageData, allPages: PageData[]) => AuditIssue | null;
}
