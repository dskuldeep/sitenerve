"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Search, Download, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/shared/empty-state";
import { SeverityBadge } from "@/components/issues/severity-badge";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { formatDistanceToNow } from "date-fns";

interface Issue {
  id: string;
  ruleId: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  affectedUrl: string;
  evidence: Record<string, unknown>;
  status: string;
  isWhitelisted: boolean;
  firstDetectedAt: string;
  lastDetectedAt: string;
}

interface ProjectProcessingState {
  status: string;
  crawls: Array<{ status: string }>;
}

const SEVERITY_OPTIONS = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};
const CATEGORY_OPTIONS = [
  "INDEXABILITY", "CRAWLABILITY", "ON_PAGE", "PERFORMANCE",
  "STRUCTURED_DATA", "IMAGES", "LINKS", "INTERNATIONALIZATION",
  "CANONICALIZATION", "SECURITY", "MOBILE", "SOCIAL",
];

const CATEGORY_GUIDANCE: Record<
  string,
  { why: string; actions: string[]; references: Array<{ label: string; href: string }> }
> = {
  INDEXABILITY: {
    why: "Indexability issues can prevent Google from indexing content that should rank.",
    actions: [
      "Confirm robots/meta robots directives allow indexing for target pages.",
      "Ensure important pages return 200 and are internally linked.",
      "Consolidate duplicates via canonical or redirects.",
    ],
    references: [
      { label: "Google Search Essentials", href: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide" },
      { label: "Google Crawling & Indexing Overview", href: "https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers" },
    ],
  },
  CRAWLABILITY: {
    why: "Crawl issues reduce discovery efficiency and waste crawl budget.",
    actions: [
      "Fix 4xx/5xx responses for linked pages and remove broken destinations.",
      "Replace redirected internal URLs with final 200 destinations.",
      "Reduce long redirect chains and mixed-content references.",
    ],
    references: [
      { label: "Google HTTP Status Codes", href: "https://developers.google.com/search/docs/crawling-indexing/http-network-errors" },
      { label: "Google Crawl Budget", href: "https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget" },
    ],
  },
  CANONICALIZATION: {
    why: "Canonical conflicts can split ranking signals and cause wrong URL selection.",
    actions: [
      "Use a single preferred canonical URL for each page cluster.",
      "Avoid cross-domain or parameterized canonicals unless intentional.",
      "Align canonical signals with redirects and internal linking.",
    ],
    references: [
      { label: "Google Canonicalization", href: "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls" },
    ],
  },
  STRUCTURED_DATA: {
    why: "Invalid or incomplete structured data reduces rich-result eligibility.",
    actions: [
      "Validate each JSON-LD block for @context and @type correctness.",
      "Populate required properties for each schema type.",
      "Retest in Rich Results Test before deployment.",
    ],
    references: [
      { label: "Google Structured Data Intro", href: "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data" },
      { label: "Google Structured Data Guidelines", href: "https://developers.google.com/search/docs/appearance/structured-data/sd-policies" },
    ],
  },
  ON_PAGE: {
    why: "Metadata and content structure directly affect relevance and CTR.",
    actions: [
      "Keep titles specific and non-duplicative; optimize length for SERPs.",
      "Write unique meta descriptions that match page intent.",
      "Use clear heading hierarchy and content targeting.",
    ],
    references: [
      { label: "Google Title Link Best Practices", href: "https://developers.google.com/search/docs/appearance/title-link" },
      { label: "Google Snippet Guidelines", href: "https://developers.google.com/search/docs/appearance/snippet" },
    ],
  },
  LINKS: {
    why: "Internal link quality affects crawl paths, context, and authority distribution.",
    actions: [
      "Replace broken and redirected internal targets with final URLs.",
      "Improve anchor clarity and reduce generic/non-descriptive links.",
      "Increase contextual internal links on key conversion/content pages.",
    ],
    references: [
      { label: "Google Link Best Practices", href: "https://developers.google.com/search/docs/crawling-indexing/links-crawlable" },
    ],
  },
};

function flattenEvidence(value: unknown, path: string = "", depth = 0): string[] {
  if (depth > 4) {
    return [`${path}: (max depth reached)`];
  }

  if (value === null || value === undefined) {
    return [`${path}: null`];
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [`${path}: ${String(value)}`];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${path}: []`];
    }
    const lines: string[] = [];
    value.forEach((entry, index) => {
      lines.push(...flattenEvidence(entry, `${path}[${index}]`, depth + 1));
    });
    return lines;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return [`${path}: {}`];
    }
    const lines: string[] = [];
    for (const [key, entryValue] of entries) {
      const nextPath = path ? `${path}.${key}` : key;
      lines.push(...flattenEvidence(entryValue, nextPath, depth + 1));
    }
    return lines;
  }

  return [`${path}: ${String(value)}`];
}

function formatEvidence(evidence: Record<string, unknown>): string[] {
  return flattenEvidence(evidence).slice(0, 250);
}

function collectUrls(value: unknown): string[] {
  const found = new Set<string>();
  const stack: unknown[] = [value];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    if (typeof current === "string") {
      if (/^https?:\/\//i.test(current)) {
        found.add(current);
      }
      continue;
    }

    if (Array.isArray(current)) {
      for (const entry of current) stack.push(entry);
      continue;
    }

    if (typeof current === "object") {
      for (const entry of Object.values(current as Record<string, unknown>)) {
        stack.push(entry);
      }
    }
  }

  return Array.from(found);
}

interface IssueGroup {
  key: string;
  ruleId: string;
  title: string;
  category: string;
  severity: string;
  items: Issue[];
}

function csvValue(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

export default function IssuesPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const queryClient = useQueryClient();
  const pageIdFilter = searchParams.get("pageId") || "";
  const initialSearch = searchParams.get("search") || "";

  const [search, setSearch] = useState(initialSearch);
  const [severityFilter, setSeverityFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [whitelistReason, setWhitelistReason] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const projectStateQuery = useQuery<ProjectProcessingState>({
    queryKey: ["project-processing-state", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load project state");
      }
      return json.data as ProjectProcessingState;
    },
    refetchInterval: (query) => {
      const state = query.state.data as ProjectProcessingState | undefined;
      return state?.status === "CRAWLING" || state?.status === "INITIALIZING" ? 2000 : false;
    },
  });

  const isProjectProcessing =
    projectStateQuery.data?.status === "CRAWLING" || projectStateQuery.data?.status === "INITIALIZING";
  const isPostCrawlProcessing =
    isProjectProcessing && projectStateQuery.data?.crawls?.[0]?.status === "COMPLETED";

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["issues", projectId, search, severityFilter, categoryFilter, statusFilter, pageIdFilter],
    queryFn: async () => {
      const qp = new URLSearchParams();
      if (search) qp.set("search", search);
      if (severityFilter.length) qp.set("severity", severityFilter.join(","));
      if (categoryFilter && categoryFilter !== "ALL") qp.set("category", categoryFilter);
      if (statusFilter && statusFilter !== "ALL") qp.set("status", statusFilter);
      if (pageIdFilter) qp.set("pageId", pageIdFilter);
      qp.set("all", "true");
      qp.set("pageSize", "50000");

      const res = await fetch(`/api/projects/${projectId}/issues?${qp}`, { cache: "no-store" });
      const json = await res.json();
      return json.success ? json.data : { items: [], total: 0 };
    },
    refetchInterval: () => (isProjectProcessing ? 3000 : false),
  });

  const wasProcessingRef = useRef(false);
  useEffect(() => {
    if (isProjectProcessing) {
      wasProcessingRef.current = true;
      return;
    }
    if (wasProcessingRef.current) {
      wasProcessingRef.current = false;
      refetch();
    }
  }, [isProjectProcessing, refetch]);

  const whitelistMutation = useMutation({
    mutationFn: async ({ issueId, whitelist }: { issueId: string; whitelist: boolean }) => {
      const res = await fetch(`/api/projects/${projectId}/issues`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueId,
          isWhitelisted: whitelist,
          whitelistReason: whitelist ? whitelistReason : null,
        }),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["issues", projectId] });
      toast.success("Issue updated");
      setSelectedIssue(null);
      setWhitelistReason("");
    },
  });

  const exportComprehensive = async (format: "csv" | "json") => {
    setIsExporting(true);
    try {
      const qp = new URLSearchParams();
      if (search) qp.set("search", search);
      if (severityFilter.length) qp.set("severity", severityFilter.join(","));
      if (categoryFilter && categoryFilter !== "ALL") qp.set("category", categoryFilter);
      if (statusFilter && statusFilter !== "ALL") qp.set("status", statusFilter);
      if (pageIdFilter) qp.set("pageId", pageIdFilter);
      qp.set("format", format);

      const res = await fetch(`/api/projects/${projectId}/issues/export?${qp.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("Failed to export issue report");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.download = format === "csv" ? `issues-comprehensive-${ts}.csv` : `issues-comprehensive-${ts}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export report");
    } finally {
      setIsExporting(false);
    }
  };

  const toggleSeverity = (s: string) => {
    setSeverityFilter((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const selectedGuidance = selectedIssue
    ? CATEGORY_GUIDANCE[selectedIssue.category] || {
      why: "This issue can impact crawlability, indexation, or ranking signals and should be validated against page intent.",
      actions: [
        "Confirm the issue with a live page inspection and source HTML review.",
        "Apply a fix on template-level where possible to avoid regressions.",
        "Re-crawl and verify issue resolution.",
      ],
      references: [{ label: "Google Search Documentation", href: "https://developers.google.com/search/docs" }],
    }
    : null;

  const relatedIssueInstances = useMemo(() => {
    if (!selectedIssue || !data?.items) return [];
    return (data.items as Issue[]).filter(
      (issue) => issue.ruleId === selectedIssue.ruleId && issue.title === selectedIssue.title
    );
  }, [data?.items, selectedIssue]);

  const relatedAffectedUrls = useMemo(() => {
    const urls = new Set<string>();

    for (const issue of relatedIssueInstances) {
      if (issue.affectedUrl) {
        urls.add(issue.affectedUrl);
      }
      for (const extracted of collectUrls(issue.evidence || {})) {
        urls.add(extracted);
      }
    }

    return Array.from(urls);
  }, [relatedIssueInstances]);

  const groupedIssues = useMemo<IssueGroup[]>(() => {
    const items = ((data?.items || []) as Issue[]);
    const groups = new Map<string, IssueGroup>();

    for (const issue of items) {
      const key = `${issue.ruleId}::${issue.title}`;
      const current = groups.get(key);
      if (!current) {
        groups.set(key, {
          key,
          ruleId: issue.ruleId,
          title: issue.title,
          category: issue.category,
          severity: issue.severity,
          items: [issue],
        });
        continue;
      }

      current.items.push(issue);
      if ((SEVERITY_RANK[issue.severity] || 0) > (SEVERITY_RANK[current.severity] || 0)) {
        current.severity = issue.severity;
      }
    }

    return Array.from(groups.values()).sort((a, b) => {
      const sevDiff = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
      if (sevDiff !== 0) return sevDiff;
      return b.items.length - a.items.length;
    });
  }, [data?.items]);

  const exportGroupCsv = (group: IssueGroup) => {
    const headers = [
      "Issue ID",
      "Rule ID",
      "Severity",
      "Category",
      "Title",
      "Status",
      "Affected URL",
      "First Detected",
      "Last Detected",
      "Description",
      "Evidence",
    ];
    const rows = group.items.map((issue) => [
      issue.id,
      issue.ruleId,
      issue.severity,
      issue.category,
      issue.title,
      issue.status,
      issue.affectedUrl,
      issue.firstDetectedAt,
      issue.lastDetectedAt,
      issue.description,
      JSON.stringify(issue.evidence || {}),
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => csvValue(String(cell ?? ""))).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.download = `issue-group-${group.ruleId}-${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {isProjectProcessing && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 flex items-start gap-3">
          <Loader2 className="h-4 w-4 text-blue-400 animate-spin mt-0.5" />
          <div>
            <p className="text-sm text-blue-300 font-medium">
              {isPostCrawlProcessing ? "Parsing crawled data for issues" : "Crawl in progress"}
            </p>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              {isPostCrawlProcessing
                ? "The latest crawl is being processed. Issue lists will auto-refresh with the new snapshot."
                : "Issue data will refresh automatically while crawling continues."}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
          <Input
            placeholder="Search issues..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-[#1E293B] border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B]"
          />
        </div>
        <div className="flex gap-1">
          {SEVERITY_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => toggleSeverity(s)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                severityFilter.includes(s)
                  ? "bg-blue-500/20 text-blue-400"
                  : "bg-[#1E293B] text-[#64748B] hover:text-[#94A3B8]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <Select value={categoryFilter} onValueChange={(v) => v && setCategoryFilter(v)}>
          <SelectTrigger className="w-40 bg-[#1E293B] border-[#334155] text-[#94A3B8]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent className="bg-[#1E293B] border-[#334155]">
            <SelectItem value="ALL" className="text-[#94A3B8]">All Categories</SelectItem>
            {CATEGORY_OPTIONS.map((c) => (
              <SelectItem key={c} value={c} className="text-[#94A3B8]">{c.replace("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
          <SelectTrigger className="w-32 bg-[#1E293B] border-[#334155] text-[#94A3B8]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="bg-[#1E293B] border-[#334155]">
            <SelectItem value="ALL" className="text-[#94A3B8]">All</SelectItem>
            <SelectItem value="ACTIVE" className="text-[#94A3B8]">Active</SelectItem>
            <SelectItem value="RESOLVED" className="text-[#94A3B8]">Resolved</SelectItem>
            <SelectItem value="WHITELISTED" className="text-[#94A3B8]">Whitelisted</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void exportComprehensive("csv")}
          disabled={isExporting}
          className="ml-auto bg-transparent border-[#334155] text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B]">
          {isExporting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
          CSV
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[#64748B]">{data?.total || 0} issues found</p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void exportComprehensive("json")}
            disabled={isExporting}
            className="bg-transparent border-[#334155] text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B]">
            {isExporting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
            Detailed JSON
          </Button>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={8} />
      ) : !data?.items?.length ? (
        <EmptyState icon={AlertTriangle} title="No issues found"
          description="No issues match your current filters, or the audit hasn't run yet." />
      ) : (
        <div className="rounded-lg border border-[#1E293B] bg-[#0A0F1C] p-2">
          <Accordion
            multiple
            className="gap-2"
            defaultValue={groupedIssues.slice(0, Math.min(4, groupedIssues.length)).map((group) => group.key)}
          >
            {groupedIssues.map((group) => (
              <AccordionItem
                key={group.key}
                value={group.key}
                className="rounded-lg border border-[#1E293B] bg-[#0B1220] px-3"
              >
                <AccordionTrigger className="py-3 hover:no-underline">
                  <div className="flex w-full items-center justify-between gap-3 pr-6">
                    <div className="flex items-center gap-2 min-w-0">
                      <SeverityBadge severity={group.severity} />
                      <Badge variant="outline" className="text-[10px] bg-[#1E293B] text-[#94A3B8] border-[#334155]">
                        {group.ruleId}
                      </Badge>
                      <p className="text-sm text-[#F8FAFC] font-medium truncate">{group.title}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-[10px] bg-[#1E293B] text-[#94A3B8] border-[#334155]">
                        {group.category.replace("_", " ")}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] bg-[#1E293B] text-cyan-300 border-cyan-500/30">
                        {group.items.length} URL{group.items.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-3">
                  <div className="flex items-center justify-end mb-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => exportGroupCsv(group)}
                      className="bg-transparent border-[#334155] text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B]"
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Download Group CSV
                    </Button>
                  </div>
                  <div className="rounded-md border border-[#1E293B] overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-[#111827] hover:bg-[#111827] border-[#1E293B]">
                          <TableHead className="text-[#64748B] w-24">Severity</TableHead>
                          <TableHead className="text-[#64748B]">URL</TableHead>
                          <TableHead className="text-[#64748B] w-28">Detected</TableHead>
                          <TableHead className="text-[#64748B] w-24">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.items.map((issue) => (
                          <TableRow
                            key={issue.id}
                            onClick={() => setSelectedIssue(issue)}
                            className="cursor-pointer bg-[#0A0F1C] hover:bg-[#263348] border-[#1E293B] transition-colors"
                          >
                            <TableCell><SeverityBadge severity={issue.severity} /></TableCell>
                            <TableCell>
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <a
                                      href={issue.affectedUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(event) => event.stopPropagation()}
                                      className="text-xs font-mono text-[#06B6D4] hover:text-cyan-300 truncate max-w-[480px] block"
                                    />
                                  }
                                >
                                  {issue.affectedUrl}
                                </TooltipTrigger>
                                <TooltipContent className="bg-[#1E293B] text-[#F8FAFC] border-[#334155] max-w-md">
                                  <p className="font-mono text-xs break-all">{issue.affectedUrl}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>
                            <TableCell className="text-xs text-[#64748B]">
                              {formatDistanceToNow(new Date(issue.firstDetectedAt), { addSuffix: true })}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-[10px] ${
                                issue.status === "ACTIVE" ? "bg-red-500/10 text-red-400 border-red-500/20"
                                  : issue.status === "RESOLVED" ? "bg-green-500/10 text-green-400 border-green-500/20"
                                  : "bg-gray-500/10 text-gray-400 border-gray-500/20"
                              }`}>{issue.status}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      )}

      {/* Issue Detail Sheet */}
      <Sheet open={!!selectedIssue} onOpenChange={() => setSelectedIssue(null)}>
        <SheetContent
          side="right"
          className="data-[side=right]:!w-[min(96vw,620px)] data-[side=right]:!max-w-[620px] data-[side=right]:!right-2 data-[side=right]:!top-2 data-[side=right]:!bottom-2 data-[side=right]:!h-[calc(100%-1rem)] rounded-xl bg-[#111827] border-[#1E293B] overflow-y-auto"
        >
          {selectedIssue && (
            <>
              <SheetHeader className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <SeverityBadge severity={selectedIssue.severity} />
                  <Badge variant="outline" className="text-[10px] bg-[#1E293B] text-[#64748B] border-[#334155]">
                    {selectedIssue.ruleId}
                  </Badge>
                </div>
                <SheetTitle className="text-[#F8FAFC] text-lg">{selectedIssue.title}</SheetTitle>
              </SheetHeader>
              <div className="space-y-6 px-4 pb-6">
                <div>
                  <p className="text-xs text-[#64748B] mb-1">Affected URL</p>
                  <a
                    href={selectedIssue.affectedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-mono text-[#06B6D4] hover:text-cyan-300 break-all"
                  >
                    {selectedIssue.affectedUrl}
                  </a>
                </div>
                <div>
                  <p className="text-xs text-[#64748B] mb-1">
                    All Affected URLs For This Issue Pattern ({relatedAffectedUrls.length})
                  </p>
                  {relatedAffectedUrls.length === 0 ? (
                    <p className="text-xs text-[#94A3B8]">No related URLs were found.</p>
                  ) : (
                    <div className="max-h-44 overflow-y-auto rounded bg-[#0A0F1C] p-3 space-y-1.5">
                      {relatedAffectedUrls.slice(0, 500).map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-xs font-mono text-cyan-300 hover:text-cyan-200 break-all"
                        >
                          {url}
                        </a>
                      ))}
                      {relatedAffectedUrls.length > 500 && (
                        <p className="text-[11px] text-[#64748B]">
                          Showing first 500 URLs. Export detailed JSON for full list.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-[#64748B] mb-1">First detected</p>
                    <p className="text-xs text-[#94A3B8]">
                      {new Date(selectedIssue.firstDetectedAt).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#64748B] mb-1">Last detected</p>
                    <p className="text-xs text-[#94A3B8]">
                      {new Date(selectedIssue.lastDetectedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-[#64748B] mb-1">Description & Remediation</p>
                  <p className="text-sm text-[#94A3B8] whitespace-pre-wrap">{selectedIssue.description}</p>
                </div>
                {selectedGuidance && (
                  <div className="space-y-3 rounded-md border border-[#1E293B] bg-[#0A0F1C] p-3">
                    <div>
                      <p className="text-xs text-[#64748B] mb-1">Why This Matters</p>
                      <p className="text-sm text-[#94A3B8]">{selectedGuidance.why}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[#64748B] mb-1">Recommended Actions</p>
                      <ul className="space-y-1">
                        {selectedGuidance.actions.map((action) => (
                          <li key={action} className="text-sm text-[#94A3B8]">- {action}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs text-[#64748B] mb-1">References</p>
                      <div className="space-y-1">
                        {selectedGuidance.references.map((reference) => (
                          <a
                            key={reference.href}
                            href={reference.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs text-cyan-300 hover:text-cyan-200"
                          >
                            {reference.label}
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {selectedIssue.evidence && Object.keys(selectedIssue.evidence).length > 0 && (
                  <div>
                    <p className="text-xs text-[#64748B] mb-1">Evidence</p>
                    <div className="space-y-1.5 rounded bg-[#0A0F1C] p-3">
                      {formatEvidence(selectedIssue.evidence).map((line) => (
                        <p key={line} className="text-xs font-mono text-[#94A3B8] break-words">
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                <div className="border-t border-[#1E293B] pt-4">
                  {selectedIssue.isWhitelisted ? (
                    <Button variant="outline" size="sm"
                      onClick={() => whitelistMutation.mutate({ issueId: selectedIssue.id, whitelist: false })}
                      className="w-full bg-transparent border-[#334155] text-[#94A3B8] hover:text-[#F8FAFC]">
                      Remove from Whitelist
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <Label className="text-[#94A3B8]">Whitelist this issue</Label>
                      <Textarea placeholder="Reason for whitelisting..." value={whitelistReason}
                        onChange={(e) => setWhitelistReason(e.target.value)}
                        className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B] resize-none" rows={2} />
                      <Button size="sm" disabled={!whitelistReason.trim()}
                        onClick={() => whitelistMutation.mutate({ issueId: selectedIssue.id, whitelist: true })}
                        className="w-full bg-[#1E293B] text-[#94A3B8] hover:bg-[#263348] hover:text-[#F8FAFC]">
                        Whitelist Issue
                      </Button>
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
