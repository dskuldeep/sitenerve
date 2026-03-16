"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Plus, Play, Settings, Clock, Zap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { CardSkeleton } from "@/components/shared/loading-skeleton";
import { seedPrompts } from "@/services/agents/seed-prompts";
import { TRIGGER_TYPES } from "@/lib/constants";
import { formatDistanceToNow } from "date-fns";

const PROFILE_DEFAULT_MODEL_VALUE = "__PROFILE_DEFAULT__";

interface Agent {
  id: string;
  name: string;
  description: string | null;
  triggerType: string;
  isActive: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  skills: string[];
  _count: { runs: number };
}

interface GeminiModelOption {
  id: string;
  name: string;
  description: string;
}

export default function AgentsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [newAgent, setNewAgent] = useState({
    name: "",
    description: "",
    agentType: "TECHNICAL_SEO_AUDITOR",
    triggerType: "MANUAL",
    geminiModel: PROFILE_DEFAULT_MODEL_VALUE,
  });

  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ["agents", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/agents`);
      const json = await res.json();
      return json.success ? json.data : [];
    },
    refetchInterval: (query) =>
      (query.state.data || []).some((agent) => agent.lastRunStatus === "RUNNING") ? 3000 : false,
  });

  const modelsQuery = useQuery<GeminiModelOption[]>({
    queryKey: ["gemini-models"],
    queryFn: async () => {
      const res = await fetch("/api/models");
      const json = await res.json();
      if (!res.ok || !json.success) {
        if (res.status === 400) {
          return [];
        }
        throw new Error(json.error || "Failed to load models");
      }

      return json.data as GeminiModelOption[];
    },
  });

  const createAgent = useMutation({
    mutationFn: async () => {
      const seed = seedPrompts[newAgent.agentType as keyof typeof seedPrompts] || seedPrompts["CUSTOM"];
      const res = await fetch(`/api/projects/${projectId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newAgent.name || seed.name,
          description: newAgent.description || seed.description,
          prompt: seed.prompt,
          seedPrompt: seed.prompt,
          triggerType: newAgent.triggerType,
          geminiModel:
            newAgent.geminiModel === PROFILE_DEFAULT_MODEL_VALUE
              ? undefined
              : newAgent.geminiModel,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      return json.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["agents", projectId] });
      toast.success("Agent created");
      setCreateOpen(false);
      router.push(`/projects/${projectId}/agents/${data.id}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ agentId, isActive }: { agentId: string; isActive: boolean }) => {
      await fetch(`/api/projects/${projectId}/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents", projectId] }),
  });

  const runAgent = useMutation({
    mutationFn: async (agentId: string) => {
      const res = await fetch(`/api/projects/${projectId}/agents/${agentId}/run`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      return json;
    },
    onSuccess: () => {
      toast.success("Agent run started");
      queryClient.invalidateQueries({ queryKey: ["agents", projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button className="bg-blue-600 hover:bg-blue-700 text-white" />}>
              <Plus className="h-4 w-4 mr-2" />New Agent
          </DialogTrigger>
          <DialogContent className="bg-[#111827] border-[#1E293B]">
            <DialogHeader>
              <DialogTitle className="text-[#F8FAFC]">Create New Agent</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[#94A3B8]">Agent Type</Label>
                <Select value={newAgent.agentType} onValueChange={(v) => v && setNewAgent((p) => ({ ...p, agentType: v }))}>
                  <SelectTrigger className="bg-[#1E293B] border-[#334155] text-[#F8FAFC]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1E293B] border-[#334155]">
                    {Object.entries(seedPrompts).map(([type, seed]) => (
                      <SelectItem key={type} value={type} className="text-[#94A3B8]">
                        <div>
                          <p className="text-sm">{seed.name}</p>
                          <p className="text-[10px] text-[#64748B]">{seed.description.substring(0, 80)}</p>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[#94A3B8]">Name (optional)</Label>
                <Input value={newAgent.name} onChange={(e) => setNewAgent((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Auto-generated from type" className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B]" />
              </div>
              <div className="space-y-2">
                <Label className="text-[#94A3B8]">Trigger</Label>
                <Select value={newAgent.triggerType} onValueChange={(v) => v && setNewAgent((p) => ({ ...p, triggerType: v }))}>
                  <SelectTrigger className="bg-[#1E293B] border-[#334155] text-[#F8FAFC]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1E293B] border-[#334155]">
                    {TRIGGER_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value} className="text-[#94A3B8]">{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[#94A3B8]">Model</Label>
                <Select
                  value={newAgent.geminiModel}
                  onValueChange={(value) => {
                    if (!value) return;
                    setNewAgent((prev) => ({ ...prev, geminiModel: value }));
                  }}
                >
                  <SelectTrigger className="bg-[#1E293B] border-[#334155] text-[#F8FAFC]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1E293B] border-[#334155]">
                    <SelectItem value={PROFILE_DEFAULT_MODEL_VALUE} className="text-[#94A3B8]">
                      Use profile default
                    </SelectItem>
                    {(modelsQuery.data || []).map((model) => (
                      <SelectItem key={model.id} value={model.id} className="text-[#94A3B8]">
                        <div>
                          <p className="text-sm">{model.name}</p>
                          <p className="text-[10px] text-[#64748B]">{model.description}</p>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {modelsQuery.isLoading && (
                  <p className="text-[10px] text-[#64748B]">Loading models from Gemini...</p>
                )}
                {modelsQuery.isError && (
                  <p className="text-[10px] text-red-400">
                    {modelsQuery.error instanceof Error ? modelsQuery.error.message : "Unable to load models"}
                  </p>
                )}
                {!modelsQuery.isLoading && (modelsQuery.data || []).length === 0 && (
                  <p className="text-[10px] text-amber-400">
                    Add a Gemini API key in profile settings to choose per-agent models.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-[#94A3B8]">Description (optional)</Label>
                <Textarea value={newAgent.description} onChange={(e) => setNewAgent((p) => ({ ...p, description: e.target.value }))}
                  placeholder="What does this agent do?" className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B] resize-none" rows={2} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setCreateOpen(false)}
                  className="text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B]">Cancel</Button>
                <Button onClick={() => createAgent.mutate()} disabled={createAgent.isPending}
                  className="bg-blue-600 hover:bg-blue-700 text-white">
                  {createAgent.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create Agent
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CardSkeleton /><CardSkeleton />
        </div>
      ) : agents.length === 0 ? (
        <EmptyState icon={Bot} title="No agents configured"
          description="Create an AI agent to autonomously audit your site and surface SEO issues.">
          <Button onClick={() => setCreateOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white mt-2">
            <Plus className="h-4 w-4 mr-2" />Create Your First Agent
          </Button>
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents.map((agent) => (
            <Card key={agent.id} className="bg-[#111827] border-[#1E293B] hover:border-[#334155] transition-colors">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-[#F8FAFC] truncate">{agent.name}</h3>
                    {agent.description && (
                      <p className="text-xs text-[#64748B] mt-0.5 line-clamp-2">{agent.description}</p>
                    )}
                  </div>
                  <Switch checked={agent.isActive}
                    onCheckedChange={(checked) => toggleActive.mutate({ agentId: agent.id, isActive: checked })}
                    className="shrink-0" />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={`text-[10px] border-[#334155] ${
                    agent.triggerType === "POST_CRAWL" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                    agent.triggerType === "MANUAL" ? "bg-[#1E293B] text-[#64748B]" :
                    "bg-blue-500/10 text-blue-400 border-blue-500/20"
                  }`}>
                    <Zap className="h-2.5 w-2.5 mr-1" />
                    {agent.triggerType === "POST_CRAWL" ? "Auto (after crawl)" :
                     agent.triggerType === "ON_NEW_ISSUES" ? "Auto (new issues)" :
                     agent.triggerType === "ON_NEW_PAGES" ? "Auto (new pages)" :
                     TRIGGER_TYPES.find((t) => t.value === agent.triggerType)?.label || agent.triggerType}
                  </Badge>
                  {(agent.skills as string[])?.length > 0 && (
                    <Badge variant="outline" className="text-[10px] bg-[#1E293B] text-[#64748B] border-[#334155]">
                      {(agent.skills as string[]).length} skills
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] bg-[#1E293B] text-[#64748B] border-[#334155]">
                    {agent._count.runs} runs
                  </Badge>
                  {agent.lastRunStatus && (
                    <StatusIndicator status={agent.lastRunStatus} />
                  )}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#1E293B]">
                  <span className="text-[10px] text-[#64748B] flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {agent.lastRunAt
                      ? `Last run ${formatDistanceToNow(new Date(agent.lastRunAt), { addSuffix: true })}`
                      : "Never run"}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm"
                      onClick={() => runAgent.mutate(agent.id)}
                      disabled={runAgent.isPending}
                      className="h-7 px-2 text-xs text-[#94A3B8] hover:text-green-400 hover:bg-green-500/10">
                      <Play className="h-3 w-3 mr-1" />Run
                    </Button>
                    <Button variant="ghost" size="sm"
                      onClick={() => router.push(`/projects/${projectId}/agents/${agent.id}`)}
                      className="h-7 px-2 text-xs text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B]">
                      <Settings className="h-3 w-3 mr-1" />Edit
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
