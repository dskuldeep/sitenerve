import type { AuditRule, PageData, AuditIssue } from "../audit-engine";

export const structuredDataRules: AuditRule[] = [
  {
    id: "SD-001",
    category: "structured-data",
    severity: "medium",
    title: "No structured data found",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode !== 200) return null;
      if (!page.jsonLd || page.jsonLd.length === 0) {
        return {
          ruleId: "SD-001",
          category: "structured-data",
          severity: "medium",
          title: "No structured data found",
          description:
            "This page has no JSON-LD structured data. Structured data helps search engines understand your content and can enable rich snippets in search results. Add relevant Schema.org markup such as Article, Product, FAQPage, or Organization to improve search visibility.",
          affectedUrl: page.url,
          evidence: {
            jsonLdCount: 0,
          },
        };
      }
      return null;
    },
  },
  {
    id: "SD-002",
    category: "structured-data",
    severity: "high",
    title: "Structured data missing @type",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.jsonLd || page.jsonLd.length === 0) return null;

      const missingType = page.jsonLd.filter((item) => {
        if (typeof item !== "object" || item === null) return true;
        return !("@type" in (item as Record<string, unknown>));
      });

      if (missingType.length > 0) {
        return {
          ruleId: "SD-002",
          category: "structured-data",
          severity: "high",
          title: "Structured data missing @type",
          description:
            `${missingType.length} structured data block(s) on this page are missing the required @type property. Without @type, search engines cannot interpret the structured data. Add a valid Schema.org @type to each JSON-LD block.`,
          affectedUrl: page.url,
          evidence: {
            totalBlocks: page.jsonLd.length,
            missingTypeCount: missingType.length,
          },
        };
      }
      return null;
    },
  },
  {
    id: "SD-003",
    category: "structured-data",
    severity: "medium",
    title: "Structured data missing @context",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.jsonLd || page.jsonLd.length === 0) return null;

      const missingContext = page.jsonLd.filter((item) => {
        if (typeof item !== "object" || item === null) return true;
        const obj = item as Record<string, unknown>;
        return !obj["@context"];
      });

      if (missingContext.length > 0) {
        return {
          ruleId: "SD-003",
          category: "structured-data",
          severity: "medium",
          title: "Structured data missing @context",
          description:
            `${missingContext.length} structured data block(s) are missing the @context property. The @context (typically "https://schema.org") is required for search engines to interpret the vocabulary. Add "@context": "https://schema.org" to each JSON-LD block.`,
          affectedUrl: page.url,
          evidence: {
            totalBlocks: page.jsonLd.length,
            missingContextCount: missingContext.length,
          },
        };
      }
      return null;
    },
  },
  {
    id: "SD-004",
    category: "structured-data",
    severity: "medium",
    title: "Organization schema missing name",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.jsonLd || page.jsonLd.length === 0) return null;

      for (const item of page.jsonLd) {
        if (typeof item !== "object" || item === null) continue;
        const obj = item as Record<string, unknown>;
        if (obj["@type"] === "Organization" && !obj["name"]) {
          return {
            ruleId: "SD-004",
            category: "structured-data",
            severity: "medium",
            title: "Organization schema missing name",
            description:
              "The Organization structured data on this page is missing the required 'name' property. The name field is essential for search engines to identify the organization. Add a 'name' property with the official organization name.",
            affectedUrl: page.url,
            evidence: {
              schemaType: "Organization",
              missingProperty: "name",
            },
          };
        }
      }
      return null;
    },
  },
  {
    id: "SD-005",
    category: "structured-data",
    severity: "medium",
    title: "Article schema missing required fields",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.jsonLd || page.jsonLd.length === 0) return null;

      for (const item of page.jsonLd) {
        if (typeof item !== "object" || item === null) continue;
        const obj = item as Record<string, unknown>;
        const type = obj["@type"];
        if (type === "Article" || type === "NewsArticle" || type === "BlogPosting") {
          const missingFields: string[] = [];
          if (!obj["headline"]) missingFields.push("headline");
          if (!obj["author"]) missingFields.push("author");
          if (!obj["datePublished"]) missingFields.push("datePublished");
          if (!obj["image"]) missingFields.push("image");

          if (missingFields.length > 0) {
            return {
              ruleId: "SD-005",
              category: "structured-data",
              severity: "medium",
              title: "Article schema missing required fields",
              description:
                `The ${type} structured data is missing recommended fields: ${missingFields.join(", ")}. These fields are important for Google to display rich results for articles. Add the missing properties to improve eligibility for article rich snippets.`,
              affectedUrl: page.url,
              evidence: {
                schemaType: type,
                missingFields,
              },
            };
          }
        }
      }
      return null;
    },
  },
  {
    id: "SD-006",
    category: "structured-data",
    severity: "low",
    title: "Product schema missing price information",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.jsonLd || page.jsonLd.length === 0) return null;

      for (const item of page.jsonLd) {
        if (typeof item !== "object" || item === null) continue;
        const obj = item as Record<string, unknown>;
        if (obj["@type"] === "Product") {
          const hasOffers = obj["offers"] !== undefined && obj["offers"] !== null;
          if (!hasOffers) {
            return {
              ruleId: "SD-006",
              category: "structured-data",
              severity: "low",
              title: "Product schema missing price information",
              description:
                "The Product structured data on this page is missing 'offers' with pricing information. Without price data, Google cannot display price-related rich snippets. Add an 'offers' property with 'price' and 'priceCurrency' to enable product rich results.",
              affectedUrl: page.url,
              evidence: {
                schemaType: "Product",
                missingProperty: "offers",
              },
            };
          }
        }
      }
      return null;
    },
  },
  {
    id: "SD-007",
    category: "structured-data",
    severity: "low",
    title: "BreadcrumbList schema missing or incomplete",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (page.statusCode !== 200) return null;
      if (!page.jsonLd || page.jsonLd.length === 0) return null;

      const hasBreadcrumb = page.jsonLd.some((item) => {
        if (typeof item !== "object" || item === null) return false;
        const obj = item as Record<string, unknown>;
        return obj["@type"] === "BreadcrumbList";
      });

      // Check if the page is deep enough to warrant breadcrumbs
      try {
        const url = new URL(page.url);
        const depth = url.pathname.split("/").filter((s) => s.length > 0).length;
        if (depth >= 2 && !hasBreadcrumb) {
          return {
            ruleId: "SD-007",
            category: "structured-data",
            severity: "low",
            title: "BreadcrumbList schema missing on deep page",
            description:
              "This page is multiple levels deep in the site hierarchy but lacks BreadcrumbList structured data. Breadcrumb markup helps search engines understand site structure and can display breadcrumb navigation in search results. Add BreadcrumbList schema with itemListElement entries.",
            affectedUrl: page.url,
            evidence: {
              depth,
              hasBreadcrumbSchema: false,
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
    id: "SD-008",
    category: "structured-data",
    severity: "high",
    title: "Structured data contains invalid JSON-LD",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.jsonLd || page.jsonLd.length === 0) return null;

      const invalidBlocks: number[] = [];
      page.jsonLd.forEach((item, index) => {
        if (item === null || item === undefined) {
          invalidBlocks.push(index);
        } else if (typeof item === "string") {
          // String values suggest unparsed or malformed JSON
          invalidBlocks.push(index);
        } else if (typeof item === "object" && Object.keys(item as object).length === 0) {
          invalidBlocks.push(index);
        }
      });

      if (invalidBlocks.length > 0) {
        return {
          ruleId: "SD-008",
          category: "structured-data",
          severity: "high",
          title: "Structured data contains invalid JSON-LD",
          description:
            `${invalidBlocks.length} structured data block(s) appear to be empty, null, or malformed. Invalid structured data is ignored by search engines and may trigger errors in Google Search Console. Validate your JSON-LD using Google's Rich Results Test and fix any syntax issues.`,
          affectedUrl: page.url,
          evidence: {
            totalBlocks: page.jsonLd.length,
            invalidBlockIndices: invalidBlocks,
          },
        };
      }
      return null;
    },
  },
  {
    id: "SD-009",
    category: "structured-data",
    severity: "high",
    title: "Structured data has invalid @context",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.jsonLd || page.jsonLd.length === 0) return null;

      const invalidContexts: Array<{ index: number; context: unknown }> = [];
      page.jsonLd.forEach((item, index) => {
        if (typeof item !== "object" || item === null) return;
        const context = (item as Record<string, unknown>)["@context"];
        if (typeof context !== "string" || !context.includes("schema.org")) {
          invalidContexts.push({ index, context: context ?? null });
        }
      });

      if (invalidContexts.length > 0) {
        return {
          ruleId: "SD-009",
          category: "structured-data",
          severity: "high",
          title: "Structured data has invalid @context",
          description:
            "One or more JSON-LD blocks have missing or invalid @context values. Search engines rely on @context (typically https://schema.org) to interpret schema terms. Fix @context values to avoid schema parsing failures.",
          affectedUrl: page.url,
          evidence: {
            invalidContextCount: invalidContexts.length,
            invalidContexts,
          },
        };
      }

      return null;
    },
  },
  {
    id: "SD-010",
    category: "structured-data",
    severity: "medium",
    title: "FAQ schema missing required question-answer pairs",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.jsonLd || page.jsonLd.length === 0) return null;

      for (const item of page.jsonLd) {
        if (typeof item !== "object" || item === null) continue;
        const obj = item as Record<string, unknown>;
        if (obj["@type"] !== "FAQPage") continue;

        const mainEntity = obj["mainEntity"];
        if (!Array.isArray(mainEntity) || mainEntity.length === 0) {
          return {
            ruleId: "SD-010",
            category: "structured-data",
            severity: "medium",
            title: "FAQ schema missing required question-answer pairs",
            description:
              "FAQPage schema exists but mainEntity is missing or empty. FAQ rich results require Question entities with acceptedAnswer text.",
            affectedUrl: page.url,
            evidence: {
              schemaType: "FAQPage",
              mainEntityType: typeof mainEntity,
            },
          };
        }

        const invalidItems = mainEntity.filter((entry) => {
          if (!entry || typeof entry !== "object") return true;
          const q = entry as Record<string, unknown>;
          const accepted = q.acceptedAnswer as Record<string, unknown> | undefined;
          return (
            q["@type"] !== "Question" ||
            typeof q["name"] !== "string" ||
            !accepted ||
            accepted["@type"] !== "Answer" ||
            typeof accepted["text"] !== "string"
          );
        });

        if (invalidItems.length > 0) {
          return {
            ruleId: "SD-010",
            category: "structured-data",
            severity: "medium",
            title: "FAQ schema missing required question-answer pairs",
            description:
              "One or more FAQ entities are incomplete. Each mainEntity item should be a Question with name and acceptedAnswer.text.",
            affectedUrl: page.url,
            evidence: {
              invalidQuestionCount: invalidItems.length,
              totalQuestions: mainEntity.length,
            },
          };
        }
      }

      return null;
    },
  },
  {
    id: "SD-011",
    category: "structured-data",
    severity: "medium",
    title: "Breadcrumb schema missing itemListElement entries",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.jsonLd || page.jsonLd.length === 0) return null;

      for (const item of page.jsonLd) {
        if (typeof item !== "object" || item === null) continue;
        const obj = item as Record<string, unknown>;
        if (obj["@type"] !== "BreadcrumbList") continue;

        const items = obj["itemListElement"];
        if (!Array.isArray(items) || items.length === 0) {
          return {
            ruleId: "SD-011",
            category: "structured-data",
            severity: "medium",
            title: "Breadcrumb schema missing itemListElement entries",
            description:
              "BreadcrumbList schema exists but itemListElement is missing or empty. Breadcrumb rich results need a complete ordered list of ListItem entries with position, name, and item URL.",
            affectedUrl: page.url,
            evidence: {
              schemaType: "BreadcrumbList",
              itemListElementType: typeof items,
            },
          };
        }

        const invalidEntries = items.filter((entry) => {
          if (!entry || typeof entry !== "object") return true;
          const itemObj = entry as Record<string, unknown>;
          return (
            itemObj["@type"] !== "ListItem" ||
            typeof itemObj["position"] !== "number" ||
            typeof itemObj["name"] !== "string" ||
            (typeof itemObj["item"] !== "string" && typeof itemObj["item"] !== "object")
          );
        });

        if (invalidEntries.length > 0) {
          return {
            ruleId: "SD-011",
            category: "structured-data",
            severity: "medium",
            title: "Breadcrumb schema missing itemListElement entries",
            description:
              "Some breadcrumb entries are malformed. Ensure each entry is a ListItem with position, name, and item URL.",
            affectedUrl: page.url,
            evidence: {
              invalidEntryCount: invalidEntries.length,
              totalEntries: items.length,
            },
          };
        }
      }

      return null;
    },
  },
  {
    id: "SD-012",
    category: "structured-data",
    severity: "medium",
    title: "Product schema offers missing price or currency",
    check: (page: PageData, _allPages: PageData[]): AuditIssue | null => {
      if (!page.jsonLd || page.jsonLd.length === 0) return null;

      for (const item of page.jsonLd) {
        if (typeof item !== "object" || item === null) continue;
        const obj = item as Record<string, unknown>;
        if (obj["@type"] !== "Product") continue;

        const offers = obj["offers"];
        if (!offers || typeof offers !== "object") continue;

        const offerObj = offers as Record<string, unknown>;
        const missingFields: string[] = [];
        if (!offerObj["price"]) missingFields.push("price");
        if (!offerObj["priceCurrency"]) missingFields.push("priceCurrency");

        if (missingFields.length > 0) {
          return {
            ruleId: "SD-012",
            category: "structured-data",
            severity: "medium",
            title: "Product schema offers missing price or currency",
            description:
              "Product offers are missing required pricing fields. Provide both price and priceCurrency for valid Product rich result eligibility.",
            affectedUrl: page.url,
            evidence: {
              missingFields,
            },
          };
        }
      }

      return null;
    },
  },
];
