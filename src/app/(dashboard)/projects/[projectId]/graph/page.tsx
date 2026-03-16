"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Eye,
  EyeOff,
  Layers,
  Link2,
  Loader2,
  Network,
  Sparkles,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SiteGraph } from "@/components/graph/site-graph";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GraphData, GraphAnalytics } from "@/types/graph";

interface ProjectProcessingState {
  status: string;
  crawls: Array<{ status: string }>;
}

function AnalyticsPanel({ analytics }: { analytics: GraphAnalytics }) {
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);

  const maxDepthCount = useMemo(() => {
    const depthCounts = Object.values(analytics.depthDistribution);
    return depthCounts.length > 0 ? Math.max(...depthCounts) : 1;
  }, [analytics.depthDistribution]);

  const segments = analytics.semanticSegments.length > 0
    ? analytics.semanticSegments
    : analytics.clusters.map((cluster) => ({
      id: cluster.id,
      label: cluster.label,
      urls: cluster.urls,
      size: cluster.urls.length,
      avgDepth: cluster.avgDepth,
      totalIssues: cluster.totalIssues,
      keywords: cluster.keywords,
      cohesion: 0,
    }));

  const renderUrlLink = (url: string, className: string) => (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(className, "hover:text-cyan-300")}
      onClick={(event) => event.stopPropagation()}
    >
      {url}
    </a>
  );

  return (
    <div className="space-y-4 max-h-[calc(100vh-240px)] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#0F172A] rounded-lg p-3">
          <p className="text-[10px] text-[#64748B] mb-0.5">Pages</p>
          <p className="text-lg font-bold text-[#F8FAFC]">{analytics.totalNodes}</p>
        </div>

        <div className="bg-[#0F172A] rounded-lg p-3">
          <p className="text-[10px] text-[#64748B] mb-0.5">Internal Links</p>
          <p className="text-lg font-bold text-[#F8FAFC]">{analytics.totalEdges}</p>
        </div>

        <div className="bg-[#0F172A] rounded-lg p-3 border border-cyan-500/20">
          <p className="text-[10px] text-[#64748B] mb-0.5">Semantic Segments</p>
          <p className="text-lg font-bold text-cyan-400">{segments.length}</p>
        </div>

        <div className="bg-[#0F172A] rounded-lg p-3 border border-blue-500/20">
          <p className="text-[10px] text-[#64748B] mb-0.5">Link Opportunities</p>
          <p className="text-lg font-bold text-blue-400">{analytics.linkOpportunities.length}</p>
        </div>
      </div>

      <Tabs defaultValue="semantic" className="w-full">
        <TabsList className="w-full bg-[#0F172A] border border-[#1E293B]">
          <TabsTrigger value="semantic" className="flex-1 text-xs data-[state=active]:bg-[#1E293B]">Semantic</TabsTrigger>
          <TabsTrigger value="structure" className="flex-1 text-xs data-[state=active]:bg-[#1E293B]">Structure</TabsTrigger>
          <TabsTrigger value="keywords" className="flex-1 text-xs data-[state=active]:bg-[#1E293B]">Keywords</TabsTrigger>
          <TabsTrigger value="actions" className="flex-1 text-xs data-[state=active]:bg-[#1E293B]">Actions</TabsTrigger>
        </TabsList>

        <TabsContent value="semantic" className="space-y-3 mt-3">
          <div>
            <p className="text-[10px] text-[#64748B] mb-2 uppercase tracking-wider">
              Semantic Clusters ({segments.length})
            </p>

            <div className="space-y-2">
              {segments.slice(0, 20).map((segment) => (
                <div
                  key={segment.id}
                  className="bg-[#0F172A] rounded-lg p-2.5 cursor-pointer hover:bg-[#1E293B] transition-colors"
                  onClick={() => setExpandedCluster(expandedCluster === segment.id ? null : segment.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-[#94A3B8] truncate">{segment.label}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-[9px] bg-[#1E293B] text-[#64748B] border-[#334155]">
                        {segment.size} pages
                      </Badge>
                      {segment.cohesion > 0 && (
                        <Badge variant="outline" className="text-[9px] bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                          coh {segment.cohesion}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {segment.keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {segment.keywords.slice(0, 5).map((keyword) => (
                        <span key={keyword} className="text-[9px] bg-cyan-500/10 text-cyan-300 rounded px-1.5 py-0.5">
                          {keyword}
                        </span>
                      ))}
                    </div>
                  )}

                  {expandedCluster === segment.id && (
                    <div className="mt-2 space-y-1 border-t border-[#1E293B] pt-2">
                      <p className="text-[9px] text-[#64748B]">Avg depth: {segment.avgDepth}</p>
                      <p className="text-[9px] text-[#64748B]">Total issues: {segment.totalIssues}</p>
                      {segment.urls.slice(0, 6).map((url) => (
                        <div key={url} className="text-[9px] font-mono text-[#64748B] truncate">
                          {renderUrlLink(url, "text-[#64748B]")}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {analytics.bridgePages.length > 0 && (
            <div>
              <p className="text-[10px] text-[#64748B] mb-2 uppercase tracking-wider flex items-center gap-1">
                <Layers className="h-3 w-3" />
                Bridge Pages
              </p>
              <div className="space-y-1">
                {analytics.bridgePages.slice(0, 8).map((page) => (
                  <div key={page.url} className="bg-[#0F172A] rounded px-2.5 py-1.5 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono text-[#94A3B8] truncate flex-1">
                      {renderUrlLink(page.url, "text-[#94A3B8]")}
                    </span>
                    <span className="text-[10px] text-cyan-400 shrink-0">{page.segmentCount} segments</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="structure" className="space-y-3 mt-3">
          <div>
            <p className="text-[10px] text-[#64748B] mb-2 uppercase tracking-wider">Crawl Depth</p>
            <div className="space-y-1">
              {Object.entries(analytics.depthDistribution)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([depth, count]) => (
                  <div key={depth} className="flex items-center gap-2">
                    <span className="text-[10px] text-[#64748B] w-14 shrink-0">Depth {depth}</span>
                    <div className="flex-1 h-4 bg-[#0F172A] rounded overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded",
                          Number(depth) > 3 ? "bg-orange-500/40" : "bg-blue-500/40"
                        )}
                        style={{ width: `${(count / maxDepthCount) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-[#94A3B8] w-8 text-right">{count}</span>
                  </div>
                ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] text-[#64748B] mb-2 uppercase tracking-wider">Site Sections</p>
            <div className="space-y-1.5">
              {Object.entries(analytics.groupDistribution)
                .sort(([, a], [, b]) => b.count - a.count)
                .slice(0, 10)
                .map(([group, data]) => (
                  <div key={group} className="flex items-center justify-between bg-[#0F172A] rounded px-2.5 py-1.5">
                    <span className="text-xs text-[#94A3B8] font-mono">/{group}</span>
                    <div className="flex items-center gap-2 text-[10px] text-[#64748B]">
                      <span>{data.count} pages</span>
                      <span>{data.avgIssues} issues</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {analytics.orphanPages.length > 0 && (
            <div>
              <p className="text-[10px] text-red-400 mb-2 uppercase tracking-wider flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Orphan Pages
              </p>
              <div className="space-y-1">
                {analytics.orphanPages.slice(0, 8).map((page) => (
                  <div key={page.url} className="bg-red-500/5 border border-red-500/10 rounded px-2.5 py-1.5">
                    <div className="text-[10px] font-mono text-red-300 truncate">{renderUrlLink(page.url, "text-red-300")}</div>
                    {page.title && (
                      <p className="text-[9px] text-[#64748B] truncate mt-0.5">{page.title}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="keywords" className="space-y-3 mt-3">
          <p className="text-[10px] text-[#64748B] uppercase tracking-wider">Top Site Keywords</p>
          <div className="space-y-1">
            {Object.entries(analytics.keywordDistribution)
              .sort(([, a], [, b]) => b.pageCount - a.pageCount)
              .slice(0, 20)
              .map(([keyword, data]) => (
                <div key={keyword} className="flex items-center justify-between bg-[#0F172A] rounded px-2.5 py-1.5 gap-2">
                  <span className="text-xs text-[#94A3B8] truncate flex-1">{keyword}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-[#64748B]">{data.pageCount} pages</span>
                    <span className="text-[10px] text-[#475569]">{data.avgScore.toFixed(2)}</span>
                  </div>
                </div>
              ))}
          </div>

          {analytics.cannibalizationRisks.length > 0 && (
            <div>
              <p className="text-[10px] text-orange-400 mb-2 uppercase tracking-wider flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                Potential Cannibalization
              </p>
              <div className="space-y-1">
                {analytics.cannibalizationRisks.slice(0, 8).map((risk) => (
                  <div key={risk.keyword} className="bg-orange-500/5 border border-orange-500/10 rounded px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-orange-300">{risk.keyword}</span>
                      <span className="text-[9px] text-orange-400">{risk.pageCount} pages</span>
                    </div>
                    <p className="text-[9px] text-[#64748B] mt-1">Similarity {risk.avgSimilarity.toFixed(2)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="actions" className="space-y-3 mt-3">
          {analytics.linkOpportunities.length > 0 ? (
            <div>
              <p className="text-[10px] text-[#64748B] mb-2 uppercase tracking-wider flex items-center gap-1">
                <Link2 className="h-3 w-3" />
                Link Opportunities
              </p>
              <div className="space-y-1.5">
                {analytics.linkOpportunities.slice(0, 12).map((item) => (
                  <div key={`${item.fromUrl}::${item.toUrl}`} className="bg-[#0F172A] rounded p-2">
                    <p className="text-[9px] text-[#64748B]">From</p>
                    <div className="text-[10px] font-mono text-[#94A3B8] truncate">
                      {renderUrlLink(item.fromUrl, "text-[#94A3B8]")}
                    </div>
                    <p className="text-[9px] text-[#64748B] mt-1">To</p>
                    <div className="text-[10px] font-mono text-cyan-300 truncate">
                      {renderUrlLink(item.toUrl, "text-cyan-300")}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[9px] text-[#475569] truncate">{item.reason}</span>
                      <span className="text-[9px] text-cyan-400 shrink-0">{item.similarity.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-[#0F172A] rounded-lg p-3 text-xs text-[#64748B]">
              No link opportunities were detected in the current crawl snapshot.
            </div>
          )}

          <div>
            <p className="text-[10px] text-[#64748B] mb-2 uppercase tracking-wider flex items-center gap-1">
              <Target className="h-3 w-3" />
              Link-Starved Pages
            </p>
            <div className="space-y-1">
              {analytics.linkStarved.slice(0, 8).map((page) => (
                <div key={page.url} className="flex items-center justify-between bg-orange-500/5 border border-orange-500/10 rounded px-2.5 py-1.5">
                  <span className="text-[10px] font-mono text-orange-300 truncate flex-1">
                    {renderUrlLink(page.url, "text-orange-300")}
                  </span>
                  <span className="text-[10px] text-orange-400 shrink-0">{page.inboundLinks} links</span>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function SiteGraphPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [showAnalytics, setShowAnalytics] = useState(true);

  const projectStateQuery = useQuery<ProjectProcessingState>({
    queryKey: ["project-processing-state", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to load project state");
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

  const { data, isLoading, refetch } = useQuery<GraphData>({
    queryKey: ["graph", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/graph?analytics=true`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[#64748B]" />
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="No graph data yet"
        description="The site graph will be generated after a crawl completes."
      />
    );
  }

  return (
    <div className="-mx-6 px-6 space-y-4">
      {isProjectProcessing && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 flex items-start gap-3">
          <Loader2 className="h-4 w-4 text-blue-400 animate-spin mt-0.5" />
          <div>
            <p className="text-sm text-blue-300 font-medium">
              {isPostCrawlProcessing ? "Parsing crawled data for site graph" : "Crawl in progress"}
            </p>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              {isPostCrawlProcessing
                ? "Rebuilding graph topology and semantic intelligence from the latest crawl. New graph data will appear automatically."
                : "Graph data will update automatically as crawl results arrive."}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-xs text-[#64748B]">
          <BarChart3 className="h-3.5 w-3.5" />
          Graph now includes KNN similarity, semantic segments, and link opportunity insights.
        </div>

        {data.analytics && (
          <button
            onClick={() => setShowAnalytics((current) => !current)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#111827] border border-[#1E293B] rounded-lg hover:bg-[#1E293B] transition-colors"
            title={showAnalytics ? "Hide analytics" : "Show analytics"}
          >
            {showAnalytics ? (
              <>
                <EyeOff className="h-3.5 w-3.5 text-[#94A3B8]" />
                <span className="text-[#94A3B8]">Focus Graph</span>
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5 text-[#94A3B8]" />
                <span className="text-[#94A3B8]">Show Analytics</span>
              </>
            )}
          </button>
        )}
      </div>

      <div className="space-y-4">
        <div className="relative min-w-0">
          <SiteGraph projectId={projectId} data={data} />
        </div>

        {showAnalytics && data.analytics && (
          <div className="min-w-0">
            <Card className="bg-[#111827] border-[#1E293B]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-[#94A3B8] flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Graph Intelligence
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AnalyticsPanel analytics={data.analytics} />
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
