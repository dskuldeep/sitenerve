"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const severityStyles: Record<string, string> = {
  CRITICAL: "bg-red-500/10 text-red-400 border-red-500/20",
  HIGH: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  MEDIUM: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  LOW: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  INFO: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

export function SeverityBadge({ severity, className }: { severity: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-medium px-1.5 py-0",
        severityStyles[severity] || severityStyles.INFO,
        className
      )}
    >
      {severity}
    </Badge>
  );
}
