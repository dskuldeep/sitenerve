"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Key, Eye, EyeOff, Check, X, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";

interface GeminiModelOption {
  id: string;
  name: string;
  description: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
}

interface AiSettings {
  hasApiKey: boolean;
  model: string;
  temperature: number;
}

export default function AIConfigurationPage() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gemini-2.5-flash");
  const [temperature, setTemperature] = useState(0.2);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [hasSavedApiKey, setHasSavedApiKey] = useState(false);
  const [models, setModels] = useState<GeminiModelOption[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const settingsQuery = useQuery<AiSettings>({
    queryKey: ["ai-settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings/ai");
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to load AI settings");
      }
      return json.data as AiSettings;
    },
  });

  useEffect(() => {
    if (!settingsQuery.data || hydrated) {
      return;
    }

    setSelectedModel(settingsQuery.data.model || "gemini-2.5-flash");
    setTemperature(settingsQuery.data.temperature ?? 0.2);
    setHasSavedApiKey(settingsQuery.data.hasApiKey);
    setHydrated(true);
  }, [settingsQuery.data, hydrated]);

  const fetchModels = useMutation({
    mutationFn: async (apiKeyOverride?: string) => {
      const hasOverride = Boolean(apiKeyOverride?.trim());
      const res = await fetch("/api/models", {
        method: hasOverride ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        body: hasOverride ? JSON.stringify({ apiKey: apiKeyOverride?.trim() }) : undefined,
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to fetch models");
      }
      return json.data as GeminiModelOption[];
    },
    onSuccess: (availableModels) => {
      setModels(availableModels);
    },
  });

  useEffect(() => {
    if (!hydrated || !hasSavedApiKey) {
      return;
    }

    fetchModels.mutate(undefined);
    // We only want to auto-load once after hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, hasSavedApiKey]);

  const verifyKey = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/verify-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Invalid API key");
      }
    },
    onSuccess: () => {
      setKeyValid(true);
      toast.success("API key verified successfully");
      fetchModels.mutate(apiKey.trim());
    },
    onError: () => {
      setKeyValid(false);
      toast.error("Invalid API key");
    },
  });

  const saveSettings = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim() || undefined,
          model: selectedModel,
          temperature,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to save AI settings");
      }
    },
    onSuccess: async () => {
      setApiKey("");
      setKeyValid(null);
      setHasSavedApiKey(true);
      await queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
      toast.success("AI settings saved");
      fetchModels.mutate(undefined);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const isLoadingInitialState = settingsQuery.isLoading && !hydrated;
  const displayModels = useMemo(() => {
    if (!selectedModel || models.some((model) => model.id === selectedModel)) {
      return models;
    }

    return [
      ...models,
      {
        id: selectedModel,
        name: selectedModel,
        description: "Currently selected model",
        inputTokenLimit: null,
        outputTokenLimit: null,
      },
    ];
  }, [models, selectedModel]);

  const canRefreshModels = Boolean(apiKey.trim()) || hasSavedApiKey;

  if (isLoadingInitialState) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[#64748B]" />
      </div>
    );
  }

  if (settingsQuery.isError && !hydrated) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-sm text-red-400">
          {settingsQuery.error instanceof Error ? settingsQuery.error.message : "Failed to load AI settings"}
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="AI Configuration" description="Configure your Gemini API key and model preferences" />

      <div className="space-y-6 max-w-2xl">
        <Card className="bg-[#111827] border-[#1E293B]">
          <CardHeader>
            <CardTitle className="text-[#F8FAFC] text-base flex items-center gap-2">
              <Key className="h-4 w-4 text-blue-400" />
              Gemini API Key
            </CardTitle>
            <CardDescription className="text-[#64748B]">
              Stored at profile level and encrypted at rest. Only server-side routes use the key.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setKeyValid(null);
                  }}
                  placeholder={hasSavedApiKey ? "Saved key exists. Enter a new key to replace it." : "Enter your Gemini API key"}
                  className="bg-[#1E293B] border-[#334155] text-[#F8FAFC] font-mono text-sm placeholder:text-[#64748B] pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#94A3B8]"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                variant="outline"
                onClick={() => verifyKey.mutate()}
                disabled={!apiKey.trim() || verifyKey.isPending}
                className="bg-transparent border-[#334155] text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B]"
              >
                {verifyKey.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : keyValid === true ? (
                  <Check className="h-4 w-4 text-green-400" />
                ) : keyValid === false ? (
                  <X className="h-4 w-4 text-red-400" />
                ) : (
                  "Verify"
                )}
              </Button>
            </div>
            {hasSavedApiKey && keyValid !== false && (
              <p className="text-xs text-[#94A3B8]">A profile-level key is already configured.</p>
            )}
            {keyValid === true && (
              <p className="text-xs text-green-400">API key is valid and model access was confirmed</p>
            )}
            {keyValid === false && (
              <p className="text-xs text-red-400">API key is invalid or doesn&apos;t have model access</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-[#111827] border-[#1E293B]">
          <CardHeader>
            <CardTitle className="text-[#F8FAFC] text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-cyan-400" />
                Default Model
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchModels.mutate(apiKey.trim() || undefined)}
                disabled={!canRefreshModels || fetchModels.isPending}
                className="h-7 px-2 text-xs text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#1E293B]"
              >
                {fetchModels.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Refresh models
              </Button>
            </CardTitle>
            <CardDescription className="text-[#64748B]">
              Models are loaded in real time from Google using your profile key.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select
              value={selectedModel}
              onValueChange={(value) => {
                if (!value) return;
                setSelectedModel(value);
              }}
            >
              <SelectTrigger className="bg-[#1E293B] border-[#334155] text-[#F8FAFC]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1E293B] border-[#334155]">
                {displayModels.map((model) => (
                  <SelectItem key={model.id} value={model.id} className="text-[#94A3B8]">
                    <div className="flex flex-col">
                      <span className="text-sm text-[#F8FAFC]">{model.name}</span>
                      <span className="text-[10px] text-[#64748B]">{model.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!canRefreshModels && (
              <p className="text-xs text-amber-400">Add or verify a Gemini API key to load available models.</p>
            )}
            {fetchModels.isError && (
              <p className="text-xs text-red-400">
                {fetchModels.error instanceof Error ? fetchModels.error.message : "Unable to load models"}
              </p>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[#94A3B8]">Temperature</Label>
                <span className="text-xs font-mono text-[#64748B]">{temperature.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-[#475569]">
                <span>Deterministic</span>
                <span>Creative</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Button
          onClick={() => saveSettings.mutate()}
          disabled={saveSettings.isPending}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          {saveSettings.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
}
