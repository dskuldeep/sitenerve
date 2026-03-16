import { prisma } from "@/lib/prisma";
import type { NotificationType, IssueSeverity } from "@prisma/client";

interface NotificationInput {
  type: NotificationType;
  projectId?: string;
  userId?: string;
  title?: string;
  body?: string;
  severity?: IssueSeverity;
  metadata?: Record<string, unknown>;
  agentId?: string;
  runId?: string;
  crawlId?: string;
  issueId?: string;
  pageId?: string;
  pageUrl?: string;
  errorMessage?: string;
}

async function resolveProjectAndUser(
  input: NotificationInput
): Promise<{ userId: string; projectId: string; projectName: string; siteUrl: string }> {
  if (input.projectId) {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: input.projectId },
      select: { id: true, userId: true, name: true, siteUrl: true },
    });
    return {
      userId: input.userId || project.userId,
      projectId: project.id,
      projectName: project.name,
      siteUrl: project.siteUrl,
    };
  }

  if (input.agentId) {
    const agent = await prisma.agent.findUniqueOrThrow({
      where: { id: input.agentId },
      include: {
        project: { select: { id: true, userId: true, name: true, siteUrl: true } },
      },
    });
    return {
      userId: input.userId || agent.project.userId,
      projectId: agent.project.id,
      projectName: agent.project.name,
      siteUrl: agent.project.siteUrl,
    };
  }

  throw new Error("Cannot resolve project: no projectId or agentId provided");
}

export async function newPage(input: NotificationInput): Promise<void> {
  const { userId, projectId, projectName } = await resolveProjectAndUser(input);
  const pageUrl = input.pageUrl || "Unknown URL";

  await prisma.notification.create({
    data: {
      userId,
      projectId,
      type: "NEW_PAGE",
      severity: "INFO",
      title: `New page discovered on ${projectName}`,
      body: `A new page was found during crawl: ${pageUrl}`,
      metadata: { pageUrl, pageId: input.pageId, crawlId: input.crawlId },
    },
  });
}

export async function pageRemoved(input: NotificationInput): Promise<void> {
  const { userId, projectId, projectName } = await resolveProjectAndUser(input);
  const pageUrl = input.pageUrl || "Unknown URL";

  await prisma.notification.create({
    data: {
      userId,
      projectId,
      type: "PAGE_REMOVED",
      severity: "MEDIUM",
      title: `Page removed from ${projectName}`,
      body: `A previously crawled page is no longer accessible: ${pageUrl}`,
      metadata: { pageUrl, pageId: input.pageId, crawlId: input.crawlId },
    },
  });
}

export async function newIssue(input: NotificationInput): Promise<void> {
  const { userId, projectId, projectName } = await resolveProjectAndUser(input);
  const issueSeverity = input.severity || "MEDIUM";

  let issueTitle = "New issue detected";
  let issueBody = `A new ${issueSeverity} severity issue was detected on ${projectName}.`;

  if (input.issueId) {
    const issue = await prisma.issue.findUnique({
      where: { id: input.issueId },
      select: { title: true, severity: true, affectedUrl: true, category: true },
    });
    if (issue) {
      issueTitle = `New ${issue.severity} issue: ${issue.title}`;
      issueBody = `${issue.title} was detected on ${issue.affectedUrl} (category: ${issue.category}).`;
    }
  }

  await prisma.notification.create({
    data: {
      userId,
      projectId,
      type: "NEW_ISSUE",
      severity: issueSeverity,
      title: issueTitle,
      body: issueBody,
      metadata: { issueId: input.issueId, pageUrl: input.pageUrl },
    },
  });
}

export async function issueResolved(input: NotificationInput): Promise<void> {
  const { userId, projectId, projectName } = await resolveProjectAndUser(input);

  let title = `Issue resolved on ${projectName}`;
  let body = "An issue has been automatically resolved.";

  if (input.issueId) {
    const issue = await prisma.issue.findUnique({
      where: { id: input.issueId },
      select: { title: true, affectedUrl: true },
    });
    if (issue) {
      title = `Issue resolved: ${issue.title}`;
      body = `The issue "${issue.title}" on ${issue.affectedUrl} has been resolved.`;
    }
  }

  await prisma.notification.create({
    data: {
      userId,
      projectId,
      type: "ISSUE_RESOLVED",
      severity: "INFO",
      title,
      body,
      metadata: { issueId: input.issueId },
    },
  });
}

