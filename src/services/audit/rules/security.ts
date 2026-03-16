import type { AuditRule, PageData, AuditIssue } from "../audit-engine";

export const securityRules: AuditRule[] = [
  {
    id: "SEC-001",
    category: "security",
    severity: "critical",
    title: "Page served over HTTP (not HTTPS)",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.url.startsWith("http://")) {
        return {
          ruleId: "SEC-001",
          category: "security",
          severity: "critical",
          title: "Page served over HTTP (not HTTPS)",
          description:
            "This page is served over insecure HTTP. HTTPS is a confirmed Google ranking factor, and browsers mark HTTP pages as 'Not Secure.' Migrate the entire site to HTTPS by obtaining an SSL certificate, configuring your server, and redirecting all HTTP URLs to HTTPS.",
          affectedUrl: page.url,
          evidence: {
            protocol: "http",
          },
        };
      }
      return null;
    },
  },
  {
    id: "SEC-002",
    category: "security",
    severity: "high",
    title: "Mixed content: images loaded over HTTP",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.url.startsWith("https://")) return null;
      if (!page.images || page.images.length === 0) return null;

      const httpImages = page.images.filter((img) => img.src.startsWith("http://"));

      if (httpImages.length > 0) {
        return {
          ruleId: "SEC-002",
          category: "security",
          severity: "high",
          title: "Mixed content: images loaded over HTTP",
          description:
            `${httpImages.length} image(s) on this HTTPS page are loaded over HTTP. Mixed content triggers browser security warnings and may block resource loading. Update all image sources to use HTTPS URLs.`,
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
    id: "SEC-003",
    category: "security",
    severity: "high",
    title: "Mixed content: internal links using HTTP",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.url.startsWith("https://")) return null;
      if (!page.internalLinks) return null;

      const httpLinks = page.internalLinks.filter((link) =>
        link.href.startsWith("http://")
      );

      if (httpLinks.length > 0) {
        return {
          ruleId: "SEC-003",
          category: "security",
          severity: "high",
          title: "Mixed content: internal links using HTTP",
          description:
            `${httpLinks.length} internal link(s) use HTTP instead of HTTPS. While links are not blocked as mixed content, they force unnecessary redirects and may leak referrer information. Update all internal links to use HTTPS.`,
          affectedUrl: page.url,
          evidence: {
            httpLinkCount: httpLinks.length,
            examples: httpLinks.slice(0, 5).map((l) => l.href),
          },
        };
      }
      return null;
    },
  },
  {
    id: "SEC-004",
    category: "security",
    severity: "medium",
    title: "External links to HTTP destinations",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.externalLinks) return null;

      const httpExternal = page.externalLinks.filter((link) =>
        link.href.startsWith("http://")
      );

      if (httpExternal.length > 5) {
        return {
          ruleId: "SEC-004",
          category: "security",
          severity: "medium",
          title: "External links to HTTP destinations",
          description:
            `${httpExternal.length} external link(s) point to insecure HTTP URLs. Linking to HTTP pages can affect user trust and may signal lower quality to search engines. Where possible, update external links to their HTTPS equivalents.`,
          affectedUrl: page.url,
          evidence: {
            httpExternalCount: httpExternal.length,
            examples: httpExternal.slice(0, 10).map((l) => l.href),
          },
        };
      }
      return null;
    },
  },
  {
    id: "SEC-005",
    category: "security",
    severity: "medium",
    title: "Canonical URL uses different protocol",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.canonicalUrl) return null;

      const pageIsHttps = page.url.startsWith("https://");
      const canonIsHttps = page.canonicalUrl.startsWith("https://");

      if (pageIsHttps !== canonIsHttps) {
        return {
          ruleId: "SEC-005",
          category: "security",
          severity: "medium",
          title: "Canonical URL uses different protocol",
          description:
            `The canonical URL uses ${canonIsHttps ? "HTTPS" : "HTTP"} while the page is served over ${pageIsHttps ? "HTTPS" : "HTTP"}. Protocol mismatches in canonical tags can cause indexing confusion. Ensure the canonical URL matches the preferred protocol (HTTPS recommended).`,
          affectedUrl: page.url,
          evidence: {
            pageProtocol: pageIsHttps ? "https" : "http",
            canonicalProtocol: canonIsHttps ? "https" : "http",
            canonicalUrl: page.canonicalUrl,
          },
        };
      }
      return null;
    },
  },
  {
    id: "SEC-006",
    category: "security",
    severity: "low",
    title: "External links without rel=noopener",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.externalLinks) return null;

      // Flag if there are many external links (potential security risk with target=_blank)
      if (page.externalLinks.length > 10) {
        return {
          ruleId: "SEC-006",
          category: "security",
          severity: "low",
          title: "Many external links detected (check for rel=noopener)",
          description:
            `This page has ${page.externalLinks.length} external links. Ensure all external links that open in new tabs include rel="noopener noreferrer" to prevent the linked page from accessing the window.opener property. This is a security best practice that also improves performance.`,
          affectedUrl: page.url,
          evidence: {
            externalLinkCount: page.externalLinks.length,
          },
        };
      }
      return null;
    },
  },
  {
    id: "SEC-007",
    category: "security",
    severity: "medium",
    title: "Hreflang targets use mixed protocols",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.hreflangTags || page.hreflangTags.length === 0) return null;

      const httpTargets = page.hreflangTags.filter((tag) =>
        tag.href.startsWith("http://")
      );
      const httpsTargets = page.hreflangTags.filter((tag) =>
        tag.href.startsWith("https://")
      );

      if (httpTargets.length > 0 && httpsTargets.length > 0) {
        return {
          ruleId: "SEC-007",
          category: "security",
          severity: "medium",
          title: "Hreflang targets use mixed protocols",
          description:
            `The hreflang tags on this page mix HTTP and HTTPS URLs (${httpTargets.length} HTTP, ${httpsTargets.length} HTTPS). All hreflang targets should use a consistent protocol, preferably HTTPS. Update all hreflang href values to use HTTPS.`,
          affectedUrl: page.url,
          evidence: {
            httpCount: httpTargets.length,
            httpsCount: httpsTargets.length,
            httpExamples: httpTargets.slice(0, 3).map((t) => t.href),
          },
        };
      }
      return null;
    },
  },
  {
    id: "SEC-008",
    category: "security",
    severity: "high",
    title: "Page URL contains potentially sensitive parameters",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      try {
        const url = new URL(page.url);
        const sensitiveParams = [
          "token", "key", "apikey", "api_key", "secret",
          "password", "pwd", "auth", "session", "sessionid",
          "access_token", "refresh_token", "jwt",
        ];

        const foundSensitive: string[] = [];
        for (const [param] of url.searchParams) {
          if (sensitiveParams.includes(param.toLowerCase())) {
            foundSensitive.push(param);
          }
        }

        if (foundSensitive.length > 0) {
          return {
            ruleId: "SEC-008",
            category: "security",
            severity: "high",
            title: "Page URL contains potentially sensitive parameters",
            description:
              `This URL contains query parameter(s) that may expose sensitive data: ${foundSensitive.join(", ")}. URLs with sensitive parameters can be logged by servers, cached by browsers, and indexed by search engines. Move sensitive data to request headers or POST body, and add noindex to prevent indexing.`,
            affectedUrl: page.url,
            evidence: {
              sensitiveParams: foundSensitive,
            },
          };
        }
      } catch {
        // Invalid URL
      }
      return null;
    },
  },
];
