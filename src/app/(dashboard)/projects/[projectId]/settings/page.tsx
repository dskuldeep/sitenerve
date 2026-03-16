"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Globe,
  Link2,
  Trash2,
  Loader2,
  Send,
  Eye,
  EyeOff,
  Bug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

interface ProjectSettings {
  id: string;
  name: string;
  siteUrl: string;
  crawlSchedule?: string | null;
  maxCrawlPages: number;
}

interface WebhookConfig {
  enabled: boolean;
  url: string;
  secret: string;
  hasSecret?: boolean;
  events: string[];
}

const WEBHOOK_EVENTS = [
  { id: "crawl.completed", label: "Crawl Completed" },
  { id: "audit.completed", label: "Audit Completed" },
  { id: "issues.new", label: "New Issues Detected" },
  { id: "health.changed", label: "Health Score Changed" },
];

function scheduleToFrequency(schedule?: string | null): string {
  if (!schedule) return "daily";
  if (schedule === "manual") return "manual";
  if (schedule === "0 2 * * 1") return "weekly";
  if (schedule === "0 2 1 * *") return "monthly";
  if (schedule === "0 2 * * *") return "daily";
  return "daily";
}

function frequencyToSchedule(frequency: string): string {
  switch (frequency) {
    case "weekly":
      return "0 2 * * 1";
    case "monthly":
      return "0 2 1 * *";
    case "manual":
      return "manual";
    case "daily":
    default:
      return "0 2 * * *";
  }
}

