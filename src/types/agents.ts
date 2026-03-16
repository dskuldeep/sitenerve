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
