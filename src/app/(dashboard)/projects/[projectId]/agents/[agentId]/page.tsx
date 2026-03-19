"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import {
  Play, RotateCcw, Save, Loader2, Clock, Hash, Brain, Trash2, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SeverityBadge } from "@/components/issues/severity-badge";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useDebounce } from "@/hooks/use-debounce";
import { TRIGGER_TYPES } from "@/lib/constants";
import {
  getAgentContextConfigFromTriggerConfig,
  mergeAgentTriggerConfig,
  parseAgentRunToolTrace,
  type AgentContextConfig,
  type AgentRunToolTraceStep,
} from "@/types/agents";
import { formatDistanceToNow } from "date-fns";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });
const PROFILE_DEFAULT_MODEL_VALUE = "__PROFILE_DEFAULT__";

function ToolTraceBlock({ step, index }: { step: AgentRunToolTraceStep; index: number }) {
  if (step.type === "function_calls") {
    return (
      <div className="rounded-md border border-[#1E293B] bg-[#111827] p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-emerald-400/90">
          Step {index + 1} — Model called tools
        </p>
        {step.calls.map((c, j) => (
          <div key={`${c.name}-${j}`} className="space-y-1">
            <code className="text-xs text-[#F8FAFC]">{c.name}</code>
            <pre className="overflow-x-auto text-[10px] leading-relaxed text-[#94A3B8] bg-[#0A0F1C] rounded p-2 border border-[#1E293B] max-h-40 overflow-y-auto">
              {JSON.stringify(c.args, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    );
  }
  if (step.type === "function_results") {
    return (
      <div className="rounded-md border border-[#1E293B] bg-[#111827] p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-sky-400/90">
          Step {index + 1} — Tool results
        </p>
        {step.results.map((r, j) => (
          <div key={`${r.name}-${j}`} className="space-y-1">
            <code className="text-xs text-[#F8FAFC]">{r.name}</code>
            <pre className="overflow-x-auto text-[10px] leading-relaxed text-[#94A3B8] bg-[#0A0F1C] rounded p-2 border border-[#1E293B] max-h-48 overflow-y-auto">
              {JSON.stringify(r.response, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    );
  }
  if (step.type === "submit_findings") {
    return (
      <div className="rounded-md border border-violet-500/25 bg-violet-500/10 p-3">
        <p className="text-[10px] uppercase tracking-wide text-violet-300">
          Step {index + 1} — submit_agent_results
        </p>
        <p className="text-xs text-[#CBD5E1] mt-1">
          Submitted <strong>{step.findingsCount}</strong> finding{step.findingsCount === 1 ? "" : "s"}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
      <p className="text-[10px] uppercase tracking-wide text-amber-200/90">
        Step {index + 1} — Model text (no tool calls)
      </p>
      <pre className="mt-2 text-[10px] text-[#94A3B8] whitespace-pre-wrap max-h-40 overflow-y-auto">
        {step.text}
      </pre>
    </div>
  );
}

interface GeminiModelOption {
  id: string;
  name: string;
  description: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
}

interface AgentDetail {
  id: string;
  name: string;
  description: string | null;
  prompt: string;
  seedPrompt: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  skills: string[];
  geminiModel: string | null;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  isActive: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextScheduledAt: string | null;
  runs: Array<{
    id: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    duration: number | null;
    tokensUsed: number | null;
    modelUsed: string | null;
    errorMessage: string | null;
    toolTrace: unknown | null;
    findings: Array<{
      id: string;
      type: string;
      title: string;
      severity: string;
      description: string;
      confidence: number | null;
    }>;
  }>;
}

interface AgentDraft {
  name: string;
  prompt: string;
  triggerType: string;
  scheduleCron: string;
  contextConfig: AgentContextConfig;
  geminiModel: string;
  webhookEnabled: boolean;
  webhookUrl: string;
  isActive: boolean;
}

interface AgentRuntimePreview {
  fullPrompt: string;
  model: string | null;
  toolLoopEnabled: boolean;
  toolNames: string[];
  summary: {
    siteUrl: string;
    totalPages: number;
    totalIssues: number;
    healthScore: number;
    previousFindingsCount: number;
    attachedSkillsCount: number;
  };
  sections: Array<{
    key: string;
    title: string;
    description: string;
    content: string;
    included: boolean;
    available: boolean;
    itemCount?: number;
  }>;
}

function toDraft(agent: AgentDetail): AgentDraft {
  return {
    name: agent.name,
    prompt: agent.prompt,
    triggerType: agent.triggerType,
    scheduleCron:
      typeof agent.triggerConfig?.cron === "string"
        ? agent.triggerConfig.cron
        : typeof agent.triggerConfig?.schedule === "string"
          ? agent.triggerConfig.schedule
          : "0 2 * * *",
    contextConfig: getAgentContextConfigFromTriggerConfig(agent.triggerConfig),
    geminiModel: agent.geminiModel || "",
    webhookEnabled: agent.webhookEnabled,
    webhookUrl: agent.webhookUrl || "",
    isActive: agent.isActive,
  };
}

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const agentId = params.agentId as string;
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: agent, isLoading } = useQuery<AgentDetail>({
    queryKey: ["agent", agentId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/agents/${agentId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    refetchInterval: (query) =>
      query.state.data?.lastRunStatus === "RUNNING" ? 3000 : false,
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

  const baseDraft = useMemo(() => (agent ? toDraft(agent) : null), [agent]);
  const activeDraft = draft || baseDraft;
  const previewPayload = useMemo(
    () =>
      activeDraft
        ? {
            prompt: activeDraft.prompt,
            geminiModel: activeDraft.geminiModel || null,
            contextConfig: activeDraft.contextConfig,
          }
        : null,
    [activeDraft]
  );
  const debouncedPreviewPayload = useDebounce(previewPayload, 400);

  const previewQuery = useQuery<AgentRuntimePreview>({
    queryKey: ["agent-preview", agentId, debouncedPreviewPayload],
    enabled: Boolean(agent && debouncedPreviewPayload),
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/agents/${agentId}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(debouncedPreviewPayload),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load runtime preview");
      }
      return json.data as AgentRuntimePreview;
    },
  });

  const saveAgent = useMutation({
    mutationFn: async () => {
      const currentAgent = agent;
      const payload = draft || (agent ? toDraft(agent) : null);
      if (!payload || !currentAgent) {
        throw new Error("Agent not loaded");
      }

      const res = await fetch(`/api/projects/${projectId}/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: payload.name,
          prompt: payload.prompt,
          triggerType: payload.triggerType,
          triggerConfig: mergeAgentTriggerConfig({
            existingTriggerConfig: currentAgent.triggerConfig,
            triggerType: payload.triggerType,
            scheduleCron: payload.scheduleCron,
            contextConfig: payload.contextConfig,
          }),
          geminiModel: payload.geminiModel || null,
          webhookEnabled: payload.webhookEnabled,
          webhookUrl: payload.webhookEnabled ? payload.webhookUrl || null : null,
          isActive: payload.isActive,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: () => {
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
      toast.success("Agent saved");
    },
  });

  const runAgent = useMutation({
    mutationFn: async () => {
      const payload = draft || (agent ? toDraft(agent) : null);
      if (!payload) {
        throw new Error("Agent not loaded");
      }

      const res = await fetch(`/api/projects/${projectId}/agents/${agentId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: payload.prompt,
          geminiModel: payload.geminiModel || null,
          contextConfig: payload.contextConfig,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to run");
    },
    onSuccess: () => {
      toast.success("Agent run started");
      queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteAgent = useMutation({
    mutationFn: async () => {
      await fetch(`/api/projects/${projectId}/agents/${agentId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast.success("Agent deleted");
      router.push(`/projects/${projectId}/agents`);
    },
  });

  const selectedGeminiModel = activeDraft?.geminiModel || agent?.geminiModel || "";

  const modelOptions = useMemo(() => {
    const existingOptions = modelsQuery.data || [];
    if (!selectedGeminiModel || existingOptions.some((model) => model.id === selectedGeminiModel)) {
      return existingOptions;
    }

    return [
      ...existingOptions,
      {
        id: selectedGeminiModel,
        name: selectedGeminiModel,
        description: "Currently selected model",
        inputTokenLimit: null,
        outputTokenLimit: null,
      },
    ];
  }, [modelsQuery.data, selectedGeminiModel]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[#64748B]" />
      </div>
    );
  }

  if (!agent || !activeDraft) return null;

  const form = activeDraft;
  const persistedScheduleCron =
    typeof agent.triggerConfig?.cron === "string"
      ? agent.triggerConfig.cron
      : typeof agent.triggerConfig?.schedule === "string"
        ? agent.triggerConfig.schedule
        : "0 2 * * *";
  const persistedContextConfig = getAgentContextConfigFromTriggerConfig(agent.triggerConfig);
  const hasChanges =
    form.prompt !== agent.prompt ||
    form.name !== agent.name ||
    form.triggerType !== agent.triggerType ||
    form.scheduleCron !== persistedScheduleCron ||
    form.contextConfig.includeProjectSummary !== persistedContextConfig.includeProjectSummary ||
    form.contextConfig.includePageData !== persistedContextConfig.includePageData ||
    form.contextConfig.includeExistingIssues !== persistedContextConfig.includeExistingIssues ||
    form.contextConfig.includePreviousFindings !== persistedContextConfig.includePreviousFindings ||
    form.contextConfig.includeLatestCrawlDelta !== persistedContextConfig.includeLatestCrawlDelta ||
    form.geminiModel !== (agent.geminiModel || "") ||
    form.webhookEnabled !== agent.webhookEnabled ||
    form.webhookUrl !== (agent.webhookUrl || "") ||
    form.isActive !== agent.isActive;
  const webhookConfigValid = !form.webhookEnabled || Boolean(form.webhookUrl.trim());
  const scheduleConfigValid =
    form.triggerType !== "SCHEDULED" || Boolean(form.scheduleCron.trim());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Input value={form.name} onChange={(e) => setDraft((prev) => ({ ...(prev || toDraft(agent)), name: e.target.value }))}
            className="text-lg font-bold bg-transparent border-none text-[#F8FAFC] p-0 h-auto focus-visible:ring-0 max-w-md" />
          <Switch
            checked={form.isActive}
            onCheckedChange={(nextIsActive) =>
              setDraft((prev) => ({ ...(prev || toDraft(agent)), isActive: nextIsActive }))
            }
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}
            className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm"
            onClick={() => {
              setDraft((prev) => ({ ...(prev || toDraft(agent)), prompt: agent.seedPrompt }));
              toast.info("Prompt reset to seed");
            }}
            className="bg-transparent border-[#334155] text-[#94A3B8] hover:text-[#F8FAFC]">
            <RotateCcw className="h-3 w-3 mr-1" />Reset
          </Button>
          <Button variant="outline" size="sm" onClick={() => runAgent.mutate()} disabled={runAgent.isPending}
            className="bg-transparent border-[#334155] text-green-400 hover:bg-green-500/10">
            {runAgent.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
            Test Run
          </Button>
          <Button
            size="sm"
            onClick={() => saveAgent.mutate()}
            disabled={
              !hasChanges || saveAgent.isPending || !webhookConfigValid || !scheduleConfigValid
            }
            className="bg-blue-600 hover:bg-blue-700 text-white">
            {saveAgent.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
            Save
          </Button>
        </div>
      </div>

      {/* Split layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Prompt Editor (60%) */}
        <div className="lg:col-span-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-[#94A3B8] text-sm">System Prompt</Label>
              <p className="mt-1 text-[11px] text-[#64748B]">
                The next test run uses the prompt currently shown here, even before save.
              </p>
            </div>
            <span className="text-[10px] text-[#64748B]">{form.prompt.length} chars</span>
          </div>
          <div className="rounded-lg border border-[#1E293B] overflow-hidden h-[500px]">
            <MonacoEditor
              height="100%"
              language="markdown"
              value={form.prompt}
              onChange={(val) =>
                setDraft((prev) => ({ ...(prev || toDraft(agent)), prompt: val || "" }))
              }
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace",
                wordWrap: "on",
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                padding: { top: 12 },
              }}
            />
          </div>

          <Card className="bg-[#111827] border-[#1E293B]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-[#94A3B8]">Runtime Preview</CardTitle>
              <p className="text-xs text-[#64748B]">
                Inspect bootstrap prompt sections. In tool mode the model also receives callable tools to fetch
                pages, issues, and crawl deltas on demand.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {previewQuery.data && (
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  <div className="rounded-md border border-[#1E293B] bg-[#0A0F1C] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-[#64748B]">Site</p>
                    <p className="mt-1 truncate text-xs text-[#F8FAFC]">{previewQuery.data.summary.siteUrl}</p>
                  </div>
                  <div className="rounded-md border border-[#1E293B] bg-[#0A0F1C] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-[#64748B]">Pages</p>
                    <p className="mt-1 text-xs text-[#F8FAFC]">{previewQuery.data.summary.totalPages}</p>
                  </div>
                  <div className="rounded-md border border-[#1E293B] bg-[#0A0F1C] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-[#64748B]">Active Issues</p>
                    <p className="mt-1 text-xs text-[#F8FAFC]">{previewQuery.data.summary.totalIssues}</p>
                  </div>
                  <div className="rounded-md border border-[#1E293B] bg-[#0A0F1C] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-[#64748B]">Previous Findings</p>
                    <p className="mt-1 text-xs text-[#F8FAFC]">{previewQuery.data.summary.previousFindingsCount}</p>
                  </div>
                  <div className="rounded-md border border-[#1E293B] bg-[#0A0F1C] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-[#64748B]">Attached Skills</p>
                    <p className="mt-1 text-xs text-[#F8FAFC]">{previewQuery.data.summary.attachedSkillsCount}</p>
                  </div>
                  <div className="rounded-md border border-[#1E293B] bg-[#0A0F1C] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-[#64748B]">Model</p>
                    <p className="mt-1 truncate text-xs text-[#F8FAFC]">
                      {previewQuery.data.model || "Profile default"}
                    </p>
                  </div>
                  <div className="rounded-md border border-[#1E293B] bg-[#0A0F1C] px-3 py-2 col-span-2 lg:col-span-3">
                    <p className="text-[10px] uppercase tracking-wide text-[#64748B]">Execution</p>
                    <p className="mt-1 text-xs text-[#F8FAFC]">
                      {previewQuery.data.toolLoopEnabled
                        ? "Tool loop — fetches data in batches via Gemini function calls"
                        : "Single-shot — full context inlined (set AGENT_USE_TOOL_LOOP=false)"}
                    </p>
                    {previewQuery.data.toolLoopEnabled && previewQuery.data.toolNames.length > 0 && (
                      <p className="mt-1 text-[10px] text-[#64748B] break-words">
                        Tools: {previewQuery.data.toolNames.join(", ")}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {previewQuery.isLoading && (
                <div className="flex items-center gap-2 rounded-md border border-[#1E293B] bg-[#0A0F1C] px-3 py-3 text-xs text-[#94A3B8]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Building runtime preview...
                </div>
              )}

              {previewQuery.isError && (
                <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-3 text-xs text-red-300">
                  {previewQuery.error instanceof Error
                    ? previewQuery.error.message
                    : "Unable to load runtime preview"}
                </div>
              )}

              {previewQuery.data && (
                <Tabs defaultValue="sections" className="gap-3">
                  <TabsList className="bg-[#0A0F1C]">
                    <TabsTrigger value="sections">Sections</TabsTrigger>
                    <TabsTrigger value="full-prompt">Full Prompt</TabsTrigger>
                  </TabsList>
                  <TabsContent value="sections">
                    <ScrollArea className="h-[360px] rounded-md border border-[#1E293B] bg-[#0A0F1C]">
                      <Accordion className="px-3 py-2">
                        {previewQuery.data.sections.map((section) => (
                          <AccordionItem key={section.key} value={section.key} className="border-[#1E293B]">
                            <AccordionTrigger className="hover:no-underline py-3">
                              <div className="flex flex-wrap items-center gap-2 text-left">
                                <span className="text-xs text-[#F8FAFC]">{section.title}</span>
                                <Badge
                                  variant="outline"
                                  className={section.included && section.available
                                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                    : "border-[#334155] bg-[#111827] text-[#64748B]"}
                                >
                                  {section.included && section.available ? "Included" : "Excluded"}
                                </Badge>
                                {typeof section.itemCount === "number" && (
                                  <Badge
                                    variant="outline"
                                    className="border-[#334155] bg-[#111827] text-[#64748B]"
                                  >
                                    {section.itemCount} items
                                  </Badge>
                                )}
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="space-y-3 pb-4">
                              <p className="text-xs text-[#64748B]">{section.description}</p>
                              <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-[#1E293B] bg-[#111827] p-3 text-[11px] leading-5 text-[#CBD5E1]">
                                {section.available ? section.content : "No data available for this section yet."}
                              </pre>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </ScrollArea>
                  </TabsContent>
                  <TabsContent value="full-prompt">
                    {previewQuery.data.toolLoopEnabled && (
                      <p className="text-[10px] text-[#64748B] mb-2">
                        Includes an appendix with the same function declarations (name, description, parameter JSON)
                        the model receives as Gemini tools — the live API registers tools separately; this is for
                        visibility in preview.
                      </p>
                    )}
                    <ScrollArea className="h-[360px] rounded-md border border-[#1E293B] bg-[#0A0F1C]">
                      <pre className="whitespace-pre-wrap p-4 text-[11px] leading-5 text-[#CBD5E1]">
                        {previewQuery.data.fullPrompt}
                      </pre>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Configuration Panel (40%) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Trigger Config */}
          <Card className="bg-[#111827] border-[#1E293B]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-[#94A3B8]">Trigger Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select
                value={form.triggerType}
                onValueChange={(value) => {
                  if (!value) return;
                  setDraft((prev) => ({ ...(prev || toDraft(agent)), triggerType: value }));
                }}
              >
                <SelectTrigger className="bg-[#1E293B] border-[#334155] text-[#F8FAFC]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1E293B] border-[#334155]">
                  {TRIGGER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="text-[#94A3B8]">{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.triggerType === "SCHEDULED" && (
                <div className="space-y-2">
                  <Label className="text-xs text-[#94A3B8]">Schedule Cron</Label>
                  <Input
                    value={form.scheduleCron}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...(prev || toDraft(agent)),
                        scheduleCron: event.target.value,
                      }))
                    }
                    placeholder="0 2 * * *"
                    className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B]"
                  />
                  <p className="text-[11px] text-[#64748B]">
                    Example: <code>0 2 * * *</code> runs daily at 02:00 UTC.
                  </p>
                  <div className="grid grid-cols-1 gap-2 pt-1">
                    <div className="rounded-md border border-[#1E293B] bg-[#0A0F1C] px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-[#64748B]">
                        Scheduler status
                      </p>
                      <p className="mt-1 text-xs text-[#F8FAFC]">
                        {form.isActive ? "Enabled" : "Agent disabled"}
                      </p>
                    </div>
                    <div className="rounded-md border border-[#1E293B] bg-[#0A0F1C] px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-[#64748B]">
                        Next run
                      </p>
                      <p className="mt-1 text-xs text-cyan-400">
                        {agent.nextScheduledAt
                          ? formatDistanceToNow(new Date(agent.nextScheduledAt), {
                              addSuffix: true,
                            })
                          : "Will appear after save"}
                      </p>
                    </div>
                    <div className="rounded-md border border-[#1E293B] bg-[#0A0F1C] px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-[#64748B]">
                        Last run
                      </p>
                      <p className="mt-1 text-xs text-[#F8FAFC]">
                        {agent.lastRunAt
                          ? formatDistanceToNow(new Date(agent.lastRunAt), { addSuffix: true })
                          : "Never run"}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-[#111827] border-[#1E293B]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-[#94A3B8]">Runtime Context</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                {
                  key: "includeProjectSummary" as const,
                  label: "Project summary",
                  description: "Site URL, total pages, issue count, and health score.",
                },
                {
                  key: "includePageData" as const,
                  label: "Page data",
                  description: "Per-page crawl data including titles, canonicals, links, and image counts.",
                },
                {
                  key: "includeExistingIssues" as const,
                  label: "Existing audit findings",
                  description: "Deterministic issue data used as baseline evidence.",
                },
                {
                  key: "includePreviousFindings" as const,
                  label: "Previous agent findings",
                  description: "Last successful run output for delta analysis and de-duplication.",
                },
                {
                  key: "includeLatestCrawlDelta" as const,
                  label: "Latest crawl delta",
                  description: "URL diff plus newly found, resolved, and persisted issues from the most recent completed crawl.",
                },
              ].map((item) => (
                <div
                  key={item.key}
                  className="flex items-start justify-between gap-3 rounded-md border border-[#1E293B] bg-[#0A0F1C] px-3 py-2"
                >
                  <div className="space-y-1">
                    <p className="text-xs text-[#F8FAFC]">{item.label}</p>
                    <p className="text-[11px] leading-4 text-[#64748B]">{item.description}</p>
                  </div>
                  <Switch
                    checked={form.contextConfig[item.key]}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => ({
                        ...(prev || toDraft(agent)),
                        contextConfig: {
                          ...(prev || toDraft(agent)).contextConfig,
                          [item.key]: checked,
                        },
                      }))
                    }
                  />
                </div>
              ))}
              <p className="text-[11px] text-[#64748B]">
                These toggles affect both the preview below and the next test run payload.
              </p>
            </CardContent>
          </Card>

          {/* Model Override */}
          <Card className="bg-[#111827] border-[#1E293B]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-[#94A3B8]">Model Override</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select
                value={form.geminiModel || PROFILE_DEFAULT_MODEL_VALUE}
                onValueChange={(value) => {
                  if (!value) return;
                  setDraft((prev) => ({
                    ...(prev || toDraft(agent)),
                    geminiModel: value === PROFILE_DEFAULT_MODEL_VALUE ? "" : value,
                  }));
                }}
              >
                <SelectTrigger className="bg-[#1E293B] border-[#334155] text-[#F8FAFC]">
                  <SelectValue placeholder="Use default model" />
                </SelectTrigger>
                <SelectContent className="bg-[#1E293B] border-[#334155]">
                  <SelectItem value={PROFILE_DEFAULT_MODEL_VALUE} className="text-[#94A3B8]">Use profile default</SelectItem>
                  {modelOptions.map((model) => (
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
                <p className="text-xs text-[#64748B]">Loading models from Gemini...</p>
              )}
              {modelsQuery.isError && (
                <p className="text-xs text-red-400">
                  {modelsQuery.error instanceof Error ? modelsQuery.error.message : "Unable to load models"}
                </p>
              )}
              {!modelsQuery.isLoading && modelOptions.length === 0 && (
                <p className="text-xs text-amber-400">
                  Add a Gemini API key in profile AI settings to select per-agent models.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Skills */}
          <Card className="bg-[#111827] border-[#1E293B]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-[#94A3B8]">Attached Skills</CardTitle>
            </CardHeader>
            <CardContent>
              {(agent.skills as string[])?.length > 0 ? (
                <div className="space-y-2">
                  {(agent.skills as string[]).map((skill) => (
                    <div key={skill} className="flex items-center gap-2 p-2 rounded bg-[#0A0F1C] border border-[#1E293B]">
                      <Brain className="h-3 w-3 text-cyan-400 shrink-0" />
                      <span className="text-xs font-mono text-[#94A3B8] truncate">{skill}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#64748B]">No skills attached. Skills can be added from the skills browser.</p>
              )}
            </CardContent>
          </Card>

          {/* Agent Webhook */}
          <Card className="bg-[#111827] border-[#1E293B]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-[#94A3B8]">Agent Webhook</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-md border border-[#1E293B] bg-[#0A0F1C] px-3 py-2">
                <p className="text-xs text-[#94A3B8]">Send findings to webhook</p>
                <Switch
                  checked={form.webhookEnabled}
                  onCheckedChange={(nextEnabled) =>
                    setDraft((prev) => ({ ...(prev || toDraft(agent)), webhookEnabled: nextEnabled }))
                  }
                />
              </div>
              <Input
                value={form.webhookUrl}
                onChange={(event) =>
                  setDraft((prev) => ({ ...(prev || toDraft(agent)), webhookUrl: event.target.value }))
                }
                placeholder="https://example.com/webhook"
                disabled={!form.webhookEnabled}
                className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B]"
              />
              <p className="text-[11px] text-[#64748B]">
                When enabled, each completed agent run posts findings JSON to this URL.
              </p>
              {!webhookConfigValid && (
                <p className="text-[11px] text-red-400">Webhook URL is required when webhook delivery is enabled.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Run History */}
      <Card className="bg-[#111827] border-[#1E293B]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-[#94A3B8]">Run History</CardTitle>
        </CardHeader>
        <CardContent>
          {agent.lastRunStatus === "RUNNING" && (
            <div className="mb-4 rounded-md border border-blue-500/20 bg-blue-500/10 p-3">
              <p className="text-xs text-blue-300 flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Agent run in progress. Findings will appear after completion.
              </p>
            </div>
          )}
          {agent.runs.length === 0 ? (
            <p className="text-xs text-[#64748B] py-4 text-center">
              No runs yet. Click &quot;Test Run&quot; to execute this agent.
            </p>
          ) : (
            <Accordion>
              {agent.runs.map((run) => {
                const runTrace = parseAgentRunToolTrace(run.toolTrace);
                return (
                <AccordionItem key={run.id} value={run.id} className="border-[#1E293B]">
                  <AccordionTrigger className="hover:no-underline py-3">
                    <div className="flex items-center gap-3 text-left">
                      <StatusIndicator status={run.status} />
                      <span className="text-xs text-[#64748B]">
                        {formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
                      </span>
                      {run.duration && (
                        <span className="text-[10px] text-[#475569] flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />{(run.duration / 1000).toFixed(1)}s
                        </span>
                      )}
                      {run.tokensUsed && (
                        <span className="text-[10px] text-[#475569] flex items-center gap-1">
                          <Hash className="h-2.5 w-2.5" />{run.tokensUsed} tokens
                        </span>
                      )}
                      <Badge variant="outline" className="text-[10px] bg-[#1E293B] text-[#64748B] border-[#334155]">
                        {run.findings.length} findings
                      </Badge>
                      {runTrace && runTrace.steps.length > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        >
                          {runTrace.steps.length} tool steps
                        </Badge>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    {run.status === "FAILED" && (
                      <p className="text-xs text-red-300/90 bg-red-950/40 border border-red-500/20 rounded p-2 mb-2 whitespace-pre-wrap break-words">
                        {run.errorMessage?.trim() ||
                          "Run failed (no error message stored). Check worker logs."}
                      </p>
                    )}
                    {runTrace && runTrace.steps.length > 0 && (
                      <Collapsible defaultOpen={false} className="mb-4 rounded-md border border-[#1E293B] bg-[#0A0F1C]">
                        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left outline-none hover:bg-[#111827] transition-colors rounded-md">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-[#94A3B8]">
                              Tool trace · {runTrace.steps.length} steps
                            </p>
                            <p className="text-[10px] text-[#64748B] mt-0.5">
                              Calls and payloads (large responses may be truncated for storage). Click to expand.
                            </p>
                          </div>
                          <ChevronDown className="size-4 shrink-0 text-[#64748B] transition-transform group-aria-expanded:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="border-t border-[#1E293B] px-3 pb-3 pt-2">
                          <div className="space-y-2">
                            {runTrace.steps.map((step, i) => (
                              <ToolTraceBlock key={i} step={step} index={i} />
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                    {run.findings.length === 0 ? (
                      run.status !== "FAILED" ? (
                        <p className="text-xs text-[#64748B] py-2">No findings from this run.</p>
                      ) : null
                    ) : (
                      <div className="space-y-2">
                        {run.findings.map((finding) => (
                          <div key={finding.id} className="p-3 rounded bg-[#0A0F1C] border border-[#1E293B]">
                            <div className="flex items-center gap-2 mb-1">
                              <SeverityBadge severity={finding.severity} />
                              <Badge variant="outline" className="text-[10px] bg-[#1E293B] text-[#64748B] border-[#334155]">
                                {finding.type}
                              </Badge>
                              {finding.confidence && (
                                <span className="text-[10px] text-[#475569]">
                                  {Math.round(finding.confidence * 100)}% confidence
                                </span>
                              )}
                            </div>
                            <p className="text-sm font-medium text-[#F8FAFC]">{finding.title}</p>
                            <p className="text-xs text-[#94A3B8] mt-1 line-clamp-3">{finding.description}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
                );
              })}
            </Accordion>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Agent"
        description="This will permanently delete this agent and all its run history. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deleteAgent.isPending}
        onConfirm={() => deleteAgent.mutate()}
      />
    </div>
  );
}
