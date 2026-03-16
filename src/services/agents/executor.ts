import { prisma } from "@/lib/prisma";
import { createGeminiClient, generateContent } from "@/lib/gemini";
import { assemblePrompt, type ProjectContext } from "./prompt-assembler";
import { resolveSkills } from "./skill-resolver";
import { parseFindings } from "./finding-parser";
import type { IssueSeverity } from "@prisma/client";

async function sendAgentWebhookIfEnabled(options: {
  enabled: boolean;
  url: string | null;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!options.enabled || !options.url) return;

  try {
    await fetch(options.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SiteNerve-Event": "agent.findings",
      },
      body: JSON.stringify(options.payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error("[AgentExecutor] Failed to deliver agent webhook:", error);
  }
}

async function loadProjectContext(projectId: string): Promise<ProjectContext> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      id: true,
      siteUrl: true,
      totalPages: true,
      totalIssues: true,
      healthScore: true,
    },
  });

  const pages = await prisma.page.findMany({
    where: { projectId },
    select: {
      url: true,
      statusCode: true,
      title: true,
      metaDescription: true,
      h1: true,
      wordCount: true,
      responseTime: true,
      pageSize: true,
      canonicalUrl: true,
      metaRobots: true,
      jsonLd: true,
      internalLinks: true,
      externalLinks: true,
      images: true,
    },
    orderBy: { url: "asc" },
  });

  const issues = await prisma.issue.findMany({
    where: { projectId, status: "ACTIVE" },
    select: {
      ruleId: true,
      category: true,
      severity: true,
      title: true,
      description: true,
      affectedUrl: true,
      evidence: true,
    },
    orderBy: { severity: "desc" },
  });

  return {
    projectId: project.id,
    siteUrl: project.siteUrl,
    totalPages: project.totalPages,
    totalIssues: project.totalIssues,
    healthScore: project.healthScore,
    pages: pages.map((p) => ({
      url: p.url,
      statusCode: p.statusCode,
      title: p.title,
      metaDescription: p.metaDescription,
      h1: p.h1,
      wordCount: p.wordCount,
      responseTime: p.responseTime,
      pageSize: p.pageSize,
      canonicalUrl: p.canonicalUrl,
      metaRobots: p.metaRobots,
      jsonLd: p.jsonLd as unknown[] | null,
      internalLinks: p.internalLinks as Array<{ href: string; text: string }> | null,
      externalLinks: p.externalLinks as Array<{ href: string; text: string }> | null,
      images: p.images as Array<{
        src: string;
        alt: string;
        width?: number;
        height?: number;
      }> | null,
    })),
    issues: issues.map((i) => ({
      ruleId: i.ruleId,
      category: i.category,
      severity: i.severity,
      title: i.title,
      description: i.description,
      affectedUrl: i.affectedUrl,
      evidence: i.evidence as Record<string, unknown> | null,
    })),
  };
}

async function loadPreviousFindings(agentId: string): Promise<Array<{
  title: string;
  severity: string;
  type: string;
  status: string;
}>> {
  const lastRun = await prisma.agentRun.findFirst({
    where: { agentId, status: "SUCCESS" },
    orderBy: { createdAt: "desc" },
    select: {
      findings: {
        select: { title: true, severity: true, type: true },
      },
    },
  });

  if (!lastRun) return [];

  return lastRun.findings.map((f) => ({
    title: f.title,
    severity: f.severity,
    type: f.type,
    status: "previous",
  }));
}

export async function executeAgent(agentId: string): Promise<string> {
  // Load agent configuration
  const agent = await prisma.agent.findUniqueOrThrow({
    where: { id: agentId },
    include: {
      project: {
        include: {
          user: {
            select: {
              geminiApiKey: true,
              geminiModel: true,
              temperature: true,
            },
          },
        },
      },
    },
  });

  if (!agent.project.user.geminiApiKey) {
    throw new Error("User has no Gemini API key configured");
  }

  // Create the agent run record
  const run = await prisma.agentRun.create({
    data: {
      agentId: agent.id,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      lastRunStatus: "RUNNING",
    },
  });

  const startTime = Date.now();

  try {
    // Resolve skills from skills.sh
    const skillIds = (agent.skills as string[]) || [];
    const skills = await resolveSkills(skillIds);

    // Load project context
    const context = await loadProjectContext(agent.projectId);

    // Load previous run findings for delta analysis
    const previousFindings = await loadPreviousFindings(agent.id);

    // Assemble the full prompt
    const fullPrompt = assemblePrompt({
      prompt: agent.prompt,
      skills,
      context,
      previousFindings,
    });

    // Call Gemini API
    const model = agent.geminiModel || agent.project.user.geminiModel;
    const temperature = agent.project.user.temperature;
    const client = createGeminiClient(agent.project.user.geminiApiKey);

    const rawOutput = await generateContent(client, model, fullPrompt, temperature);

    // Parse findings from the response
    const findingsData = parseFindings(rawOutput);

    // Store findings in the database
    if (findingsData.length > 0) {
      await prisma.agentFinding.createMany({
        data: findingsData.map((f) => ({
          agentRunId: run.id,
          type: f.type,
          title: f.title,
          severity: f.severity as IssueSeverity,
          description: f.description,
          affectedUrls: f.affectedUrls,
          remediation: f.remediation || null,
          confidence: f.confidence ?? null,
          source: f.source || null,
        })),
      });
    }

    const duration = Date.now() - startTime;

    // Update the run as successful
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCESS",
        completedAt: new Date(),
        duration,
        modelUsed: model,
        rawOutput: rawOutput.substring(0, 50000), // Truncate for storage
      },
    });

    // Update the agent's last run info
    await prisma.agent.update({
      where: { id: agentId },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: "SUCCESS",
      },
    });

    await sendAgentWebhookIfEnabled({
      enabled: agent.webhookEnabled,
      url: agent.webhookUrl,
      payload: {
        event: "agent.findings",
        timestamp: new Date().toISOString(),
        projectId: agent.projectId,
        agentId: agent.id,
        agentName: agent.name,
        runId: run.id,
        status: "SUCCESS",
        modelUsed: model,
        durationMs: duration,
        findingCount: findingsData.length,
        findings: findingsData,
      },
    });

    console.log(
      `[AgentExecutor] Agent ${agent.name} completed: ${findingsData.length} findings in ${duration}ms`
    );

    return run.id;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Update run as failed
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        duration,
        errorMessage,
      },
    });

    // Update agent's last run info
    await prisma.agent.update({
      where: { id: agentId },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: "FAILED",
      },
    });

    console.error(
      `[AgentExecutor] Agent ${agent.name} failed after ${duration}ms:`,
      errorMessage
    );

    throw error;
  }
}
