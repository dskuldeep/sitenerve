export function normalizeSiteUrl(raw: string): string {
  const url = raw.trim();

  if (!/^https?:\/\//i.test(url)) {
    return normalizeSiteUrl(`https://${url}`);
  }

  const parsed = new URL(url);
  parsed.protocol = "https:";
  parsed.hostname = normalizeHostname(parsed.hostname);
  parsed.hash = "";
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.href.replace(/\/+$/, "");
}

export function normalizeSitemapUrl(raw: string, siteUrl: string): string {
  const value = raw.trim();
  if (!value) {
    throw new Error("Sitemap URL is required");
  }

  const resolved = new URL(value, `${normalizeSiteUrl(siteUrl)}/`);
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new Error("Sitemap URL must use http or https");
  }

  resolved.hostname = normalizeHostname(resolved.hostname);
  resolved.hash = "";
  return resolved.href;
}

export function normalizeOptionalSitemapUrl(
  raw: string | null | undefined,
  siteUrl: string
): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }

  return normalizeSitemapUrl(value, siteUrl);
}

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

export function isSameSiteHostname(hostA: string, hostB: string): boolean {
  const a = normalizeHostname(hostA);
  const b = normalizeHostname(hostB);
  if (!a || !b) return false;

  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function normalizeComparableUrl(raw: string, baseUrl?: string): string {
  const parsed = new URL(raw, baseUrl);
  parsed.hash = "";
  parsed.hostname = normalizeHostname(parsed.hostname);

  if (
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80")
  ) {
    parsed.port = "";
  }

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.href;
}

export function areEquivalentUrls(a: string, b: string, baseUrl?: string): boolean {
  try {
    return normalizeComparableUrl(a, baseUrl) === normalizeComparableUrl(b, baseUrl);
  } catch {
    return a.replace(/\/$/, "") === b.replace(/\/$/, "");
  }
}

export function areEquivalentSiteUrls(a: string, b: string): boolean {
  try {
    return normalizeSiteUrl(a) === normalizeSiteUrl(b);
  } catch {
    return false;
  }
}
