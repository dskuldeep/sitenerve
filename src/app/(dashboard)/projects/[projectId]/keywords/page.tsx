"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Key, Search, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/shared/empty-state";
import { KeywordChip } from "@/components/keywords/keyword-chip";
import { TableSkeleton } from "@/components/shared/loading-skeleton";

interface PageKeywords {
  id: string;
  url: string;
  title: string | null;
  keywords: Array<{ keyword: string; score: number; sources: string[] }>;
}

export default function KeywordsPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [search, setSearch] = useState("");
  const [filterKeyword, setFilterKeyword] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["keywords", projectId, search],
    queryFn: async () => {
      const qp = new URLSearchParams();
      if (search) qp.set("search", search);
      const res = await fetch(`/api/projects/${projectId}/keywords?${qp}`);
      const json = await res.json();
      return json.success ? json.data : { items: [], total: 0 };
    },
  });

  const filteredItems = filterKeyword
    ? data?.items?.filter((p: PageKeywords) =>
        p.keywords.some((k) => k.keyword === filterKeyword)
      )
    : data?.items;

  const exportCsv = () => {
    if (!filteredItems?.length) return;
    const headers = ["URL", "Title", "Keywords", "Top Score"];
    const rows = filteredItems.map((p: PageKeywords) => [
      p.url,
      p.title || "",
      p.keywords.map((k) => k.keyword).join("; "),
      p.keywords[0]?.score?.toFixed(2) || "0",
    ]);
    const csv = [headers, ...rows].map((r: string[]) => r.map((c: string) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "keywords.csv";
    a.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
          <Input
            placeholder="Search by URL, title, or keyword..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-[#1E293B] border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B]"
          />
        </div>
        {filterKeyword && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilterKeyword(null)}
            className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/20"
          >
            Showing: &quot;{filterKeyword}&quot; &times;
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={exportCsv}
          className="ml-auto bg-transparent border-[#334155] text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B]">
          <Download className="h-3 w-3 mr-1" />CSV
        </Button>
      </div>

      <p className="text-xs text-[#64748B]">{filteredItems?.length || 0} pages with keywords</p>

      {isLoading ? (
        <TableSkeleton rows={8} />
      ) : !filteredItems?.length ? (
        <EmptyState icon={Key} title="No keywords found"
          description="Keywords will be extracted after a crawl completes and the keyword analysis runs." />
      ) : (
        <div className="rounded-lg border border-[#1E293B] overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#111827] hover:bg-[#111827] border-[#1E293B]">
                <TableHead className="text-[#64748B]">Page URL</TableHead>
                <TableHead className="text-[#64748B]">Title</TableHead>
                <TableHead className="text-[#64748B]">Top Keywords</TableHead>
                <TableHead className="text-[#64748B] w-24 text-right">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((page: PageKeywords) => (
                <TableRow key={page.id} className="bg-[#0A0F1C] hover:bg-[#263348] border-[#1E293B]">
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger render={<span className="text-xs font-mono text-[#06B6D4] truncate max-w-[200px] block" />}>
                          {page.url}
                      </TooltipTrigger>
                      <TooltipContent className="bg-[#1E293B] text-[#F8FAFC] border-[#334155] max-w-md">
                        <p className="font-mono text-xs break-all">{page.url}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-sm text-[#94A3B8] max-w-[200px] truncate">
                    {page.title || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {page.keywords.slice(0, 5).map((kw) => (
                        <KeywordChip
                          key={kw.keyword}
                          keyword={kw.keyword}
                          onClick={() => setFilterKeyword(kw.keyword)}
                        />
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm font-mono text-[#F8FAFC]">
                    {page.keywords[0]?.score?.toFixed(1) || "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
