import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { createGeminiClient, generateContent } from "@/lib/gemini";
import { parseFindings, parseFindingsFromRawArray } from "./finding-parser";
import type { IssueSeverity } from "@prisma/client";
import { runAgenticGeminiLoop } from "./agent-tools";
import { resolveAgentRuntime, type AgentRuntimeOverrides } from "./runtime";

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

export async function executeAgent(
  agentId: string,
  overrides: AgentRuntimeOverrides = {}
): Promise<string> {
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
    const runtime = await resolveAgentRuntime(agentId, overrides);
    const fullPrompt = runtime.fullPrompt;

    const model = runtime.model;
    const temperature = runtime.temperature;
    const client = createGeminiClient(agent.project.user.geminiApiKey);

    let rawOutput: string;
    let findingsData;

    let toolTraceForDb: Prisma.InputJsonValue | undefined;

    if (runtime.toolLoopEnabled) {
      const loop = await runAgenticGeminiLoop({
        client,
        model,
        temperature,
        bootstrapUserMessage: fullPrompt,
        projectId: agent.projectId,
        toolLimits: runtime.toolLimits,
        contextConfig: runtime.contextConfig,
      });
      rawOutput = loop.transcript.slice(0, 50_000);
      toolTraceForDb = loop.toolTrace as unknown as Prisma.InputJsonValue;
      findingsData = parseFindingsFromRawArray(loop.rawFindings);
      if (findingsData.length === 0 && loop.fallbackText?.trim()) {
        findingsData = parseFindings(loop.fallbackText);
      }
    } else {
      rawOutput = await generateContent(client, model, fullPrompt, temperature);
      findingsData = parseFindings(rawOutput);
    }

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
        ...(toolTraceForDb !== undefined ? { toolTrace: toolTraceForDb } : {}),
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
