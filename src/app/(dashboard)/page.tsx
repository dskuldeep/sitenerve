"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FolderKanban,
  FileText,
  AlertTriangle,
  Activity,
  Bell,
  ArrowUpRight,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { CardSkeleton } from "@/components/shared/loading-skeleton";
import { ProjectCard } from "@/components/projects/project-card";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";

interface Project {
  id: string;
  name: string;
  siteUrl: string;
  status: string;
  healthScore: number;
  totalPages: number;
  totalIssues: number;
  lastCrawlAt: string | null;
}

interface Notification {
  id: string;
  type: string;
  severity: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  project: { name: string };
}

interface DashboardMetrics {
  issuesBySeverity: Array<{
    crawl: string;
    critical: number;
    high: number;
    medium: number;
    low: number;
  }>;
  healthScoreTrend: Array<{
    date: string;
    score: number | null;
  }>;
}

const severityColors: Record<string, string> = {
  CRITICAL: "text-red-400 bg-red-400/10",
  HIGH: "text-orange-400 bg-orange-400/10",
  MEDIUM: "text-yellow-400 bg-yellow-400/10",
  LOW: "text-blue-400 bg-blue-400/10",
  INFO: "text-slate-400 bg-slate-400/10",
};

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

export default function DashboardPage() {
  const [selectedProjectId, setSelectedProjectId] = useState("ALL");

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["notifications", "dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?limit=5");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  const { data: metrics } = useQuery<DashboardMetrics>({
    queryKey: ["dashboard-metrics", selectedProjectId],
    queryFn: async () => {
      const query =
        selectedProjectId !== "ALL"
          ? `?projectId=${encodeURIComponent(selectedProjectId)}`
          : "";
      const res = await fetch(`/api/dashboard/metrics${query}`);
      const json = await res.json();
      return json.success
        ? json.data
        : { issuesBySeverity: [], healthScoreTrend: [] };
    },
  });

  const totalPages = projects.reduce((sum, p) => sum + p.totalPages, 0);
  const totalIssues = projects.reduce((sum, p) => sum + p.totalIssues, 0);
  const avgHealthScore =
    projects.length > 0
      ? Math.round(
          projects.reduce((sum, p) => sum + p.healthScore, 0) / projects.length
        )
      : 0;

  const stats = [
    {
      label: "Total Projects",
      value: projects.length,
      icon: FolderKanban,
      color: "text-blue-400",
      bgColor: "bg-blue-400/10",
    },
    {
      label: "Pages Crawled",
      value: totalPages,
      icon: FileText,
      color: "text-cyan-400",
      bgColor: "bg-cyan-400/10",
    },
    {
      label: "Active Issues",
      value: totalIssues,
      icon: AlertTriangle,
      color: "text-orange-400",
      bgColor: "bg-orange-400/10",
    },
    {
      label: "Avg Health Score",
      value: avgHealthScore,
      icon: Activity,
      color: "text-emerald-400",
      bgColor: "bg-emerald-400/10",
    },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Overview of all your monitored sites"
      >
        <CreateProjectDialog />
      </PageHeader>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <Card key={stat.label} className="bg-[#111827] border-[#1E293B]">
            <CardContent className="p-4">
              <div className="flex items-center mb-3">
                <div className={`rounded-lg ${stat.bgColor} p-2.5`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
              <p className="text-2xl font-bold text-[#F8FAFC]">
                {stat.value.toLocaleString()}
              </p>
              <p className="text-xs text-[#64748B] mt-0.5">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {/* Issues by Severity - Stacked Bar Chart */}
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-medium text-[#94A3B8]">
                  Issues by Severity
                </CardTitle>
                <p className="text-xs text-[#64748B]">
                  Last 7 days for {selectedProject ? selectedProject.name : "all projects"}
                </p>
              </div>
              <Select value={selectedProjectId} onValueChange={(value) => value && setSelectedProjectId(value)}>
                <SelectTrigger className="w-[180px] bg-[#111827] border-[#1E293B] text-[#F8FAFC] text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#111827] border-[#1E293B]">
                  <SelectItem value="ALL" className="text-[#94A3B8]">
                    All projects
                  </SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id} className="text-[#94A3B8]">
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="pb-4">
            {(metrics?.issuesBySeverity?.length ?? 0) === 0 ? (
              <div className="h-[240px] rounded-lg border border-dashed border-[#334155] flex items-center justify-center text-xs text-[#64748B]">
                No issue trend data yet. Crawl a project to populate this graph.
              </div>
            ) : (
              <>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={metrics?.issuesBySeverity || []}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#1E293B"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="crawl"
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
                      <Bar
                        dataKey="critical"
                        stackId="issues"
                        fill="#EF4444"
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="high"
                        stackId="issues"
                        fill="#F97316"
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="medium"
                        stackId="issues"
                        fill="#F59E0B"
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="low"
                        stackId="issues"
                        fill="#3B82F6"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-center gap-4 mt-2">
                  {[
                    { label: "Critical", color: "#EF4444" },
                    { label: "High", color: "#F97316" },
                    { label: "Medium", color: "#F59E0B" },
                    { label: "Low", color: "#3B82F6" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-[10px] text-[#64748B]">
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Health Score Trend - Area Chart */}
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[#94A3B8]">
              Health Score Trend
            </CardTitle>
            <p className="text-xs text-[#64748B]">
              Daily crawl history for {selectedProject ? selectedProject.name : "all projects"}
            </p>
          </CardHeader>
          <CardContent className="pb-4">
            {(metrics?.healthScoreTrend?.length ?? 0) === 0 ? (
              <div className="h-[240px] rounded-lg border border-dashed border-[#334155] flex items-center justify-center text-xs text-[#64748B]">
                No health trend yet. Complete at least one crawl to start tracking.
              </div>
            ) : (
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={metrics?.healthScoreTrend || []}>
                    <defs>
                      <linearGradient
                        id="healthGradient"
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
                      domain={[0, 100]}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="score"
                      stroke="#3B82F6"
                      strokeWidth={2}
                      fill="url(#healthGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity Feed */}
      {notifications.length > 0 && (
        <Card className="bg-[#111827] border-[#1E293B] mb-8">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-[#64748B]" />
                <CardTitle className="text-sm font-medium text-[#94A3B8]">
                  Recent Activity
                </CardTitle>
              </div>
              <a
                href="/notifications"
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
              >
                View all
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
          </CardHeader>
          <CardContent className="space-y-1 pt-0">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                  notification.isRead
                    ? "opacity-60"
                    : "bg-[#0F172A]/50"
                }`}
              >
                <div
                  className={`mt-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    severityColors[notification.severity] || severityColors.INFO
                  }`}
                >
                  {notification.severity}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#F8FAFC] truncate">
                    {notification.title}
                  </p>
                  <p className="text-xs text-[#64748B] mt-0.5 truncate">
                    {notification.project?.name} &middot;{" "}
                    {formatDistanceToNow(new Date(notification.createdAt), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
                {!notification.isRead && (
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-400 shrink-0" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Projects Grid */}
      <div className="mb-2">
        <h2 className="text-sm font-medium text-[#94A3B8] mb-4">Projects</h2>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create your first project to start monitoring a website with AI-powered technical SEO insights."
        >
          <CreateProjectDialog />
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
