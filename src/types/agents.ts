export interface Skill {
  id: string;
  name: string;
  author: string;
  description: string;
  installCount?: number;
  content?: string;
  isCustom?: boolean;
}

export interface AgentTriggerConfig {
  type: string;
  cron?: string;
  minSeverity?: string;
  minCount?: number;
}

export interface AgentContextConfig {
  includeProjectSummary: boolean;
  includePageData: boolean;
  includeExistingIssues: boolean;
  includePreviousFindings: boolean;
  includeLatestCrawlDelta: boolean;
}

export const DEFAULT_AGENT_CONTEXT_CONFIG: AgentContextConfig = {
  includeProjectSummary: true,
  includePageData: true,
  includeExistingIssues: true,
  includePreviousFindings: true,
  includeLatestCrawlDelta: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeAgentContextConfig(value: unknown): AgentContextConfig {
  const config = isRecord(value) ? value : {};

  return {
    includeProjectSummary: config.includeProjectSummary !== false,
    includePageData: config.includePageData !== false,
    includeExistingIssues: config.includeExistingIssues !== false,
    includePreviousFindings: config.includePreviousFindings !== false,
    includeLatestCrawlDelta: config.includeLatestCrawlDelta !== false,
  };
}

export function getAgentContextConfigFromTriggerConfig(
  triggerConfig: unknown
): AgentContextConfig {
  if (!isRecord(triggerConfig)) {
    return { ...DEFAULT_AGENT_CONTEXT_CONFIG };
  }

  return normalizeAgentContextConfig(triggerConfig.contextConfig);
}

export function mergeAgentTriggerConfig(input: {
  existingTriggerConfig: unknown;
  triggerType: string;
  scheduleCron?: string;
  contextConfig?: AgentContextConfig;
}): Record<string, unknown> {
  const nextTriggerConfig = isRecord(input.existingTriggerConfig)
    ? { ...input.existingTriggerConfig }
    : {};

  if (input.triggerType === "SCHEDULED") {
    nextTriggerConfig.cron = input.scheduleCron?.trim() || "";
  } else {
    delete nextTriggerConfig.cron;
    delete nextTriggerConfig.schedule;
  }

  nextTriggerConfig.contextConfig = normalizeAgentContextConfig(input.contextConfig);

  return nextTriggerConfig;
}

export interface AgentFindingData {
  type: "issue" | "recommendation" | "observation";
  title: string;
  severity: string;
  description: string;
  affectedUrls: string[];
  remediation?: string;
  confidence?: number;
  source?: string;
}

/** Persisted on AgentRun.toolTrace for tool-loop runs. */
export type AgentRunToolTraceStep =
  | {
      type: "function_calls";
      calls: Array<{ name: string; args: unknown }>;
    }
  | {
      type: "function_results";
      results: Array<{ name: string; response: unknown }>;
    }
  | { type: "submit_findings"; findingsCount: number }
  | { type: "model_text"; text: string };

export interface AgentRunToolTrace {
  version: 1;
  steps: AgentRunToolTraceStep[];
}

export function parseAgentRunToolTrace(value: unknown): AgentRunToolTrace | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.steps)) return null;
  return value as AgentRunToolTrace;
}
