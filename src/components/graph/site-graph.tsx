"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import type { ForceGraphMethods as ForceGraph2DMethods } from "react-force-graph-2d";
import type { ForceGraphMethods as ForceGraph3DMethods } from "react-force-graph-3d";
import type { GraphNodeData, GraphEdgeData, GraphData } from "@/types/graph";
import { NODE_HEALTH_COLORS } from "@/lib/constants";
import { isSameSiteHostname, normalizeComparableUrl } from "@/lib/url-normalization";
import { GraphControls } from "./graph-controls";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/issues/severity-badge";
import { CheckCircle2, CircleDashed, ExternalLink } from "lucide-react";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), { ssr: false });

interface SiteGraphProps {
  projectId: string;
  data: GraphData;
}

interface GraphIssue {
  id: string;
  ruleId: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  affectedUrl: string;
}

interface GraphPageDetails {
  id: string;
  url: string;
  canonicalUrl: string | null;
  statusCode: number | null;
  responseTime: number | null;
  pageSize: number | null;
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  ogTags: Record<string, string> | null;
  h1: string[];
  h2: string[];
  h3: string[];
  jsonLd: unknown[] | null;
  coreWebVitals: Record<string, unknown> | null;
  internalLinks: Array<{ href: string; text: string }> | null;
  externalLinks: Array<{ href: string; text: string }> | null;
  images: Array<{ src: string; alt: string }> | null;
  wordCount: number | null;
  hreflangTags: Array<{ lang: string; href: string }> | null;
}

interface ChecklistItem {
  id: string;
  label: string;
  status: "ok" | "warn" | "error";
  summary: string;
  details: string[];
}

const SEO_AUDIT_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: "INDEXABILITY", label: "Indexability" },
  { id: "CRAWLABILITY", label: "Crawlability" },
  { id: "ON_PAGE", label: "On-page SEO" },
  { id: "PERFORMANCE", label: "Performance" },
  { id: "STRUCTURED_DATA", label: "Structured data" },
  { id: "IMAGES", label: "Images" },
  { id: "LINKS", label: "Links" },
  { id: "INTERNATIONALIZATION", label: "Internationalization" },
  { id: "CANONICALIZATION", label: "Canonicalization" },
  { id: "SECURITY", label: "Security" },
  { id: "MOBILE", label: "Mobile" },
  { id: "SOCIAL", label: "Social" },
];

function getLinkNodeId(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "object" && node !== null && "id" in node) {
    const id = (node as { id: unknown }).id;
    return typeof id === "string" ? id : String(id);
  }
  return String(node);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function validateJsonLdBlocks(rawBlocks: unknown[] | null): { valid: boolean; details: string[]; types: string[] } {
  if (!rawBlocks || rawBlocks.length === 0) {
    return { valid: false, details: ["No JSON-LD blocks found"], types: [] };
  }

  const details: string[] = [];
  const types: string[] = [];

  rawBlocks.forEach((block, index) => {
    let payload: unknown = block;

    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        details.push(`Block #${index + 1} is not valid JSON`);
        return;
      }
    }

    if (!payload || typeof payload !== "object") {
      details.push(`Block #${index + 1} is not a valid object`);
      return;
    }

    const obj = payload as Record<string, unknown>;
    const context = typeof obj["@context"] === "string" ? obj["@context"] : null;
    const typeValue = obj["@type"];
    const type =
      typeof typeValue === "string"
        ? typeValue
        : Array.isArray(typeValue)
          ? typeValue.filter((entry): entry is string => typeof entry === "string").join(", ")
          : null;

    if (!context || !context.includes("schema.org")) {
      details.push(`Block #${index + 1} has missing or invalid @context`);
    }

    if (!type || type.length === 0) {
      details.push(`Block #${index + 1} is missing @type`);
    } else {
      types.push(type);
    }
  });

  return {
    valid: details.length === 0,
    details: details.length > 0 ? details : [`${rawBlocks.length} valid JSON-LD blocks detected`],
    types,
  };
}

