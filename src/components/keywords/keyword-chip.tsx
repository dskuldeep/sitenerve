"use client";

import { Badge } from "@/components/ui/badge";

export function KeywordChip({
  keyword,
  onClick,
}: {
  keyword: string;
  onClick?: () => void;
}) {
  return (
    <Badge
      variant="secondary"
      onClick={onClick}
      className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 text-[10px] px-1.5 py-0 cursor-pointer hover:bg-cyan-500/20 transition-colors"
    >
      {keyword}
    </Badge>
  );
}
