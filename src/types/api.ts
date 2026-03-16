export interface CreateProjectInput {
  name?: string;
  siteUrl: string;
  sitemapUrl?: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  crawlSchedule?: string;
  webhookUrl?: string;
  webhookHeaders?: Record<string, string>;
  webhookSecret?: string;
  webhookRetries?: number;
  webhookTimeout?: number;
  webhookEvents?: string[];
  status?: "ACTIVE" | "PAUSED";
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  prompt: string;
  seedPrompt: string;
  triggerType: string;
  triggerConfig?: Record<string, unknown>;
  skills?: string[];
  geminiModel?: string;
  webhookEnabled?: boolean;
  webhookUrl?: string;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  prompt?: string;
  triggerType?: string;
  triggerConfig?: Record<string, unknown>;
  skills?: string[];
  geminiModel?: string;
  webhookEnabled?: boolean;
  webhookUrl?: string;
  isActive?: boolean;
}

export interface WhitelistInput {
  scope: "SINGLE" | "RULE" | "URL_PATTERN";
  issueId?: string;
  ruleId?: string;
  urlPattern?: string;
  reason: string;
  expiresAt?: string;
}

export interface WebhookConfigInput {
  webhookUrl: string;
  webhookHeaders?: Record<string, string>;
  webhookSecret?: string;
  webhookRetries?: number;
  webhookTimeout?: number;
  webhookEvents?: string[];
}
