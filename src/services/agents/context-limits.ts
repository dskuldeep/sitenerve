/**
 * Monolith prompt mode: caps inlined crawl context (used when AGENT_USE_TOOL_LOOP=false).
 * Tool mode: the agent fetches data via tools with the limits below.
 */
import type { CrawlDeltaQueryLimits } from "./crawl-delta";

export interface AgentContextLimits extends CrawlDeltaQueryLimits {
  maxPages: number;
  maxIssues: number;
  maxPreviousFindings: number;
}

/** Per-tool fetch caps and loop safety (tool-calling agent). */
export interface AgentToolLimits extends CrawlDeltaQueryLimits {
  listPagesMax: number;
  getPagesByUrlMax: number;
  listIssuesMax: number;
  crawlDeltaUrlPageMax: number;
  crawlDeltaIssuePageMax: number;
  maxToolResponseChars: number;
  maxAgentTurns: number;
  maxPreviousFindingsBootstrap: number;
}

function readPositiveInt(env: string | undefined, fallback: number): number {
  if (env === undefined || env === "") return fallback;
  const n = Number.parseInt(env, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getAgentContextLimits(): AgentContextLimits {
  return {
    maxPages: readPositiveInt(process.env.AGENT_PROMPT_MAX_PAGES, 400),
    maxIssues: readPositiveInt(process.env.AGENT_PROMPT_MAX_ISSUES, 600),
    maxDeltaNewUrls: readPositiveInt(process.env.AGENT_PROMPT_MAX_DELTA_NEW_URLS, 200),
    maxDeltaRemovedUrls: readPositiveInt(
      process.env.AGENT_PROMPT_MAX_DELTA_REMOVED_URLS,
      200
    ),
    maxDeltaChangedPages: readPositiveInt(
      process.env.AGENT_PROMPT_MAX_DELTA_CHANGED_PAGES,
      100
    ),
    maxDeltaIssueRowsPerBucket: readPositiveInt(
      process.env.AGENT_PROMPT_MAX_DELTA_ISSUE_ROWS,
      120
    ),
    maxPreviousFindings: readPositiveInt(
      process.env.AGENT_PROMPT_MAX_PREVIOUS_FINDINGS,
      80
    ),
  };
}

export function getAgentToolLimits(): AgentToolLimits {
  return {
    listPagesMax: readPositiveInt(process.env.AGENT_TOOL_LIST_PAGES_MAX, 400),
    getPagesByUrlMax: readPositiveInt(process.env.AGENT_TOOL_GET_PAGES_MAX, 80),
    listIssuesMax: readPositiveInt(process.env.AGENT_TOOL_LIST_ISSUES_MAX, 500),
    crawlDeltaUrlPageMax: readPositiveInt(process.env.AGENT_TOOL_CRAWL_DELTA_URL_PAGE_MAX, 250),
    crawlDeltaIssuePageMax: readPositiveInt(process.env.AGENT_TOOL_CRAWL_DELTA_ISSUE_PAGE_MAX, 250),
    maxToolResponseChars: readPositiveInt(process.env.AGENT_TOOL_MAX_RESPONSE_CHARS, 200_000),
    /** Model↔tool rounds (each round may include multiple parallel tool calls). */
    maxAgentTurns: readPositiveInt(process.env.AGENT_MAX_TURNS, 96),
    maxPreviousFindingsBootstrap: readPositiveInt(
      process.env.AGENT_BOOTSTRAP_MAX_PREVIOUS_FINDINGS,
      120
    ),
    maxDeltaNewUrls: readPositiveInt(process.env.AGENT_TOOL_DELTA_NEW_URLS_MAX, 2000),
    maxDeltaRemovedUrls: readPositiveInt(process.env.AGENT_TOOL_DELTA_REMOVED_URLS_MAX, 2000),
    maxDeltaChangedPages: readPositiveInt(process.env.AGENT_TOOL_DELTA_CHANGED_PAGES_MAX, 500),
    maxDeltaIssueRowsPerBucket: readPositiveInt(
      process.env.AGENT_TOOL_DELTA_ISSUE_ROWS_MAX,
      400
    ),
  };
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function isAgentToolLoopEnabled(): boolean {
  return process.env.AGENT_USE_TOOL_LOOP !== "false";
}
