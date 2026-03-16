"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bell, Check, CheckCheck, AlertTriangle, Globe, Bug, Bot, Webhook, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useNotificationStore } from "@/stores/notification-store";
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
  NEW_PAGE: <Globe className="h-4 w-4 text-blue-400" />,
  PAGE_REMOVED: <Globe className="h-4 w-4 text-red-400" />,
  NEW_ISSUE: <Bug className="h-4 w-4 text-orange-400" />,
  ISSUE_RESOLVED: <Check className="h-4 w-4 text-green-400" />,
  ISSUE_REGRESSION: <AlertTriangle className="h-4 w-4 text-red-400" />,
  AGENT_FINDING: <Bot className="h-4 w-4 text-cyan-400" />,
  CRAWL_FAILED: <AlertTriangle className="h-4 w-4 text-red-400" />,
  CRAWL_COMPLETED: <Check className="h-4 w-4 text-green-400" />,
  WEBHOOK_FAILED: <Webhook className="h-4 w-4 text-red-400" />,
};

const severityColors: Record<string, string> = {
  CRITICAL: "border-l-red-500",
  HIGH: "border-l-orange-500",
  MEDIUM: "border-l-yellow-500",
  LOW: "border-l-blue-500",
  INFO: "border-l-slate-500",
};

export function NotificationPanel({ onClose }: { onClose?: () => void }) {
  const queryClient = useQueryClient();
  const { setUnreadCount } = useNotificationStore();

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?limit=50");
      const json = await res.json();
      if (json.success) {
        const unread = json.data.filter((n: Notification) => !n.isRead).length;
        setUnreadCount(unread);
        return json.data;
      }
      return [];
    },
    refetchInterval: 30000,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications/mark-all-read", { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      setUnreadCount(0);
    },
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-[#1E293B]">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-[#94A3B8]" />
          <h2 className="text-lg font-semibold text-[#F8FAFC]">Notifications</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => markAllRead.mutate()}
          disabled={markAllRead.isPending}
          className="text-xs text-[#64748B] hover:text-[#F8FAFC]"
        >
          <CheckCheck className="h-3 w-3 mr-1" />
          Mark all read
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[#64748B]" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Bell className="h-10 w-10 text-[#334155] mb-3" />
            <p className="text-sm text-[#64748B]">No notifications yet</p>
            <p className="text-xs text-[#475569] mt-1">
              Notifications will appear here when crawls complete, issues are detected, or agents finish runs.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#1E293B]">
            {notifications.map((notification) => (
              <button
                key={notification.id}
                onClick={() => {
                  if (!notification.isRead) {
                    markRead.mutate(notification.id);
                  }
                }}
                className={cn(
                  "w-full text-left p-4 hover:bg-[#1E293B]/50 transition-colors border-l-2",
                  severityColors[notification.severity] || "border-l-transparent",
                  !notification.isRead && "bg-blue-500/5"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">
                    {typeIcons[notification.type] || <Bell className="h-4 w-4 text-[#64748B]" />}
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
                    <p className="text-xs text-[#94A3B8] line-clamp-2">{notification.body}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge
                        variant="secondary"
                        className="text-[10px] bg-[#1E293B] text-[#64748B] px-1.5 py-0"
                      >
                        {notification.project?.name}
                      </Badge>
                      <span className="text-[10px] text-[#64748B]">
                        {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