export default function ProjectSettingsPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectId = params.projectId;

  // General settings state
  const [name, setName] = useState<string | undefined>(undefined);
  const [siteUrl, setSiteUrl] = useState<string | undefined>(undefined);

  // Crawl settings state
  const [crawlFrequency, setCrawlFrequency] = useState<string | undefined>(undefined);
  const [maxCrawlPages, setMaxCrawlPages] = useState<number | undefined>(undefined);

  // Webhook state
  const [webhookEnabled, setWebhookEnabled] = useState<boolean | undefined>(undefined);
  const [webhookUrl, setWebhookUrl] = useState<string | undefined>(undefined);
  const [webhookSecret, setWebhookSecret] = useState<string | undefined>(undefined);
  const [showSecret, setShowSecret] = useState(false);
  const [webhookEvents, setWebhookEvents] = useState<string[] | undefined>(undefined);

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Fetch project settings
  const { data: project, isLoading } = useQuery<ProjectSettings>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("Failed to fetch project");
      const json = await res.json();
      return json.data;
    },
  });

  // Fetch webhook config
  const { data: webhookConfig } = useQuery<WebhookConfig>({
    queryKey: ["webhook-config", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/webhooks/config`);
      if (!res.ok) throw new Error("Failed to fetch webhook config");
      const json = await res.json();
      return json.data;
    },
  });

  const currentName = name ?? project?.name ?? "";
  const currentSiteUrl = siteUrl ?? project?.siteUrl ?? "";
  const currentCrawlFrequency =
    crawlFrequency ?? scheduleToFrequency(project?.crawlSchedule);
  const currentMaxCrawlPages = maxCrawlPages ?? project?.maxCrawlPages ?? 5000;
  const currentWebhookEnabled = webhookEnabled ?? webhookConfig?.enabled ?? false;
  const currentWebhookUrl = webhookUrl ?? webhookConfig?.url ?? "";
  const currentWebhookSecret = webhookSecret ?? webhookConfig?.secret ?? "";
  const hasStoredWebhookSecret = webhookConfig?.hasSecret ?? false;
  const currentWebhookEvents = webhookEvents ?? webhookConfig?.events ?? [];

  // Save general + crawl settings
  const saveSettings = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: currentName,
          siteUrl: currentSiteUrl,
          maxCrawlPages: currentMaxCrawlPages,
          crawlSchedule: frequencyToSchedule(currentCrawlFrequency),
        }),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Project settings saved");
      queryClient.invalidateQueries({ queryKey: ["project-settings", projectId] });
    },
    onError: () => toast.error("Failed to save project settings"),
  });

  // Save webhook config
  const saveWebhook = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/webhooks/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: currentWebhookEnabled,
          url: currentWebhookUrl,
          secret: webhookSecret,
          events: currentWebhookEvents,
        }),
      });
      if (!res.ok) throw new Error("Failed to save webhook config");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Webhook configuration saved");
      queryClient.invalidateQueries({ queryKey: ["webhook-config", projectId] });
    },
    onError: () => toast.error("Failed to save webhook configuration"),
  });

  // Test webhook
  const testWebhook = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/webhooks/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: currentWebhookEnabled,
          url: currentWebhookUrl,
          secret: webhookSecret,
          events: currentWebhookEvents,
        }),
      });
      if (!res.ok) throw new Error("Webhook test failed");
      return res.json();
    },
    onSuccess: () => toast.success("Test webhook sent successfully"),
    onError: () => toast.error("Webhook test failed"),
  });

  // Delete project
  const deleteProject = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete project");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Project deleted");
      setDeleteDialogOpen(false);
      router.push("/projects");
    },
    onError: () => toast.error("Failed to delete project"),
  });

  function toggleWebhookEvent(eventId: string) {
    if (currentWebhookEvents.includes(eventId)) {
      setWebhookEvents(currentWebhookEvents.filter((event) => event !== eventId));
      return;
    }
    setWebhookEvents([...currentWebhookEvents, eventId]);
  }

  if (isLoading) {
    return (
      <div>
        <PageHeader
          title="Project Settings"
          description="Manage crawl configuration, schedules, and project preferences"
        />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-[#64748B]" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Project Settings"
        description="Manage crawl configuration, schedules, and project preferences"
      />

      <div className="space-y-6 max-w-2xl">
        {/* General Settings */}
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardHeader>
            <CardTitle className="text-[#F8FAFC] text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-400" />
              General Settings
            </CardTitle>
            <CardDescription className="text-[#64748B]">
              Basic project information and site URL.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
                <Label className="text-[#94A3B8]">Project Name</Label>
              <Input
                value={currentName}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Website"
                className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[#94A3B8]">Site URL</Label>
              <Input
                value={currentSiteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                placeholder="https://example.com"
                className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B]"
              />
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => saveSettings.mutate()}
                disabled={saveSettings.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {saveSettings.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Crawl Settings */}
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardHeader>
            <CardTitle className="text-[#F8FAFC] text-base flex items-center gap-2">
              <Bug className="h-4 w-4 text-cyan-400" />
              Crawl Settings
            </CardTitle>
            <CardDescription className="text-[#64748B]">
              Configure how the crawler scans your site.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[#94A3B8]">Hard Page Limit</Label>
              <Input
                type="number"
                min={1}
                max={50000}
                value={currentMaxCrawlPages}
                onChange={(e) => setMaxCrawlPages(parseInt(e.target.value) || 1)}
                className="bg-[#1E293B] border-[#334155] text-[#F8FAFC]"
              />
              <p className="text-xs text-[#64748B]">The absolute maximum pages the crawler is allowed to hit for this site.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-[#94A3B8]">Crawl Frequency</Label>
              <Select
                value={currentCrawlFrequency}
                onValueChange={(v) => v && setCrawlFrequency(v)}
              >
                <SelectTrigger className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1E293B] border-[#334155]">
                  <SelectItem value="daily" className="text-[#94A3B8]">
                    Daily
                  </SelectItem>
                  <SelectItem value="weekly" className="text-[#94A3B8]">
                    Weekly
                  </SelectItem>
                  <SelectItem value="monthly" className="text-[#94A3B8]">
                    Monthly
                  </SelectItem>
                  <SelectItem value="manual" className="text-[#94A3B8]">
                    Manual Only
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-[#64748B]">
                Crawl schedule is stored as project-level schedule and controls automatic recrawls.
              </p>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => saveSettings.mutate()}
                disabled={saveSettings.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {saveSettings.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Webhook Configuration */}
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardHeader>
            <CardTitle className="text-[#F8FAFC] text-base flex items-center gap-2">
              <Link2 className="h-4 w-4 text-purple-400" />
              Webhook Configuration
            </CardTitle>
            <CardDescription className="text-[#64748B]">
              Send real-time notifications to your endpoint when events occur.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-[#94A3B8]">Enable Webhook</Label>
                <p className="text-xs text-[#64748B] mt-1">
                  Activate webhook notifications for this project
                </p>
              </div>
              <Switch
                checked={currentWebhookEnabled}
                onCheckedChange={setWebhookEnabled}
              />
            </div>

            <Separator className="bg-[#1E293B]" />

            <div className="space-y-2">
              <Label className="text-[#94A3B8]">Webhook URL</Label>
              <Input
                value={currentWebhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://your-server.com/webhook"
                disabled={!currentWebhookEnabled}
                className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] placeholder:text-[#64748B] disabled:opacity-50"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[#94A3B8]">Webhook Secret</Label>
              <div className="relative">
                <Input
                  type={showSecret ? "text" : "password"}
                  value={currentWebhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  disabled={!currentWebhookEnabled}
                  placeholder={hasStoredWebhookSecret && webhookSecret === undefined ? "Stored secret (enter to replace)" : ""}
                  className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] font-mono text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#94A3B8]"
                >
                  {showSecret ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-[#64748B]">
                Use this secret to verify webhook payloads
              </p>
            </div>

            <Separator className="bg-[#1E293B]" />

            <div className="space-y-3">
              <Label className="text-[#94A3B8]">Events</Label>
              {WEBHOOK_EVENTS.map((event) => (
                <div key={event.id} className="flex items-center gap-3">
                  <Checkbox
                    checked={currentWebhookEvents.includes(event.id)}
                    onCheckedChange={() => toggleWebhookEvent(event.id)}
                    disabled={!currentWebhookEnabled}
                  />
                  <Label className="text-[#94A3B8] text-sm font-normal cursor-pointer">
                    {event.label}
                    <span className="ml-2 text-xs text-[#64748B] font-mono">
                      {event.id}
                    </span>
                  </Label>
                </div>
              ))}
            </div>

            <Separator className="bg-[#1E293B]" />

            <div className="flex items-center gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => testWebhook.mutate()}
                disabled={!currentWebhookEnabled || !currentWebhookUrl || testWebhook.isPending}
                className="bg-transparent border-[#334155] text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B]"
              >
                {testWebhook.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Test Webhook
              </Button>
              <Button
                onClick={() => saveWebhook.mutate()}
                disabled={saveWebhook.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {saveWebhook.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="bg-[#111827] border-red-600/50">
          <CardHeader>
            <CardTitle className="text-red-400 text-base flex items-center gap-2">
              <Trash2 className="h-4 w-4" />
              Danger Zone
            </CardTitle>
            <CardDescription className="text-[#64748B]">
              Irreversible actions that permanently affect your project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#F8FAFC] font-medium">Delete Project</p>
                <p className="text-xs text-[#64748B] mt-1">
                  Permanently remove this project and all associated data including
                  crawl history, issues, and reports.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setDeleteDialogOpen(true)}
                className="bg-transparent border-red-600/50 text-red-400 hover:bg-red-600/10 hover:text-red-300"
              >
                Delete Project
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Project"
        description={`Are you sure you want to delete "${currentName}"? This action cannot be undone. All crawl data, issues, reports, and webhook configurations will be permanently removed.`}
        confirmLabel="Delete Project"
        destructive
        loading={deleteProject.isPending}
        onConfirm={() => deleteProject.mutate()}
      />
    </div>
  );
}