export function SiteGraph({ projectId, data }: SiteGraphProps) {
  const fg2DRef = useRef<ForceGraph2DMethods | undefined>(undefined);
  const fg3DRef = useRef<ForceGraph3DMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [highlightLinks, setHighlightLinks] = useState<Set<string>>(new Set());
  const [showLabels, setShowLabels] = useState(true);
  const [is3D, setIs3D] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>("ALL");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [newOnly, setNewOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const selectedNodeIssuesQuery = useQuery<GraphIssue[]>({
    queryKey: ["graph-node-issues", projectId, selectedNode?.pageId],
    enabled: Boolean(selectedNode?.pageId),
    queryFn: async () => {
      if (!selectedNode?.pageId) return [];

      const qp = new URLSearchParams({
        status: "ACTIVE",
        pageId: selectedNode.pageId,
        all: "true",
        pageSize: "1000",
      });
      const res = await fetch(`/api/projects/${projectId}/issues?${qp.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load page issues");
      }
      return (json.data?.items || []) as GraphIssue[];
    },
  });

  const selectedNodePageQuery = useQuery<GraphPageDetails | null>({
    queryKey: ["graph-node-page", projectId, selectedNode?.pageId],
    enabled: Boolean(selectedNode?.pageId),
    queryFn: async () => {
      if (!selectedNode?.pageId) return null;

      const qp = new URLSearchParams({ pageId: selectedNode.pageId });
      const res = await fetch(`/api/projects/${projectId}/pages?${qp.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load page details");
      }

      return (json.data || null) as GraphPageDetails | null;
    },
  });

  const seoChecklist = useMemo<ChecklistItem[]>(() => {
    const page = selectedNodePageQuery.data;
    const issues = selectedNodeIssuesQuery.data || [];
    if (!page) return [];

    const redirectIssues = issues.filter((issue) => issue.ruleId === "LNK-006").length;
    const brokenLinkIssues = issues.filter((issue) => issue.ruleId === "LNK-007" || issue.ruleId === "CRW-002").length;
    const mixedContentIssues = issues.filter((issue) => issue.ruleId === "CRW-007").length;

    const canonicalNormalized = page.canonicalUrl ? normalizeComparableUrl(page.canonicalUrl, page.url) : null;
    const pageNormalized = normalizeComparableUrl(page.url);
    const canonicalHost = page.canonicalUrl ? hostOf(page.canonicalUrl) : null;
    const pageHost = hostOf(page.url);
    const canonicalStatus: ChecklistItem["status"] =
      !page.canonicalUrl
        ? "error"
        : canonicalNormalized !== pageNormalized
          ? "warn"
          : "ok";
    const canonicalDetails: string[] = [];
    canonicalDetails.push(`Canonical URL: ${page.canonicalUrl || "missing"}`);
    if (page.canonicalUrl && canonicalHost && pageHost && !isSameSiteHostname(canonicalHost, pageHost)) {
      canonicalDetails.push(`Canonical points cross-domain: ${canonicalHost}`);
    }
    if (page.canonicalUrl && canonicalNormalized !== pageNormalized) {
      canonicalDetails.push("Canonical does not self-reference this page");
    }

    const titleLength = page.title?.trim().length ?? 0;
    const descriptionLength = page.metaDescription?.trim().length ?? 0;
    const metaStatus: ChecklistItem["status"] =
      titleLength === 0 || descriptionLength === 0
        ? "error"
        : titleLength < 25 || titleLength > 65 || descriptionLength < 70 || descriptionLength > 170
          ? "warn"
          : "ok";
    const metaDetails = [
      `Title: ${page.title || "(missing)"} (${titleLength} chars)`,
      `Meta description: ${page.metaDescription || "(missing)"} (${descriptionLength} chars)`,
      `H1 count: ${page.h1.length}`,
      `H2 count: ${page.h2.length}`,
      `H3 count: ${page.h3.length}`,
    ];

    const robotsValue = page.metaRobots || "not set";
    const robotsLower = robotsValue.toLowerCase();
    const robotsStatus: ChecklistItem["status"] =
      robotsLower.includes("noindex") ? "warn" : "ok";
    const robotsDetails = [`Meta robots: ${robotsValue}`];

    const jsonLdValidation = validateJsonLdBlocks(page.jsonLd);
    const structuredStatus: ChecklistItem["status"] = jsonLdValidation.valid ? "ok" : "error";
    const structuredDetails = [
      `JSON-LD blocks: ${page.jsonLd?.length || 0}`,
      `Detected types: ${jsonLdValidation.types.length > 0 ? jsonLdValidation.types.join(", ") : "none"}`,
      ...jsonLdValidation.details,
    ];

    const linkStatus: ChecklistItem["status"] =
      brokenLinkIssues > 0
        ? "error"
        : redirectIssues > 0 || (page.internalLinks?.length || 0) === 0
          ? "warn"
          : "ok";
    const linkDetails = [
      `Internal links: ${page.internalLinks?.length || 0}`,
      `External links: ${page.externalLinks?.length || 0}`,
      `Broken link issues: ${brokenLinkIssues}`,
      `Redirect link issues: ${redirectIssues}`,
    ];

    const pageStatus: ChecklistItem["status"] =
      page.statusCode === null
        ? "warn"
        : page.statusCode >= 400
          ? "error"
          : page.statusCode >= 300
            ? "warn"
            : "ok";
    const pageDetails = [
      `HTTP status: ${page.statusCode ?? "unknown"}`,
      `Response time: ${page.responseTime !== null ? `${(page.responseTime / 1000).toFixed(2)}s` : "unknown"}`,
      `Page size: ${page.pageSize !== null ? `${Math.round(page.pageSize / 1024)} KB` : "unknown"}`,
      `Mixed content issues: ${mixedContentIssues}`,
    ];

    const images = page.images || [];
    const missingAlt = images.filter((image) => !image.alt || image.alt.trim().length === 0).length;
    const mediaStatus: ChecklistItem["status"] = missingAlt > 0 ? "warn" : "ok";
    const mediaDetails = [
      `Images: ${images.length}`,
      `Missing alt attributes: ${missingAlt}`,
      `Word count: ${page.wordCount ?? "unknown"}`,
    ];

    const hreflangCount = page.hreflangTags?.length || 0;
    const i18nStatus: ChecklistItem["status"] = hreflangCount > 0 ? "ok" : "warn";
    const i18nDetails = [
      `Hreflang entries: ${hreflangCount}`,
      hreflangCount > 0
        ? `Languages: ${(page.hreflangTags || []).map((tag) => tag.lang).join(", ")}`
        : "No hreflang annotations found",
    ];

    const indexabilityIssueCount = issues.filter((issue) => issue.category === "INDEXABILITY").length;
    const indexabilityStatus: ChecklistItem["status"] =
      page.statusCode === 200 && !robotsLower.includes("noindex") && indexabilityIssueCount === 0
        ? "ok"
        : page.statusCode !== 200 || robotsLower.includes("noindex")
          ? "error"
          : "warn";
    const indexabilityDetails = [
      `Status code: ${page.statusCode ?? "unknown"}`,
      `Meta robots: ${robotsValue}`,
      `Canonical URL: ${page.canonicalUrl || "missing"}`,
      `Indexability issues on page: ${indexabilityIssueCount}`,
    ];

    const performanceIssues = issues.filter((issue) => issue.category === "PERFORMANCE").length;
    const responseSec = page.responseTime !== null ? Number((page.responseTime / 1000).toFixed(2)) : null;
    const performanceStatus: ChecklistItem["status"] =
      (responseSec !== null && responseSec > 3) || performanceIssues > 0
        ? "warn"
        : "ok";
    const performanceDetails = [
      `Response time: ${responseSec !== null ? `${responseSec}s` : "unknown"}`,
      `Page size: ${page.pageSize !== null ? `${Math.round(page.pageSize / 1024)} KB` : "unknown"}`,
      `Core Web Vitals payload: ${page.coreWebVitals ? "present" : "not captured"}`,
      `Performance issues on page: ${performanceIssues}`,
    ];

    const isHttps = page.url.startsWith("https://");
    const securityIssues = issues.filter((issue) => issue.category === "SECURITY").length;
    const securityStatus: ChecklistItem["status"] =
      !isHttps || mixedContentIssues > 0 || securityIssues > 0 ? "warn" : "ok";
    const securityDetails = [
      `Page protocol: ${isHttps ? "HTTPS" : "HTTP"}`,
      `Mixed content issues: ${mixedContentIssues}`,
      `Security issues on page: ${securityIssues}`,
    ];

    const mobileIssues = issues.filter((issue) => issue.category === "MOBILE").length;
    const mobileStatus: ChecklistItem["status"] = mobileIssues > 0 ? "warn" : "ok";
    const mobileDetails = [
      `Mobile issues on page: ${mobileIssues}`,
      mobileIssues > 0
        ? "Review mobile rendering, viewport setup, and tap target spacing."
        : "No active mobile-specific issues detected for this page.",
    ];

    const ogTags = page.ogTags || {};
    const socialIssues = issues.filter((issue) => issue.category === "SOCIAL").length;
    const ogTitle = ogTags["og:title"] || "";
    const ogDescription = ogTags["og:description"] || "";
    const ogUrl = ogTags["og:url"] || "";
    const socialStatus: ChecklistItem["status"] =
      socialIssues > 0 || !ogTitle || !ogDescription || !ogUrl ? "warn" : "ok";
    const socialDetails = [
      `og:title: ${ogTitle || "(missing)"}`,
      `og:description: ${ogDescription || "(missing)"}`,
      `og:url: ${ogUrl || "(missing)"}`,
      `Social issues on page: ${socialIssues}`,
    ];

    return [
      {
        id: "indexability",
        label: "Indexability",
        status: indexabilityStatus,
        summary: indexabilityStatus === "ok" ? "Indexable" : indexabilityStatus === "warn" ? "Review" : "Blocked",
        details: indexabilityDetails,
      },
      {
        id: "page",
        label: "HTTP / Crawl status",
        status: pageStatus,
        summary: pageStatus === "ok" ? "OK" : pageStatus === "warn" ? "Attention" : "Critical",
        details: pageDetails,
      },
      {
        id: "canonical",
        label: "Canonicals",
        status: canonicalStatus,
        summary: canonicalStatus === "ok" ? "OK" : canonicalStatus === "warn" ? "Review" : "Missing",
        details: canonicalDetails,
      },
      {
        id: "meta",
        label: "Meta details",
        status: metaStatus,
        summary: metaStatus === "ok" ? "OK" : metaStatus === "warn" ? "Needs tuning" : "Missing data",
        details: metaDetails,
      },
      {
        id: "robots",
        label: "Robots directives",
        status: robotsStatus,
        summary: robotsStatus === "ok" ? "Indexable" : "Restricted",
        details: robotsDetails,
      },
      {
        id: "jsonld",
        label: "JSON-LD / Structured data",
        status: structuredStatus,
        summary: structuredStatus === "ok" ? "Valid" : "Validation errors",
        details: structuredDetails,
      },
      {
        id: "links",
        label: "Links",
        status: linkStatus,
        summary: linkStatus === "ok" ? "Healthy" : linkStatus === "warn" ? "Review" : "Broken links",
        details: linkDetails,
      },
      {
        id: "media",
        label: "Content & media",
        status: mediaStatus,
        summary: mediaStatus === "ok" ? "OK" : "Alt-text gaps",
        details: mediaDetails,
      },
      {
        id: "i18n",
        label: "Internationalization",
        status: i18nStatus,
        summary: i18nStatus === "ok" ? "Configured" : "Not configured",
        details: i18nDetails,
      },
      {
        id: "performance",
        label: "Performance",
        status: performanceStatus,
        summary: performanceStatus === "ok" ? "Healthy" : "Needs optimization",
        details: performanceDetails,
      },
      {
        id: "security",
        label: "Security",
        status: securityStatus,
        summary: securityStatus === "ok" ? "Secure" : "Review required",
        details: securityDetails,
      },
      {
        id: "mobile",
        label: "Mobile",
        status: mobileStatus,
        summary: mobileStatus === "ok" ? "Healthy" : "Review required",
        details: mobileDetails,
      },
      {
        id: "social",
        label: "Social metadata",
        status: socialStatus,
        summary: socialStatus === "ok" ? "Configured" : "Needs attention",
        details: socialDetails,
      },
    ];
  }, [selectedNodeIssuesQuery.data, selectedNodePageQuery.data]);

  const categoryCoverage = useMemo<ChecklistItem[]>(() => {
    const issues = selectedNodeIssuesQuery.data || [];
    const rank: Record<string, number> = {
      INFO: 0,
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
      CRITICAL: 4,
    };

    return SEO_AUDIT_CATEGORIES.map((category) => {
      const categoryIssues = issues.filter((issue) => issue.category === category.id);
      const highestSeverity = categoryIssues.reduce((max, issue) => {
        const next = rank[issue.severity] ?? 0;
        return next > max ? next : max;
      }, 0);

      const status: ChecklistItem["status"] =
        categoryIssues.length === 0
          ? "ok"
          : highestSeverity >= 3
            ? "error"
            : "warn";

      const details =
        categoryIssues.length === 0
          ? ["No active issues for this category on the selected page."]
          : [
            `Active issues: ${categoryIssues.length}`,
            ...categoryIssues.slice(0, 6).map(
              (issue) => `${issue.severity}: ${issue.title} (${issue.affectedUrl})`
            ),
          ];

      return {
        id: `coverage-${category.id.toLowerCase()}`,
        label: category.label,
        status,
        summary: categoryIssues.length === 0 ? "No issues" : `${categoryIssues.length} issue(s)`,
        details,
      };
    });
  }, [selectedNodeIssuesQuery.data]);

  const groups = useMemo(
    () => [...new Set(data.nodes.map((node) => node.group).filter(Boolean))],
    [data.nodes]
  );

  const adjacency = useMemo(() => {
    const map = new Map<string, { nodes: Set<string>; links: Set<string> }>();

    for (const link of data.links) {
      const sourceId = getLinkNodeId(link.source);
      const targetId = getLinkNodeId(link.target);

      if (!map.has(sourceId)) map.set(sourceId, { nodes: new Set(), links: new Set() });
      if (!map.has(targetId)) map.set(targetId, { nodes: new Set(), links: new Set() });

      map.get(sourceId)?.nodes.add(targetId);
      map.get(sourceId)?.links.add(link.id);
      map.get(targetId)?.nodes.add(sourceId);
      map.get(targetId)?.links.add(link.id);
    }

    return map;
  }, [data.links]);

  const filteredData = useMemo<GraphData>(() => {
    const filteredNodes = data.nodes.filter((node) => {
      if (groupFilter !== "ALL" && node.group !== groupFilter) return false;
      if (severityFilter !== "ALL" && node.status !== severityFilter) return false;
      if (newOnly && !node.isNew) return false;

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const isMatch =
          node.url.toLowerCase().includes(query) ||
          node.label.toLowerCase().includes(query);
        if (!isMatch) return false;
      }

      return true;
    });

    const nodeIds = new Set(filteredNodes.map((node) => node.id));
    const filteredLinks = data.links.filter((link) => {
      const sourceId = getLinkNodeId(link.source);
      const targetId = getLinkNodeId(link.target);
      return nodeIds.has(sourceId) && nodeIds.has(targetId);
    });

    return {
      nodes: filteredNodes,
      links: filteredLinks,
      analytics: data.analytics,
    };
  }, [data, groupFilter, severityFilter, newOnly, searchQuery]);

  const getNodeColor = useCallback((node: Partial<GraphNodeData>) => {
    if (node.isRemoved) return "#334155";
    if (node.semanticClusterColor) return node.semanticClusterColor;
    if (node.status === "unreachable") return "#64748B";
    const status = node.status || "healthy";
    return NODE_HEALTH_COLORS[status] || NODE_HEALTH_COLORS.healthy;
  }, []);

  const handleNodeHover = useCallback(
    (node: GraphNodeData | null) => {
      if (!node) {
        setHighlightNodes(new Set());
        setHighlightLinks(new Set());
        return;
      }

      const related = adjacency.get(node.id);
      const nextHighlightedNodes = new Set<string>([node.id]);
      const nextHighlightedLinks = new Set<string>();

      if (related) {
        for (const neighborId of related.nodes) {
          nextHighlightedNodes.add(neighborId);
        }

        for (const linkId of related.links) {
          nextHighlightedLinks.add(linkId);
        }
      }

      setHighlightNodes(nextHighlightedNodes);
      setHighlightLinks(nextHighlightedLinks);
    },
    [adjacency]
  );

  const handleNodeClick = useCallback((node: GraphNodeData) => {
    setSelectedNode(node);

    if (is3D) {
      fg3DRef.current?.zoomToFit?.(500, 80, (candidate) => candidate.id === node.id);
      return;
    }

    const graph = fg2DRef.current;
    if (!graph) return;
    graph.centerAt(node.x, node.y, 500);
    graph.zoom(2.5, 500);
  }, [is3D]);

  const paintNode = useCallback(
    (
      node: Partial<GraphNodeData> & { id?: string | number; x?: number; y?: number },
      ctx: CanvasRenderingContext2D,
      globalScale: number
    ) => {
      if (typeof node.x !== "number" || typeof node.y !== "number") return;

      const nodeId = typeof node.id === "string" ? node.id : String(node.id ?? "");
      const radius = Math.max(3, Number(node.val) || 4);
      const color = getNodeColor(node);
      const isHighlighted = highlightNodes.has(nodeId);

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = color;
      ctx.globalAlpha = node.isRemoved ? 0.35 : 1;
      ctx.fill();

      if (node.isRemoved || node.status === "unreachable") {
        ctx.strokeStyle = "#64748B";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (isHighlighted) {
        ctx.strokeStyle = "#7DD3FC";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      if (!showLabels || globalScale < 0.35) return;

      const label = node.label || "";
      const fontSize = Math.max(9 / globalScale, 2.8);
      ctx.font = `${fontSize}px \"JetBrains Mono\", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#CBD5E1";
      ctx.fillText(label, node.x, node.y + radius + 2);
    },
    [getNodeColor, highlightNodes, showLabels]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const nextWidth = Math.floor(entry.contentRect.width);
      const nextHeight = Math.floor(entry.contentRect.height);

      if (nextWidth <= 0 || nextHeight <= 0) return;

      setDimensions((current) => {
        if (current.width === nextWidth && current.height === nextHeight) {
          return current;
        }

        return { width: nextWidth, height: nextHeight };
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (filteredData.nodes.length === 0) return;

    const timeout = window.setTimeout(() => {
      if (is3D) {
        fg3DRef.current?.zoomToFit?.(600, 80);
      } else {
        fg2DRef.current?.zoomToFit?.(600, 80);
      }
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [filteredData.nodes.length, filteredData.links.length, dimensions.width, dimensions.height, is3D]);

  const handleZoomIn = useCallback(() => {
    if (is3D) {
      fg3DRef.current?.zoomToFit?.(400, 60);
      return;
    }

    const graph = fg2DRef.current;
    if (!graph) return;
    const currentZoom = graph.zoom();
    graph.zoom(currentZoom * 1.3, 220);
  }, [is3D]);

  const handleZoomOut = useCallback(() => {
    if (is3D) {
      fg3DRef.current?.zoomToFit?.(400, 120);
      return;
    }

    const graph = fg2DRef.current;
    if (!graph) return;
    const currentZoom = graph.zoom();
    graph.zoom(currentZoom / 1.3, 220);
  }, [is3D]);

  const handleFit = useCallback(() => {
    if (is3D) {
      fg3DRef.current?.zoomToFit?.(420, 80);
      return;
    }

    fg2DRef.current?.zoomToFit?.(420, 80);
  }, [is3D]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[calc(100vh-235px)] min-h-[540px] rounded-xl border border-[#1E293B] bg-[radial-gradient(circle_at_20%_0%,#132238,#0A0F1C_45%)] overflow-hidden"
    >
      <GraphControls
        groups={groups}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFit={handleFit}
        onSearch={setSearchQuery}
        onGroupFilter={setGroupFilter}
        onSeverityFilter={setSeverityFilter}
        onToggleLabels={setShowLabels}
        onToggle3D={setIs3D}
        onToggleNewOnly={setNewOnly}
        showLabels={showLabels}
        is3D={is3D}
        newOnly={newOnly}
      />

      {is3D ? (
        <ForceGraph3D
          ref={fg3DRef}
          graphData={filteredData}
          width={dimensions.width || undefined}
          height={dimensions.height || undefined}
          nodeId="id"
          nodeVal="val"
          nodeColor={(node) => getNodeColor(node as Partial<GraphNodeData>)}
          nodeLabel={(node) => {
            const typedNode = node as GraphNodeData;
            return `${typedNode.url}\nIssues: ${typedNode.issueCount}\nInbound: ${typedNode.inboundLinks}`;
          }}
          linkColor={(link) => {
            const edge = link as GraphEdgeData;
            return highlightLinks.has(edge.id) ? "#38BDF8" : "#334155";
          }}
          linkWidth={(link) => {
            const edge = link as GraphEdgeData;
            return highlightLinks.has(edge.id) ? 1.8 : 0.65;
          }}
          linkDirectionalArrowLength={2.5}
          linkDirectionalArrowRelPos={1}
          cooldownTicks={80}
          warmupTicks={40}
          onNodeHover={(node) => handleNodeHover((node as GraphNodeData | null) ?? null)}
          onNodeClick={(node) => handleNodeClick(node as GraphNodeData)}
          backgroundColor="rgba(10,15,28,0)"
        />
      ) : (
        <ForceGraph2D
          ref={fg2DRef}
          graphData={filteredData}
          width={dimensions.width || undefined}
          height={dimensions.height || undefined}
          nodeId="id"
          nodeVal="val"
          nodeColor={(node) => getNodeColor(node as Partial<GraphNodeData>)}
          nodeLabel={(node) => {
            const typedNode = node as GraphNodeData;
            return `${typedNode.url}\nIssues: ${typedNode.issueCount}\nInbound: ${typedNode.inboundLinks}`;
          }}
          linkColor={(link) => {
            const edge = link as GraphEdgeData;
            return highlightLinks.has(edge.id) ? "#38BDF8" : "#334155";
          }}
          linkWidth={(link) => {
            const edge = link as GraphEdgeData;
            return highlightLinks.has(edge.id) ? 1.8 : 0.65;
          }}
          linkDirectionalArrowLength={2.5}
          linkDirectionalArrowRelPos={1}
          d3VelocityDecay={0.35}
          cooldownTicks={80}
          warmupTicks={40}
          onNodeHover={(node) => handleNodeHover((node as GraphNodeData | null) ?? null)}
          onNodeClick={(node) => handleNodeClick(node as GraphNodeData)}
          nodeCanvasObject={
            paintNode as unknown as (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => void
          }
          backgroundColor="rgba(10,15,28,0)"
        />
      )}

      <Sheet open={!!selectedNode} onOpenChange={() => setSelectedNode(null)}>
        <SheetContent
          side="right"
          className="data-[side=right]:!w-[min(96vw,640px)] data-[side=right]:!max-w-[640px] data-[side=right]:!right-2 data-[side=right]:!top-2 data-[side=right]:!bottom-2 data-[side=right]:!h-[calc(100%-1rem)] rounded-xl bg-[#0F172A] border-[#1E293B] overflow-y-auto"
        >
          {selectedNode && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="text-[#F8FAFC]">Page Details</SheetTitle>
              </SheetHeader>

              <div className="space-y-4 px-4 pb-6">
                <div>
                  <p className="text-xs text-[#64748B] mb-1">URL</p>
                  <a
                    href={selectedNode.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-mono text-[#06B6D4] hover:text-cyan-300 break-all inline-flex items-center gap-1"
                  >
                    {selectedNode.url}
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-[#64748B] mb-1">Status</p>
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        selectedNode.status === "healthy"
                          ? "text-green-400 border-green-500/20"
                          : selectedNode.status === "high"
                            ? "text-red-400 border-red-500/20"
                            : selectedNode.status === "unreachable"
                              ? "text-slate-300 border-slate-500/20"
                              : "text-yellow-400 border-yellow-500/20"
                      }`}
                    >
                      {selectedNode.status}
                    </Badge>
                  </div>

                  <div>
                    <p className="text-xs text-[#64748B] mb-1">Group</p>
                    <p className="text-sm text-[#F8FAFC]">/{selectedNode.group}</p>
                  </div>

                  <div>
                    <p className="text-xs text-[#64748B] mb-1">Issues</p>
                    <p className="text-sm font-bold text-[#F8FAFC]">{selectedNode.issueCount}</p>
                  </div>

                  <div>
                    <p className="text-xs text-[#64748B] mb-1">Inbound Links</p>
                    <p className="text-sm font-bold text-[#F8FAFC]">{selectedNode.inboundLinks}</p>
                  </div>

                  <div>
                    <p className="text-xs text-[#64748B] mb-1">Depth</p>
                    <p className="text-sm text-[#F8FAFC]">{selectedNode.depth}</p>
                  </div>
                </div>

                {selectedNode.isNew && (
                  <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20">
                    New page (discovered in latest crawl)
                  </Badge>
                )}

                {selectedNode.isRemoved && (
                  <Badge className="bg-red-500/10 text-red-400 border-red-500/20">
                    Removed (404 or delinked)
                  </Badge>
                )}

                <div className="border-t border-[#1E293B] pt-4">
                  <p className="text-xs text-[#64748B] mb-2 uppercase tracking-wider">SEO Checklist</p>
                  {selectedNodePageQuery.isLoading ? (
                    <p className="text-xs text-[#64748B]">Loading page-level SEO signals...</p>
                  ) : selectedNodePageQuery.isError ? (
                    <p className="text-xs text-red-400">
                      {selectedNodePageQuery.error instanceof Error
                        ? selectedNodePageQuery.error.message
                        : "Failed to load page details"}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {seoChecklist.map((item) => (
                        <div key={item.id} className="rounded-md border border-[#1E293B] bg-[#111827] px-2.5 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-[#94A3B8]">{item.label}</span>
                            {item.status === "ok" ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {item.summary}
                              </span>
                            ) : (
                              <span
                                className={`inline-flex items-center gap-1 text-[11px] ${
                                  item.status === "error" ? "text-red-400" : "text-amber-400"
                                }`}
                              >
                                <CircleDashed className="h-3.5 w-3.5" />
                                {item.summary}
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 space-y-1">
                            {item.details.map((detail) => (
                              <p key={`${item.id}:${detail}`} className="text-[11px] text-[#64748B] break-words">
                                {detail}
                              </p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-[#1E293B] pt-4">
                  <p className="text-xs text-[#64748B] mb-2 uppercase tracking-wider">Audit Category Coverage</p>
                  {selectedNodeIssuesQuery.isLoading ? (
                    <p className="text-xs text-[#64748B]">Loading category checks...</p>
                  ) : (
                    <div className="space-y-2">
                      {categoryCoverage.map((item) => (
                        <div key={item.id} className="rounded-md border border-[#1E293B] bg-[#111827] px-2.5 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-[#94A3B8]">{item.label}</span>
                            {item.status === "ok" ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {item.summary}
                              </span>
                            ) : (
                              <span
                                className={`inline-flex items-center gap-1 text-[11px] ${
                                  item.status === "error" ? "text-red-400" : "text-amber-400"
                                }`}
                              >
                                <CircleDashed className="h-3.5 w-3.5" />
                                {item.summary}
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 space-y-1">
                            {item.details.map((detail) => (
                              <p key={`${item.id}:${detail}`} className="text-[11px] text-[#64748B] break-words">
                                {detail}
                              </p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-[#1E293B] pt-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <p className="text-xs text-[#64748B] uppercase tracking-wider">
                      Issues On This Page ({selectedNodeIssuesQuery.data?.length || 0})
                    </p>
                    <a
                      href={`/projects/${projectId}/issues?pageId=${selectedNode.pageId}`}
                      className="text-[11px] text-cyan-300 hover:text-cyan-200"
                    >
                      Open in Issues view
                    </a>
                  </div>
                  {selectedNodeIssuesQuery.isLoading ? (
                    <p className="text-xs text-[#64748B]">Loading issues...</p>
                  ) : selectedNodeIssuesQuery.isError ? (
                    <p className="text-xs text-red-400">
                      {selectedNodeIssuesQuery.error instanceof Error
                        ? selectedNodeIssuesQuery.error.message
                        : "Failed to load page issues"}
                    </p>
                  ) : (selectedNodeIssuesQuery.data || []).length === 0 ? (
                    <p className="text-xs text-emerald-400">No active SEO issues on this page.</p>
                  ) : (
                    <div className="space-y-2">
                      {(selectedNodeIssuesQuery.data || []).map((issue) => (
                        <div key={issue.id} className="rounded-md border border-[#1E293B] bg-[#111827] p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <SeverityBadge severity={issue.severity} />
                            <Badge variant="outline" className="text-[10px] bg-[#1E293B] text-[#64748B] border-[#334155]">
                              {issue.category}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-[#F8FAFC]">{issue.title}</p>
                          <a
                            href={issue.affectedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 block text-[11px] font-mono text-cyan-300 hover:text-cyan-200 break-all"
                          >
                            {issue.affectedUrl}
                          </a>
                          <p className="mt-1 text-[11px] text-[#94A3B8] line-clamp-3">
                            {issue.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
