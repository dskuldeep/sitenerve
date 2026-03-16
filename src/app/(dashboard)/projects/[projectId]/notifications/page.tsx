"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  Bell,
  Globe,
  ClipboardCheck,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Bot,
  Award,
  CheckCheck,
  Loader2,
  Filter,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

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

const typeIcons: Record<string, React.ReactNode> = {
  CRAWL_COMPLETE: <Globe className="h-4 w-4 text-blue-400" />,
  AUDIT_COMPLETE: <ClipboardCheck className="h-4 w-4 text-green-400" />,
  HEALTH_DROP: <TrendingDown className="h-4 w-4 text-red-400" />,
  HEALTH_IMPROVE: <TrendingUp className="h-4 w-4 text-emerald-400" />,
  ISSUE_SPIKE: <AlertTriangle className="h-4 w-4 text-orange-400" />,
  AGENT_COMPLETE: <Bot className="h-4 w-4 text-cyan-400" />,
  QUALIFICATION_READY: <Award className="h-4 w-4 text-yellow-400" />,
};

const severityBorders: Record<string, string> = {
  CRITICAL: "border-l-red-500",
  HIGH: "border-l-orange-500",
  MEDIUM: "border-l-yellow-500",
  LOW: "border-l-blue-500",
  INFO: "border-l-[#334155]",
};

const filterTypes = [
  { value: "all", label: "All Types" },
  { value: "crawl", label: "Crawl" },
  { value: "audit", label: "Audit" },
  { value: "health", label: "Health" },
  { value: "agent", label: "Agent" },
] as const;

const typeFilterMap: Record<string, string[]> = {
  crawl: ["CRAWL_COMPLETE"],
  audit: ["AUDIT_COMPLETE"],
  health: ["HEALTH_DROP", "HEALTH_IMPROVE"],
  agent: ["AGENT_COMPLETE"],
};

export default function ProjectNotificationsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["project-notifications", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/notifications?projectId=${projectId}`);
      const json = await res.json();
      return json.success ? json.data : [];
    },
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-notifications", projectId] });
      queryClient.invalidateQueries({ queryKey: ["notifications-count"] });
      toast.success("Notification marked as read");
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications/mark-all-read", { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-notifications", projectId] });
      queryClient.invalidateQueries({ queryKey: ["notifications-count"] });
      toast.success("All notifications marked as read");
    },
  });

  const filtered =
    typeFilter === "all"
      ? notifications
      : notifications.filter((n) =>
          typeFilterMap[typeFilter]?.includes(n.type)
        );

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div>
      <PageHeader title="Notifications" description="Alerts and updates for this project">
        <div className="flex items-center gap-2">
          <Select value={typeFilter} onValueChange={(v) => v && setTypeFilter(v)}>
            <SelectTrigger className="w-[140px] bg-[#111827] border-[#1E293B] text-[#F8FAFC] text-sm h-9">
              <Filter className="h-3.5 w-3.5 mr-1.5 text-[#64748B]" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#111827] border-[#1E293B]">
              {filterTypes.map((ft) => (
                <SelectItem
                  key={ft.value}
                  value={ft.value}
                  className="text-[#F8FAFC] focus:bg-[#1E293B] focus:text-[#F8FAFC]"
                >
                  {ft.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="text-xs text-[#64748B] hover:text-[#F8FAFC] hover:bg-[#1E293B]"
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
              Mark all read
            </Button>
          )}
        </div>
      </PageHeader>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[#64748B]" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No Notifications"
          description={
            typeFilter === "all"
              ? "Notifications for crawl completions, new issues, and agent reports will appear here"
              : `No ${typeFilter} notifications found`
          }
        />
      ) : (
        <div className="rounded-lg border border-[#1E293B] bg-[#111827] overflow-hidden divide-y divide-[#1E293B]">
          {filtered.map((notification) => (
            <div
              key={notification.id}
              className={cn(
                "flex items-start gap-3 p-4 border-l-2 transition-colors hover:bg-[#1E293B]/50",
                severityBorders[notification.severity] || "border-l-transparent",
                !notification.isRead && "bg-blue-500/5"
              )}
            >
              <div className="mt-0.5 shrink-0">
                {typeIcons[notification.type] || (
                  <Bell className="h-4 w-4 text-[#64748B]" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-[#F8FAFC] truncate">
                    {notification.title}
                  </span>
                  {!notification.isRead && (
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                  )}
                </div>
                <p className="text-xs text-[#94A3B8] line-clamp-2">
                  {notification.body}
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-[#1E293B] text-[#64748B] px-1.5 py-0"
                  >
                    {notification.type.replace(/_/g, " ")}
                  </Badge>
                  <span className="text-[10px] text-[#64748B]">
                    {formatDistanceToNow(new Date(notification.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              </div>
              {!notification.isRead && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => markRead.mutate(notification.id)}
                  disabled={markRead.isPending}
                  className="shrink-0 text-[10px] text-[#64748B] hover:text-[#F8FAFC] hover:bg-[#1E293B] h-7 px-2"
                >
                  Mark read
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
