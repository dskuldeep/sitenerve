interface RobotsRule {
  userAgent: string;
  allow: string[];
  disallow: string[];
  crawlDelay?: number;
  sitemaps: string[];
}

export class RobotsParser {
  private rules: RobotsRule[] = [];
  private sitemaps: string[] = [];
  private robotsUrl: string | null = null;
  private robotsFound = false;
  private fetchError: string | null = null;

  async fetch(siteUrl: string): Promise<void> {
    try {
      const url = new URL("/robots.txt", siteUrl);
      this.robotsUrl = url.toString();
      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        this.robotsFound = false;
        this.fetchError = `robots.txt returned HTTP ${response.status}`;
        return;
      }

      this.robotsFound = true;
      this.fetchError = null;
      const text = await response.text();
      this.parse(text);
    } catch (error) {
      this.robotsFound = false;
      this.fetchError = error instanceof Error ? error.message : "Unknown robots.txt fetch error";
      // robots.txt not available — allow all
    }
  }

  private parse(text: string): void {
    const lines = text.split("\n").map((l) => l.trim());
    let currentRule: RobotsRule | null = null;

    for (const line of lines) {
      if (line.startsWith("#") || line === "") continue;

      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      const directive = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();

      switch (directive) {
        case "user-agent":
          currentRule = {
            userAgent: value.toLowerCase(),
            allow: [],
            disallow: [],
            sitemaps: [],
          };
          this.rules.push(currentRule);
          break;
        case "allow":
          if (currentRule) currentRule.allow.push(value);
          break;
        case "disallow":
          if (currentRule) currentRule.disallow.push(value);
          break;
        case "crawl-delay":
          if (currentRule) currentRule.crawlDelay = parseFloat(value);
          break;
        case "sitemap":
          this.sitemaps.push(value);
          if (currentRule) currentRule.sitemaps.push(value);
          break;
      }
    }
  }

  isAllowed(url: string, userAgent: string = "*"): boolean {
    if (!this.robotsFound) return true; // No robots.txt → allow everything

    const path = new URL(url).pathname + new URL(url).search;
    const applicableRules = this.rules.filter(
      (r) => r.userAgent === "*" || r.userAgent === userAgent.toLowerCase()
    );

    if (applicableRules.length === 0) return true;

    // Use longest-match-wins semantics (per Google's robots.txt spec)
    for (const rule of applicableRules) {
      let longestAllow = -1;
      let longestDisallow = -1;

      for (const pattern of rule.allow) {
        if (this.matchesPattern(path, pattern)) {
          longestAllow = Math.max(longestAllow, pattern.length);
        }
      }

      for (const pattern of rule.disallow) {
        if (pattern === "") continue; // Empty disallow = allow all
        if (this.matchesPattern(path, pattern)) {
          longestDisallow = Math.max(longestDisallow, pattern.length);
        }
      }

      // If both match, the longer (more specific) pattern wins.
      // If equal length, allow wins.
      if (longestDisallow > longestAllow) return false;
    }

    return true;
  }

  private matchesPattern(path: string, pattern: string): boolean {
    if (pattern === "") return false;
    if (pattern === "/") return true;

    // Handle wildcard patterns
    if (pattern.includes("*")) {
      const regex = new RegExp(
        "^" + pattern.replace(/\*/g, ".*").replace(/\$/g, "$") + ".*"
      );
      return regex.test(path);
    }

    // Handle end-of-string marker
    if (pattern.endsWith("$")) {
      return path === pattern.slice(0, -1);
    }

    return path.startsWith(pattern);
  }

  getCrawlDelay(userAgent: string = "*"): number | undefined {
    const rule = this.rules.find(
      (r) => r.userAgent === userAgent.toLowerCase() || r.userAgent === "*"
    );
    return rule?.crawlDelay;
  }

  getSitemaps(): string[] {
    return [...new Set(this.sitemaps)];
  }

  getRobotsUrl(): string | null {
    return this.robotsUrl;
  }

  hasRobotsTxt(): boolean {
    return this.robotsFound;
  }

  getFetchError(): string | null {
    return this.fetchError;
  }
}
