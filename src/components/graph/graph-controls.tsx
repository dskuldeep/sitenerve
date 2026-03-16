"use client";

import { useState } from "react";
import { Search, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface GraphControlsProps {
  groups: string[];
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onSearch: (query: string) => void;
  onGroupFilter: (group: string) => void;
  onSeverityFilter: (severity: string) => void;
  onToggleLabels: (show: boolean) => void;
  onToggle3D: (is3D: boolean) => void;
  onToggleNewOnly: (newOnly: boolean) => void;
  showLabels: boolean;
  is3D: boolean;
  newOnly: boolean;
}

export function GraphControls({
  groups,
  onZoomIn,
  onZoomOut,
  onFit,
  onSearch,
  onGroupFilter,
  onSeverityFilter,
  onToggleLabels,
  onToggle3D,
  onToggleNewOnly,
  showLabels,
  is3D,
  newOnly,
}: GraphControlsProps) {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="absolute top-3 left-3 right-3 z-10 pointer-events-none">
      <div className="pointer-events-auto rounded-xl border border-[#334155]/80 bg-[#0F172A]/90 backdrop-blur-md shadow-[0_10px_35px_rgba(2,6,23,0.45)] p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#64748B]" />
            <Input
              placeholder="Search by URL or page label"
              value={searchQuery}
              onChange={(event) => {
                const value = event.target.value;
                setSearchQuery(value);
                onSearch(value);
              }}
              className="pl-8 h-8 text-xs bg-[#0B1220] border-[#334155] text-[#E2E8F0] placeholder:text-[#64748B]"
            />
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="outline"
              size="icon"
              onClick={onZoomIn}
              className="h-8 w-8 border-[#334155] bg-[#0B1220] text-[#94A3B8] hover:text-[#F8FAFC]"
              title="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={onZoomOut}
              className="h-8 w-8 border-[#334155] bg-[#0B1220] text-[#94A3B8] hover:text-[#F8FAFC]"
              title="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={onFit}
              className="h-8 w-8 border-[#334155] bg-[#0B1220] text-[#94A3B8] hover:text-[#F8FAFC]"
              title="Fit graph"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <Select
            defaultValue="ALL"
            onValueChange={(value) => {
              if (value) onGroupFilter(value);
            }}
          >
            <SelectTrigger className="h-8 text-xs bg-[#0B1220] border-[#334155] text-[#94A3B8]">
              <SelectValue placeholder="Section" />
            </SelectTrigger>
            <SelectContent className="bg-[#1E293B] border-[#334155]">
              <SelectItem value="ALL" className="text-[#94A3B8] text-xs">All Sections</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group} value={group} className="text-[#94A3B8] text-xs">
                  /{group}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            defaultValue="ALL"
            onValueChange={(value) => {
              if (value) onSeverityFilter(value);
            }}
          >
            <SelectTrigger className="h-8 text-xs bg-[#0B1220] border-[#334155] text-[#94A3B8]">
              <SelectValue placeholder="Issue severity" />
            </SelectTrigger>
            <SelectContent className="bg-[#1E293B] border-[#334155]">
              <SelectItem value="ALL" className="text-[#94A3B8] text-xs">All Severity</SelectItem>
              <SelectItem value="healthy" className="text-green-400 text-xs">Healthy</SelectItem>
              <SelectItem value="low" className="text-yellow-400 text-xs">Low</SelectItem>
              <SelectItem value="medium" className="text-orange-400 text-xs">Medium</SelectItem>
              <SelectItem value="high" className="text-red-400 text-xs">High/Critical</SelectItem>
              <SelectItem value="unreachable" className="text-slate-300 text-xs">Unreachable</SelectItem>
            </SelectContent>
          </Select>

          <div className="h-8 rounded-md border border-[#334155] bg-[#0B1220] px-2.5 flex items-center justify-between">
            <Label className="text-[11px] text-[#94A3B8]">Labels</Label>
            <Switch checked={showLabels} onCheckedChange={onToggleLabels} className="scale-75" />
          </div>

          <div className="h-8 rounded-md border border-[#334155] bg-[#0B1220] px-2.5 flex items-center justify-between">
            <Label className="text-[11px] text-[#94A3B8]">3D Mode</Label>
            <Switch checked={is3D} onCheckedChange={onToggle3D} className="scale-75" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="h-8 rounded-md border border-[#334155] bg-[#0B1220] px-2.5 flex items-center gap-2">
            <Label className="text-[11px] text-[#94A3B8]">New pages only</Label>
            <Switch checked={newOnly} onCheckedChange={onToggleNewOnly} className="scale-75" />
          </div>

          <div className="flex items-center gap-3 text-[10px] text-[#94A3B8]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
              Node fill color = semantic KNN cluster
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
              Unreachable pages can be filtered
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
