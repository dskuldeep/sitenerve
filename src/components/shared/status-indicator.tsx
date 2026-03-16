"use client";

import { cn } from "@/lib/utils";

const statusColors: Record<string, { dot: string; bg: string; text: string }> = {
  ACTIVE: { dot: "bg-green-500", bg: "bg-green-500/10", text: "text-green-400" },
  CRAWLING: { dot: "bg-blue-500 animate-pulse", bg: "bg-blue-500/10", text: "text-blue-400" },
  INITIALIZING: { dot: "bg-yellow-500 animate-pulse", bg: "bg-yellow-500/10", text: "text-yellow-400" },
  PAUSED: { dot: "bg-gray-500", bg: "bg-gray-500/10", text: "text-gray-400" },
  ERROR: { dot: "bg-red-500", bg: "bg-red-500/10", text: "text-red-400" },
  SUCCESS: { dot: "bg-green-500", bg: "bg-green-500/10", text: "text-green-400" },
  FAILED: { dot: "bg-red-500", bg: "bg-red-500/10", text: "text-red-400" },
  PARTIAL: { dot: "bg-yellow-500", bg: "bg-yellow-500/10", text: "text-yellow-400" },
  RUNNING: { dot: "bg-blue-500 animate-pulse", bg: "bg-blue-500/10", text: "text-blue-400" },
  QUEUED: { dot: "bg-gray-400", bg: "bg-gray-500/10", text: "text-gray-400" },
  COMPLETED: { dot: "bg-green-500", bg: "bg-green-500/10", text: "text-green-400" },
};

interface StatusIndicatorProps {
  status: string;
  className?: string;
}

export function StatusIndicator({ status, className }: StatusIndicatorProps) {
  const colors = statusColors[status] || statusColors.ACTIVE;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
        colors.bg,
        colors.text,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", colors.dot)} />
      {status}
    </span>
  );
}
