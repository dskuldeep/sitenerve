import { gunzipSync } from "node:zlib";
import { isSameSiteHostname, normalizeHostname } from "@/lib/url-normalization";

interface SitemapError {
  sitemapUrl: string;
  message: string;
}

export interface SitemapDiscoveryInput {
  robotsSitemaps: string[];
  userProvidedSitemap?: string | null;
}

export interface SitemapDiscoveryResult {
  sitemapUrlsDiscovered: string[];
  sitemapUrlsParsed: string[];
  pageUrls: string[];
  errors: SitemapError[];
  sourceSummary: {
    robotsTxtCount: number;
    userProvidedCount: number;
  };
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function extractLocValues(xml: string): string[] {
  const locations: string[] = [];
  const regex = /<loc[^>]*>([\s\S]*?)<\/loc>/gi;

  let match = regex.exec(xml);
  while (match) {
    const raw = decodeXmlEntities(match[1].trim());
    if (raw) locations.push(raw);
    match = regex.exec(xml);
  }

  return locations;
}

function isSitemapIndex(xml: string): boolean {
  return /<\s*sitemapindex[\s>]/i.test(xml);
}

function normalizeAbsoluteUrl(rawUrl: string, baseUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl, baseUrl);
    parsed.hostname = normalizeHostname(parsed.hostname);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

export class SitemapParser {
  private readonly siteOrigin: string;
  private readonly siteHostname: string;

  constructor(siteUrl: string) {
    this.siteOrigin = new URL(siteUrl).origin;
    this.siteHostname = normalizeHostname(new URL(siteUrl).hostname);
  }

  async discover(input: SitemapDiscoveryInput): Promise<SitemapDiscoveryResult> {
    const discovered = new Set<string>();

    for (const sitemap of input.robotsSitemaps) {
      const normalized = normalizeAbsoluteUrl(sitemap, this.siteOrigin);
      if (normalized) discovered.add(normalized);
    }

    if (input.userProvidedSitemap) {
      const normalized = normalizeAbsoluteUrl(input.userProvidedSitemap, this.siteOrigin);
      if (normalized) discovered.add(normalized);
    }

    const result: SitemapDiscoveryResult = {
      sitemapUrlsDiscovered: Array.from(discovered),
      sitemapUrlsParsed: [],
      pageUrls: [],
      errors: [],
      sourceSummary: {
        robotsTxtCount: input.robotsSitemaps.length,
        userProvidedCount: input.userProvidedSitemap ? 1 : 0,
      },
    };

    const visitedSitemaps = new Set<string>();
    const queuedSitemaps = new Set<string>(result.sitemapUrlsDiscovered);
    const parsedSitemaps = new Set<string>();
    const pageUrls = new Set<string>();
    const pendingSitemaps = [...result.sitemapUrlsDiscovered];

    while (pendingSitemaps.length > 0) {
      const sitemapUrl = pendingSitemaps.shift();
      if (!sitemapUrl) continue;
      if (visitedSitemaps.has(sitemapUrl)) continue;

      visitedSitemaps.add(sitemapUrl);
      queuedSitemaps.delete(sitemapUrl);

      const parseResult = await this.parseSitemap(sitemapUrl);
      if (!parseResult.ok) {
        result.errors.push({
          sitemapUrl,
          message: parseResult.error,
        });
        continue;
      }

      parsedSitemaps.add(sitemapUrl);

      if (parseResult.isIndex) {
        for (const loc of parseResult.locValues) {
          const normalized = normalizeAbsoluteUrl(loc, sitemapUrl);
          if (!normalized) continue;
          if (visitedSitemaps.has(normalized)) continue;
          if (queuedSitemaps.has(normalized)) continue;
          pendingSitemaps.push(normalized);
          queuedSitemaps.add(normalized);
        }
        continue;
      }

      for (const loc of parseResult.locValues) {
        const normalized = normalizeAbsoluteUrl(loc, sitemapUrl);
        if (!normalized) continue;
        if (!isSameSiteHostname(new URL(normalized).hostname, this.siteHostname)) continue;
        pageUrls.add(normalized);
      }
    }

    result.sitemapUrlsParsed = Array.from(parsedSitemaps);
    result.pageUrls = Array.from(pageUrls);
    return result;
  }

  private async parseSitemap(
    sitemapUrl: string
  ): Promise<
    | { ok: true; isIndex: boolean; locValues: string[] }
    | { ok: false; error: string }
  > {
    try {
      const response = await fetch(sitemapUrl, {
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": "SiteNerveBot/1.0",
          Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}` };
      }

      const raw = Buffer.from(await response.arrayBuffer());
      const isGzip =
        sitemapUrl.endsWith(".gz") ||
        response.headers.get("content-type")?.includes("gzip") ||
        (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b);

      let xml: string;
      if (isGzip) {
        try {
          xml = gunzipSync(raw).toString("utf-8");
        } catch {
          return { ok: false, error: "Failed to decompress gzip sitemap" };
        }
      } else {
        xml = raw.toString("utf-8");
      }

      const locValues = extractLocValues(xml);
      return { ok: true, isIndex: isSitemapIndex(xml), locValues };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown sitemap parse error",
      };
    }
  }
}
