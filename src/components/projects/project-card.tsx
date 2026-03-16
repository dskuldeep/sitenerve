"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Globe, FileText, AlertTriangle, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { HealthScoreRing } from "./health-score-ring";

interface ProjectCardProps {
  project: {
    id: string;
    name: string;
    siteUrl: string;
    status: string;
    healthScore: number;
    totalPages: number;
    totalIssues: number;
    lastCrawlAt: string | null;
  };
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="bg-[#111827] border-[#1E293B] hover:border-[#334155] hover:bg-[#111827]/80 transition-all cursor-pointer group">
        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-[#F8FAFC] truncate group-hover:text-blue-400 transition-colors">
                {project.name}
              </h3>
              <p className="text-xs font-mono text-[#06B6D4] truncate mt-0.5">
                {project.siteUrl}
              </p>
            </div>
            <HealthScoreRing score={project.healthScore} size={48} strokeWidth={3} />
          </div>

          <div className="flex items-center gap-4 text-xs text-[#64748B]">
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {project.totalPages} pages
            </span>
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {project.totalIssues} issues
            </span>
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#1E293B]">
            <StatusIndicator status={project.status} />
            {project.lastCrawlAt && (
              <span className="flex items-center gap-1 text-[10px] text-[#64748B]">
                <Clock className="h-3 w-3" />
                {formatDistanceToNow(new Date(project.lastCrawlAt), { addSuffix: true })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
