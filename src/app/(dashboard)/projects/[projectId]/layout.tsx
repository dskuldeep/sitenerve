"use client";

import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Network,
  AlertTriangle,
  Key,
  Bot,
  Bell,
  Settings,
  Loader2,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const tabs = [
  { slug: "", label: "Overview", icon: LayoutDashboard },
  { slug: "/graph", label: "Site Graph", icon: Network },
  { slug: "/issues", label: "Issues", icon: AlertTriangle },
  { slug: "/keywords", label: "Keywords", icon: Key },
  { slug: "/agents", label: "Agents", icon: Bot },
  { slug: "/notifications", label: "Notifications", icon: Bell },
  { slug: "/settings", label: "Settings", icon: Settings },
];

interface Project {
  id: string;
  name: string;
  siteUrl: string;
  status: string;
}

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const pathname = usePathname();
  const projectId = params.projectId as string;
  const basePath = `/projects/${projectId}`;

  const { data: project, isLoading } = useQuery<Project>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    refetchInterval: (query) => {
      const data = query.state.data as Project | undefined;
      return data?.status === "CRAWLING" || data?.status === "INITIALIZING"
        ? 2000
        : false;
    },
  });

  const queryClient = useQueryClient();

  const runAudit = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/crawl`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to start audit");
      }
      return json;
    },
    onSuccess: () => {
      toast.success("Audit started successfully");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to start audit");
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[#64748B]" />
      </div>
    );
  }

  return (
    <div>
      {/* Project header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-[#F8FAFC]">{project?.name}</h1>
            {project?.status && <StatusIndicator status={project.status} />}
          </div>
          <p className="text-sm font-mono text-[#06B6D4]">{project?.siteUrl}</p>
        </div>

        {project && project.status !== "CRAWLING" && project.status !== "INITIALIZING" && (
          <Button 
            onClick={() => runAudit.mutate()} 
            disabled={runAudit.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
          >
            {runAudit.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2 fill-current" />
            )}
            Run Audit
          </Button>
        )}
      </div>

      {/* Tab navigation */}
      <div className="border-b border-[#1E293B] mb-6 -mx-6 px-6 sticky top-14 z-20 bg-[#0A0F1C]/95 backdrop-blur-sm">
        <nav className="flex gap-0 overflow-x-auto">
          {tabs.map((tab) => {
            const href = `${basePath}${tab.slug}`;
            const isActive =
              tab.slug === ""
                ? pathname === basePath
                : pathname.startsWith(href);

            return (
              <Link
                key={tab.slug}
                href={href}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 text-sm border-b-2 transition-colors whitespace-nowrap",
                  isActive
                    ? "border-blue-500 text-blue-500"
                    : "border-transparent text-[#64748B] hover:text-[#94A3B8] hover:border-[#334155]"
                )}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      <div className="animate-fade-in">{children}</div>
    </div>
  );
}
