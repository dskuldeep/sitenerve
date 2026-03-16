import type { CheerioAPI } from "cheerio";
import { isSameSiteHostname, normalizeHostname } from "@/lib/url-normalization";

export interface ExtractedPageData {
  url: string;
  canonicalUrl: string | null;
  statusCode: number;
  responseTime: number;
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  h4: string[];
  h5: string[];
  h6: string[];
  ogTags: Record<string, string>;
  jsonLd: unknown[];
  internalLinks: Array<{
    href: string;
    text: string;
    rel?: string;
    nofollow?: boolean;
  }>;
  externalLinks: Array<{
    href: string;
    text: string;
    rel?: string;
    nofollow?: boolean;
    statusCode?: number;
    isBroken?: boolean;
    redirectChain?: string[];
    error?: string;
  }>;
  images: Array<{ src: string; alt: string; width?: number; height?: number }>;
  wordCount: number;
  hreflangTags: Array<{ lang: string; href: string }>;
  pageSize: number;
}

export function extractPageData(
  $: CheerioAPI,
  url: string,
  siteOrigin: string,
  responseTime: number,
  statusCode: number,
  pageSize: number
): ExtractedPageData {
  const siteHostname = (() => {
    try {
      return normalizeHostname(new URL(siteOrigin).hostname);
    } catch {
      return "";
    }
  })();

  const getHeadings = (tag: string): string[] => {
    return $(tag)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
  };

  // Title
  const title = $("title").first().text().trim() || null;

  // Meta description
  const metaDesc =
    $('meta[name="description"]').first().attr("content")?.trim() || null;

  // Meta robots
  const metaRobots =
    $('meta[name="robots"]').first().attr("content")?.trim() || null;

  // Canonical
  const canonical =
    $('link[rel="canonical"]').first().attr("href")?.trim() || null;

  // Headings
  const h1 = getHeadings("h1");
  const h2 = getHeadings("h2");
  const h3 = getHeadings("h3");
  const h4 = getHeadings("h4");
  const h5 = getHeadings("h5");
  const h6 = getHeadings("h6");

  // OG tags
  const ogTags: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr("property");
    const content = $(el).attr("content");
    if (prop && content) ogTags[prop] = content;
  });

  // JSON-LD
  const jsonLd: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      jsonLd.push(JSON.parse($(el).text() || ""));
    } catch {
      // Invalid JSON-LD
    }
  });

  // Links
  const internalLinks: Array<{
    href: string;
    text: string;
    rel?: string;
    nofollow?: boolean;
  }> = [];
  const externalLinks: Array<{
    href: string;
    text: string;
    rel?: string;
    nofollow?: boolean;
    statusCode?: number;
    isBroken?: boolean;
    redirectChain?: string[];
    error?: string;
  }> = [];

  const seenInternal = new Set<string>();
  const seenExternal = new Set<string>();

  $("a[href]").each((_, link) => {
    const href = $(link).attr("href");
    if (!href) return;

    try {
      // Cheerio doesn't have window.location, we must resolve manually against url
      const resolved = new URL(href, url);
      const text = $(link).text().trim() || "";
      const relAttr = ($(link).attr("rel") || "").trim();
      const relTokens = relAttr.toLowerCase().split(/\s+/).filter(Boolean);
      const nofollow = relTokens.includes("nofollow");
      resolved.hash = "";
      resolved.hostname = normalizeHostname(resolved.hostname);

      if (isSameSiteHostname(resolved.hostname, siteHostname)) {
        const normalizedInternalHref = resolved.href;
        const dedupeKey = `${normalizedInternalHref}::${text.substring(0, 200)}`;
        if (seenInternal.has(dedupeKey)) return;
        seenInternal.add(dedupeKey);
        internalLinks.push({
          href: normalizedInternalHref,
          text: text.substring(0, 200),
          rel: relAttr || undefined,
          nofollow,
        });
      } else if (resolved.protocol.startsWith("http")) {
        const dedupeKey = `${resolved.href}::${text.substring(0, 200)}`;
        if (seenExternal.has(dedupeKey)) return;
        seenExternal.add(dedupeKey);
        externalLinks.push({
          href: resolved.href,
          text: text.substring(0, 200),
          rel: relAttr || undefined,
          nofollow,
        });
      }
    } catch {
      // Invalid URL
    }
  });

  // Images
  const images = $("img")
    .map((_, img) => {
      const src = $(img).attr("src") || "";
      const alt = $(img).attr("alt") || "";
      // In Cheerio we don't have naturalWidth easily, just pull attributes if present
      const width = parseInt($(img).attr("width") || "0", 10) || undefined;
      const height = parseInt($(img).attr("height") || "0", 10) || undefined;
      return { src, alt, width, height };
    })
    .get();

  // Word count (approximate by stripping HTML tags)
  const bodyText = $("body").text() || "";
  const wordCount = bodyText
    .replace(/[^\w\s]/gi, "")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;

  // Hreflang
  const hreflangTags = $('link[rel="alternate"][hreflang]')
    .map((_, el) => ({
      lang: $(el).attr("hreflang") || "",
      href: $(el).attr("href") || "",
    }))
    .get();

  return {
    url,
    statusCode,
    responseTime,
    pageSize,
    title,
    metaDescription: metaDesc,
    metaRobots,
    canonicalUrl: canonical,
    h1,
    h2,
    h3,
    h4,
    h5,
    h6,
    ogTags,
    jsonLd,
    internalLinks,
    externalLinks,
    images,
    wordCount,
    hreflangTags,
  };
}
