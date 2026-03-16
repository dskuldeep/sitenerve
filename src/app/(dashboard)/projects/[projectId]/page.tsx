"use client";

import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { HealthScoreRing } from "@/components/projects/health-score-ring";
import { CardSkeleton } from "@/components/shared/loading-skeleton";
import {
  FileText,
  AlertTriangle,
  Bot,
  Loader2,
  RotateCcw,
  StopCircle,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  Globe,
  Map,
  Link2,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ProjectDetail {
  id: string;
  name: string;
  siteUrl: string;
  status: string;
  crawlSchedule: string;
  schedulerEnabled: boolean;
  nextScheduledAt: string | null;
  healthScore: number;
  totalPages: number;
  totalIssues: number;
  lastCrawlAt: string | null;
  crawls: Array<{
    id: string;
    status: string;
    totalPages: number;
    newPages: number;
    removedPages: number;
    changedPages: number;
    errorCount: number;
    errorMessage: string | null;
    diff: {
      live?: {
        phase?: string;
        visitedUrls?: number;
        extractedPages?: number;
        errorCount?: number;
        updatedAt?: string;
        logs?: string[];
      };
      logs?: string[];
      robots?: {
        url?: string;
        found?: boolean;
        fetchError?: string | null;
      };
      sitemap?: {
        discoveredSitemaps?: string[];
        parsedSitemaps?: string[];
        sitemapErrors?: Array<{ sitemapUrl: string; message: string }>;
        sitemapUrlCount?: number;
      };
      coverage?: {
        crawledPages?: number;
        missingFromSitemapCount?: number;
        missingFromSitemap?: string[];
        sitemapOnlyCount?: number;
        sitemapOnly?: string[];
      };
      discovery?: {
        seedUrlCount?: number;
        sitemapSeedCount?: number;
        discoveredViaLinksCount?: number;
      };
      failureDetails?: Array<{
        url: string;
        stage: string;
        message: string;
      }>;
    } | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
  }>;
  _count: {
    pages: number;
    issues: number;
    agents: number;
  };
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg bg-[#111827] border border-[#334155] px-3 py-2 shadow-xl">
      <p className="text-xs text-[#94A3B8] mb-1.5">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-[#94A3B8] capitalize">{entry.name}:</span>
          <span className="text-[#F8FAFC] font-medium">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function ProjectOverviewPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const queryClient = useQueryClient();

  const { data: project, isLoading } = useQuery<ProjectDetail>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    refetchInterval: (query) => {
      const data = query.state.data as ProjectDetail | undefined;
      const status = data?.status;
      return status === "CRAWLING" || status === "INITIALIZING" ? 2000 : false;
    },
  });

  const restartCrawl = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/crawl`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to restart crawl");
      }
      return json;
    },
    onSuccess: () => {
      toast.success("Crawl restarted");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to restart crawl");
    },
  });

  const stopCrawl = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/crawl`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to stop crawl");
      }
      return json;
    },
    onSuccess: (result) => {
      toast.success(result.message || "Stop requested");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to stop crawl");
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <CardSkeleton />
      </div>
    );
  }

  if (!project) return null;

  const latestCrawl = project.crawls?.[0];
  const isCrawling =
    project.status === "CRAWLING" || project.status === "INITIALIZING";
  const isPostCrawlProcessing =
    isCrawling && latestCrawl?.status === "COMPLETED";

  // Build crawl history data from actual crawls (reverse so oldest first)
  const crawlHistoryData = [...(project.crawls || [])]
    .reverse()
    .filter((c) => c.completedAt)
    .map((crawl, idx) => {
      const date = crawl.completedAt
        ? new Date(crawl.completedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })
        : `Crawl ${idx + 1}`;
      return {
        date,
        pages: crawl.totalPages,
      };
    });

  const latestCoverage = latestCrawl?.diff?.coverage;
  const latestFailureDetails = latestCrawl?.diff?.failureDetails || [];
  const terminalLines =
    latestCrawl?.diff?.live?.logs || latestCrawl?.diff?.logs || [];
  const liveStatus = latestCrawl?.diff?.live;

  return (
    <div className="space-y-6">
      {/* Crawl in progress */}
      {isCrawling && (
        <Card className="bg-blue-500/5 border-blue-500/20">
          <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
            <div className="flex items-center gap-4 flex-1">
              <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-400">
                  {isPostCrawlProcessing ? "Parsing Crawled Data" : "Crawl in Progress"}
                </p>
                <p className="text-xs text-[#94A3B8] mt-0.5">
                  {isPostCrawlProcessing
                    ? "Refreshing audit, issue indexes, graph intelligence, and keyword analysis..."
                    : `Discovering pages on ${project.siteUrl}...`}
                </p>
                <p className="text-xs text-[#64748B] mt-1">
                  {isPostCrawlProcessing
                    ? "Applying the latest crawl snapshot to all dashboards. New data will appear automatically."
                    : `Pages found so far: ${latestCrawl?.totalPages?.toLocaleString() ?? "0"}`}
                </p>
                <Progress value={isPostCrawlProcessing ? 75 : 30} className="mt-2 h-1.5" />
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-blue-400/40 text-blue-300 hover:bg-blue-400/10 hover:text-blue-200"
              onClick={() => stopCrawl.mutate()}
              disabled={stopCrawl.isPending}
            >
              {stopCrawl.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <StopCircle className="h-4 w-4" />
              )}
              Stop Crawl
            </Button>
          </CardContent>
        </Card>
      )}

      {latestCrawl?.status === "FAILED" && (
        <Card className="bg-red-500/5 border-red-500/20">
          <CardContent className="p-4 flex flex-col sm:flex-row gap-4 sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-400">Latest crawl failed</p>
                <p className="text-xs text-[#CBD5E1] mt-1">
                  {latestCrawl.errorMessage || "No failure reason was captured."}
                </p>
                {latestFailureDetails.length > 0 && (
                  <div className="mt-2 text-xs text-[#94A3B8] space-y-1">
                    {latestFailureDetails.slice(0, 3).map((detail, index) => (
                      <p key={`${detail.url}-${index}`}>
                        {detail.stage}: {detail.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => restartCrawl.mutate()}
              disabled={restartCrawl.isPending || isCrawling}
              className="bg-red-500 hover:bg-red-400 text-white"
            >
              {restartCrawl.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Restart Crawl
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="bg-[#111827] border-[#1E293B]">
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-[#64748B] mb-1">Scheduler</p>
            <p className="text-sm font-medium text-[#F8FAFC]">
              {project.schedulerEnabled ? "Enabled" : "Manual only"}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#64748B] mb-1">Next automatic crawl</p>
            <p className="text-sm font-medium text-cyan-400">
              {project.schedulerEnabled && project.nextScheduledAt
                ? formatDistanceToNow(new Date(project.nextScheduledAt), {
                    addSuffix: true,
                  })
                : "Disabled"}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#64748B] mb-1">Saved cron</p>
            <p className="text-sm font-medium text-[#F8FAFC] font-mono">
              {project.crawlSchedule || "manual"}
            </p>
          </div>
        </CardContent>
      </Card>

      {latestCrawl && (
        <Card className="bg-[#050814] border-[#1E293B]">
          <CardHeader className="pb-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <CardTitle className="text-sm font-medium text-[#94A3B8]">
                Crawler Activity
              </CardTitle>
              <div className="text-[11px] text-[#64748B] font-mono">
                phase={liveStatus?.phase || latestCrawl.status.toLowerCase()}{" "}
                visited={liveStatus?.visitedUrls ?? latestCrawl.totalPages} extracted=
                {liveStatus?.extractedPages ?? latestCrawl.totalPages} errors=
                {liveStatus?.errorCount ?? latestCrawl.errorCount}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64 rounded-lg border border-[#1E293B] bg-[#020617] p-3 overflow-auto font-mono text-xs leading-5">
              {terminalLines.length > 0 ? (
                terminalLines.map((line, idx) => (
                  <p key={`${idx}-${line}`} className="text-emerald-300/90 break-all">
                    {line}
                  </p>
                ))
              ) : (
                <p className="text-[#64748B]">
                  Waiting for crawler logs...
                </p>
              )}
            </div>
            {liveStatus?.updatedAt && (
              <p className="mt-2 text-[10px] text-[#64748B]">
                last update:{" "}
                {formatDistanceToNow(new Date(liveStatus.updatedAt), {
                  addSuffix: true,
                })}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Health Score */}
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-[#64748B] mb-1">Health Score</p>
              <div className="flex items-center gap-2">
                <p className="text-3xl font-bold text-[#F8FAFC]">
                  {Math.round(project.healthScore)}
                </p>
                {project.healthScore >= 70 ? (
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-400" />
                )}
              </div>
              <p className="text-[10px] text-[#64748B] mt-1">out of 100</p>
            </div>
            <HealthScoreRing
              score={project.healthScore}
              size={72}
              strokeWidth={5}
            />
          </CardContent>
        </Card>

        {/* Pages */}
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-cyan-400/10 p-2.5">
                <FileText className="h-5 w-5 text-cyan-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#F8FAFC]">
                  {project._count.pages.toLocaleString()}
                </p>
                <p className="text-xs text-[#64748B]">Pages Discovered</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Issues */}
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-orange-400/10 p-2.5">
                <AlertTriangle className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#F8FAFC]">
                  {project._count.issues.toLocaleString()}
                </p>
                <p className="text-xs text-[#64748B]">Active Issues</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Agents */}
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-400/10 p-2.5">
                <Bot className="h-5 w-5 text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#F8FAFC]">
                  {project._count.agents}
                </p>
                <p className="text-xs text-[#64748B]">Active Agents</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Crawl History Chart */}
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[#94A3B8]">
              Crawl History
            </CardTitle>
            <p className="text-xs text-[#64748B]">Pages discovered per crawl</p>
          </CardHeader>
          <CardContent className="pb-4">
            {crawlHistoryData.length === 0 ? (
              <div className="h-[220px] rounded-lg border border-dashed border-[#334155] flex items-center justify-center text-xs text-[#64748B]">
                No completed crawl history yet.
              </div>
            ) : (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={crawlHistoryData}>
                    <defs>
                      <linearGradient
                        id="crawlGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#3B82F6"
                          stopOpacity={0.4}
                        />
                        <stop
                          offset="100%"
                          stopColor="#3B82F6"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#1E293B"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      stroke="#64748B"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="#64748B"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="pages"
                      stroke="#3B82F6"
                      strokeWidth={2}
                      fill="url(#crawlGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Latest Crawl Info */}
        {latestCrawl && (
          <Card className="bg-[#111827] border-[#1E293B]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-[#94A3B8]">
                Latest Crawl
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#0F172A] rounded-lg p-3">
                  <p className="text-xs text-[#64748B] mb-1">Status</p>
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        latestCrawl.status === "COMPLETED"
                          ? "bg-emerald-400"
                          : latestCrawl.status === "FAILED"
                          ? "bg-red-400"
                          : "bg-yellow-400"
                      }`}
                    />
                    <p className="text-sm font-medium text-[#F8FAFC]">
                      {latestCrawl.status}
                    </p>
                  </div>
                </div>
                <div className="bg-[#0F172A] rounded-lg p-3">
                  <p className="text-xs text-[#64748B] mb-1">Pages Found</p>
                  <p className="text-sm font-medium text-[#F8FAFC]">
                    {latestCrawl.totalPages.toLocaleString()}
                  </p>
                </div>
                <div className="bg-[#0F172A] rounded-lg p-3">
                  <p className="text-xs text-[#64748B] mb-1">Content Changed</p>
                  <p className="text-sm font-medium text-[#F8FAFC]">
                    {latestCrawl.changedPages.toLocaleString()}
                  </p>
                </div>
                <div className="bg-[#0F172A] rounded-lg p-3">
                  <p className="text-xs text-[#64748B] mb-1">Errors</p>
                  <p className="text-sm font-medium text-[#F8FAFC]">
                    {latestCrawl.errorCount.toLocaleString()}
                  </p>
                </div>
                <div className="bg-[#0F172A] rounded-lg p-3">
                  <p className="text-xs text-[#64748B] mb-1">Started</p>
                  <p className="text-sm font-medium text-[#F8FAFC]">
                    {latestCrawl.startedAt
                      ? formatDistanceToNow(new Date(latestCrawl.startedAt), {
                          addSuffix: true,
                        })
                      : "Pending"}
                  </p>
                </div>
                <div className="bg-[#0F172A] rounded-lg p-3">
                  <p className="text-xs text-[#64748B] mb-1">Completed</p>
                  <p className="text-sm font-medium text-[#F8FAFC]">
                    {latestCrawl.completedAt
                      ? formatDistanceToNow(
                          new Date(latestCrawl.completedAt),
                          { addSuffix: true }
                        )
                      : "In progress"}
                  </p>
                </div>
              </div>

              {(latestCrawl.status === "COMPLETED" || latestCoverage) && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#0F172A] rounded-lg p-3">
                    <p className="text-xs text-[#64748B] mb-1">New Pages</p>
                    <p className="text-sm font-medium text-emerald-400">
                      {latestCrawl.newPages.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-[#0F172A] rounded-lg p-3">
                    <p className="text-xs text-[#64748B] mb-1">Removed Pages</p>
                    <p className="text-sm font-medium text-orange-400">
                      {latestCrawl.removedPages.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-[#0F172A] rounded-lg p-3">
                    <p className="text-xs text-[#64748B] mb-1">
                      Missing From Sitemap
                    </p>
                    <p className="text-sm font-medium text-[#F8FAFC]">
                      {(latestCoverage?.missingFromSitemapCount || 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-[#0F172A] rounded-lg p-3">
                    <p className="text-xs text-[#64748B] mb-1">
                      Sitemap URLs Not Crawled
                    </p>
                    <p className="text-sm font-medium text-[#F8FAFC]">
                      {(latestCoverage?.sitemapOnlyCount || 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}

              {/* Crawl Timeline */}
              {project.crawls.length > 1 && (
                <div>
                  <p className="text-xs text-[#64748B] mb-2">Recent Crawls</p>
                  <div className="space-y-2">
                    {project.crawls.slice(0, 4).map((crawl) => (
                      <div
                        key={crawl.id}
                        className="flex items-center gap-3 text-xs"
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                            crawl.status === "COMPLETED"
                              ? "bg-emerald-400"
                              : crawl.status === "FAILED"
                              ? "bg-red-400"
                              : "bg-yellow-400"
                          }`}
                        />
                        <span className="text-[#94A3B8] flex-1">
                          {crawl.totalPages} pages
                        </span>
                        <span className="text-[#64748B]">
                          {crawl.completedAt
                            ? formatDistanceToNow(
                                new Date(crawl.completedAt),
                                { addSuffix: true }
                              )
                            : crawl.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Crawl Diagnostics Report */}
      {latestCrawl?.status === "COMPLETED" && latestCrawl.diff && (
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-[#94A3B8] flex items-center gap-2">
              <Search className="h-4 w-4" />
              Crawl Diagnostics Report
            </CardTitle>
            <p className="text-xs text-[#64748B]">
              Setup status and discovery breakdown from the latest crawl
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Setup Status Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* robots.txt status */}
              <div className="bg-[#0F172A] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  {latestCrawl.diff.robots?.found ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-orange-400" />
                  )}
                  <p className="text-xs font-medium text-[#94A3B8]">robots.txt</p>
                </div>
                <p className="text-sm font-medium text-[#F8FAFC]">
                  {latestCrawl.diff.robots?.found ? "Found" : "Not Found"}
                </p>
                {latestCrawl.diff.robots?.fetchError && (
                  <p className="text-[10px] text-orange-400 mt-1 truncate">
                    {latestCrawl.diff.robots.fetchError}
                  </p>
                )}
              </div>

              {/* Sitemaps discovered */}
              <div className="bg-[#0F172A] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Map className="h-3.5 w-3.5 text-cyan-400" />
                  <p className="text-xs font-medium text-[#94A3B8]">Sitemaps</p>
                </div>
                <p className="text-sm font-medium text-[#F8FAFC]">
                  {latestCrawl.diff.sitemap?.parsedSitemaps?.length ?? 0} parsed
                  <span className="text-[#64748B] font-normal">
                    {" "}/ {latestCrawl.diff.sitemap?.discoveredSitemaps?.length ?? 0} discovered
                  </span>
                </p>
                {(latestCrawl.diff.sitemap?.sitemapErrors?.length ?? 0) > 0 && (
                  <p className="text-[10px] text-orange-400 mt-1">
                    {latestCrawl.diff.sitemap!.sitemapErrors!.length} errors
                  </p>
                )}
              </div>

              {/* URLs from sitemaps */}
              <div className="bg-[#0F172A] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Globe className="h-3.5 w-3.5 text-blue-400" />
                  <p className="text-xs font-medium text-[#94A3B8]">Sitemap URLs</p>
                </div>
                <p className="text-sm font-medium text-[#F8FAFC]">
                  {(latestCrawl.diff.sitemap?.sitemapUrlCount ?? 0).toLocaleString()}
                </p>
              </div>
            </div>

            {/* Discovery Breakdown */}
            {latestCrawl.diff.discovery && (
              <div>
                <p className="text-xs text-[#64748B] mb-2">Discovery Breakdown</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="bg-[#0F172A] rounded-lg p-3">
                    <p className="text-xs text-[#64748B] mb-1">Total Seed URLs</p>
                    <p className="text-sm font-medium text-[#F8FAFC]">
                      {latestCrawl.diff.discovery.seedUrlCount?.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-[#0F172A] rounded-lg p-3">
                    <p className="text-xs text-[#64748B] mb-1">From Sitemap</p>
                    <p className="text-sm font-medium text-cyan-400">
                      {latestCrawl.diff.discovery.sitemapSeedCount?.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-[#0F172A] rounded-lg p-3">
                    <p className="text-xs text-[#64748B] mb-1">From Link Discovery</p>
                    <p className="text-sm font-medium text-blue-400">
                      {latestCrawl.diff.discovery.discoveredViaLinksCount?.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-[#0F172A] rounded-lg p-3">
                    <p className="text-xs text-[#64748B] mb-1">Total Crawled</p>
                    <p className="text-sm font-medium text-emerald-400">
                      {latestCrawl.diff.coverage?.crawledPages?.toLocaleString() ?? latestCrawl.totalPages.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Coverage Analysis */}
            {latestCoverage && (
              <div>
                <p className="text-xs text-[#64748B] mb-2">Sitemap vs Crawl Coverage</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className={`rounded-lg p-3 ${(latestCoverage.missingFromSitemapCount ?? 0) > 0 ? "bg-orange-500/5 border border-orange-500/20" : "bg-[#0F172A]"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Link2 className="h-3.5 w-3.5 text-orange-400" />
                      <p className="text-xs font-medium text-[#94A3B8]">Crawled but Missing from Sitemap</p>
                    </div>
                    <p className="text-sm font-medium text-[#F8FAFC]">
                      {(latestCoverage.missingFromSitemapCount ?? 0).toLocaleString()} pages
                    </p>
                    {(latestCoverage.missingFromSitemap?.length ?? 0) > 0 && (
                      <div className="mt-2 max-h-24 overflow-y-auto space-y-0.5">
                        {latestCoverage.missingFromSitemap!.slice(0, 10).map((url) => (
                          <p key={url} className="text-[10px] font-mono text-[#64748B] truncate">{url}</p>
                        ))}
                        {(latestCoverage.missingFromSitemapCount ?? 0) > 10 && (
                          <p className="text-[10px] text-[#475569]">
                            ...and {(latestCoverage.missingFromSitemapCount ?? 0) - 10} more
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className={`rounded-lg p-3 ${(latestCoverage.sitemapOnlyCount ?? 0) > 0 ? "bg-yellow-500/5 border border-yellow-500/20" : "bg-[#0F172A]"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Map className="h-3.5 w-3.5 text-yellow-400" />
                      <p className="text-xs font-medium text-[#94A3B8]">In Sitemap but Not Crawled</p>
                    </div>
                    <p className="text-sm font-medium text-[#F8FAFC]">
                      {(latestCoverage.sitemapOnlyCount ?? 0).toLocaleString()} pages
                    </p>
                    {(latestCoverage.sitemapOnly?.length ?? 0) > 0 && (
                      <div className="mt-2 max-h-24 overflow-y-auto space-y-0.5">
                        {latestCoverage.sitemapOnly!.slice(0, 10).map((url) => (
                          <p key={url} className="text-[10px] font-mono text-[#64748B] truncate">{url}</p>
                        ))}
                        {(latestCoverage.sitemapOnlyCount ?? 0) > 10 && (
                          <p className="text-[10px] text-[#475569]">
                            ...and {(latestCoverage.sitemapOnlyCount ?? 0) - 10} more
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Discovered Sitemaps List */}
            {(latestCrawl.diff.sitemap?.discoveredSitemaps?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs text-[#64748B] mb-2">
                  Discovered Sitemaps ({latestCrawl.diff.sitemap!.discoveredSitemaps!.length})
                </p>
                <div className="bg-[#0F172A] rounded-lg p-3 space-y-1.5 max-h-40 overflow-y-auto">
                  {latestCrawl.diff.sitemap!.discoveredSitemaps!.map((url) => {
                    const wasParsed = latestCrawl.diff?.sitemap?.parsedSitemaps?.includes(url);
                    const error = latestCrawl.diff?.sitemap?.sitemapErrors?.find((e) => e.sitemapUrl === url);
                    return (
                      <div key={url} className="flex items-center gap-2">
                        {wasParsed ? (
                          <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                        ) : error ? (
                          <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                        ) : (
                          <XCircle className="h-3 w-3 text-[#475569] shrink-0" />
                        )}
                        <p className="text-[10px] font-mono text-[#94A3B8] truncate flex-1">{url}</p>
                        {error && (
                          <span className="text-[9px] text-red-400 shrink-0">{error.message}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
