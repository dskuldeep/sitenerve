interface IssueForScoring {
  severity: string;
  isWhitelisted: boolean;
  ruleId: string;
  affectedUrl: string;
}

const TYPE_DEDUCTION_WEIGHT: Record<string, number> = {
  CRITICAL: 12,
  HIGH: 8,
  MEDIUM: 4,
  LOW: 1.5,
  INFO: 0.4,
};

export function calculateHealthScore(
  issues: IssueForScoring[],
  totalPages: number
): number {
  if (totalPages === 0) return 100;

  const activeIssues = issues.filter((i) => !i.isWhitelisted);
  if (activeIssues.length === 0) return 100;

  const groupedByRule = new Map<string, { severity: string; urls: Set<string> }>();
  for (const issue of activeIssues) {
    const key = issue.ruleId || "__unknown_rule__";
    const entry = groupedByRule.get(key) || { severity: issue.severity, urls: new Set<string>() };
    entry.urls.add(issue.affectedUrl || `${key}:${entry.urls.size}`);
    groupedByRule.set(key, entry);
  }

  let totalPenalty = 0;
  const normalizedPageCount = Math.max(totalPages, 1);
  for (const groupedIssue of groupedByRule.values()) {
    const base = TYPE_DEDUCTION_WEIGHT[groupedIssue.severity] ?? TYPE_DEDUCTION_WEIGHT.MEDIUM;
    const affectedRatio = Math.min(1, groupedIssue.urls.size / normalizedPageCount);
    totalPenalty += base * affectedRatio;
  }

  const score = 100 - totalPenalty;
  const rounded = Math.max(0, Math.min(100, Math.round(score * 10) / 10));
  if (activeIssues.length > 0 && rounded >= 100) {
    return 99.9;
  }
  return rounded;
}