export async function agentFinding(input: NotificationInput): Promise<void> {
  const { userId, projectId, projectName } = await resolveProjectAndUser(input);

  let title = `Agent completed analysis on ${projectName}`;
  let body = "An AI agent has completed its analysis.";
  let severity: IssueSeverity = "INFO";
  let findingCount = 0;

  if (input.runId) {
    const run = await prisma.agentRun.findUnique({
      where: { id: input.runId },
      include: {
        agent: { select: { name: true } },
        findings: { select: { severity: true } },
      },
    });

    if (run) {
      findingCount = run.findings.length;
      const agentName = run.agent.name;

      // Determine highest severity among findings
      const severityOrder: IssueSeverity[] = [
        "INFO",
        "LOW",
        "MEDIUM",
        "HIGH",
        "CRITICAL",
      ];
      let maxSeverityIdx = 0;
      for (const f of run.findings) {
        const idx = severityOrder.indexOf(f.severity);
        if (idx > maxSeverityIdx) maxSeverityIdx = idx;
      }
      severity = severityOrder[maxSeverityIdx];

      title = `${agentName} found ${findingCount} finding${findingCount === 1 ? "" : "s"} on ${projectName}`;
      body =
        findingCount > 0
          ? `The "${agentName}" agent completed and reported ${findingCount} finding${findingCount === 1 ? "" : "s"} (highest severity: ${severity}).`
          : `The "${agentName}" agent completed with no findings.`;
    }
  }

  await prisma.notification.create({
    data: {
      userId,
      projectId,
      type: "AGENT_FINDING",
      severity,
      title,
      body,
      metadata: {
        agentId: input.agentId,
        runId: input.runId,
        findingCount,
      },
    },
  });
}

export async function crawlCompleted(input: NotificationInput): Promise<void> {
  const { userId, projectId, projectName } = await resolveProjectAndUser(input);

  let body = `Crawl completed for ${projectName}.`;

  if (input.crawlId) {
    const crawl = await prisma.crawl.findUnique({
      where: { id: input.crawlId },
      select: { totalPages: true, newPages: true, removedPages: true, changedPages: true },
    });
    if (crawl) {
      body =
        `Crawl completed for ${projectName}: ` +
        `${crawl.totalPages} pages crawled, ` +
        `${crawl.newPages} new, ` +
        `${crawl.removedPages} removed, ` +
        `${crawl.changedPages} changed.`;
    }
  }

  await prisma.notification.create({
    data: {
      userId,
      projectId,
      type: "CRAWL_COMPLETED",
      severity: "INFO",
      title: `Crawl completed for ${projectName}`,
      body,
      metadata: { crawlId: input.crawlId },
    },
  });
}

export async function crawlFailed(input: NotificationInput): Promise<void> {
  const { userId, projectId, projectName } = await resolveProjectAndUser(input);
  const errorMessage = input.errorMessage || "Unknown error";

  await prisma.notification.create({
    data: {
      userId,
      projectId,
      type: "CRAWL_FAILED",
      severity: "HIGH",
      title: `Crawl failed for ${projectName}`,
      body: `The scheduled crawl for ${projectName} failed: ${errorMessage}`,
      metadata: { crawlId: input.crawlId, errorMessage },
    },
  });
}

export async function webhookFailed(input: NotificationInput): Promise<void> {
  const { userId, projectId, projectName } = await resolveProjectAndUser(input);
  const errorMessage = input.errorMessage || "Delivery failed after all retries";

  await prisma.notification.create({
    data: {
      userId,
      projectId,
      type: "WEBHOOK_FAILED",
      severity: "MEDIUM",
      title: `Webhook delivery failed for ${projectName}`,
      body: `A webhook delivery to your configured endpoint failed: ${errorMessage}`,
      metadata: { errorMessage, ...input.metadata },
    },
  });
}

const handlers: Record<string, (input: NotificationInput) => Promise<void>> = {
  NEW_PAGE: newPage,
  PAGE_REMOVED: pageRemoved,
  NEW_ISSUE: newIssue,
  ISSUE_RESOLVED: issueResolved,
  AGENT_FINDING: agentFinding,
  CRAWL_COMPLETED: crawlCompleted,
  CRAWL_FAILED: crawlFailed,
  WEBHOOK_FAILED: webhookFailed,
};

export async function generateNotification(input: NotificationInput): Promise<void> {
  const handler = handlers[input.type];
  if (!handler) {
    console.warn(
      `[NotificationGenerator] Unknown notification type: ${input.type}`
    );
    return;
  }

  await handler(input);
}
