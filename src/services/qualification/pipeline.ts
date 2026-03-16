import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { createGeminiClient, generateContent } from "@/lib/gemini";
import { qualificationPrompt } from "./prompts";

interface QualificationOutput {
  healthScore: number;
  healthScoreDelta: number;
  executiveSummary: string;
  dimensions: Array<{
    name: string;
    score: number;
    findings: string[];
  }>;
  topPriorities: Array<{
    title: string;
    impact: string;
    effort: string;
    description: string;
  }>;
  trends: {
    improving: string[];
    declining: string[];
    stable: string[];
  };
}

function parseQualificationOutput(raw: string): QualificationOutput {
  // Try direct parse
  try {
    return JSON.parse(raw);
  } catch {
    // Try extracting from markdown code block
  }

  const patterns = [
    /```json\s*\n?([\s\S]*?)\n?\s*```/,
    /```\s*\n?([\s\S]*?)\n?\s*```/,
    /(\{[\s\S]*\})/,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1].trim());
      } catch {
        continue;
      }
    }
  }

  throw new Error("Failed to parse qualification output as JSON");
}

export async function runQualification(projectId: string): Promise<string> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      user: {
        select: {
          geminiApiKey: true,
          geminiModel: true,
          temperature: true,
        },
      },
    },
  });

  if (!project.user.geminiApiKey) {
    throw new Error("User has no Gemini API key configured");
  }

  // Create the qualification run record
  const qualRun = await prisma.qualificationRun.create({
    data: {
      projectId,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  try {
    // Collect audit results
    const issues = await prisma.issue.findMany({
      where: { projectId, status: "ACTIVE" },
      select: {
        ruleId: true,
        category: true,
        severity: true,
        title: true,
        affectedUrl: true,
      },
      orderBy: { severity: "desc" },
      take: 300,
    });

    // Collect recent agent findings
    const recentAgentRuns = await prisma.agentRun.findMany({
      where: {
        agent: { projectId },
        status: "SUCCESS",
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        agent: { select: { name: true } },
        findings: {
          select: {
            type: true,
            title: true,
            severity: true,
            description: true,
            confidence: true,
          },
        },
      },
    });

    const agentRunIds = recentAgentRuns.map((r) => r.id);

    const agentFindings = recentAgentRuns.flatMap((run) =>
      run.findings.map((f) => ({
        agentName: run.agent.name,
        type: f.type,
        title: f.title,
        severity: f.severity,
        description: f.description.substring(0, 300),
        confidence: f.confidence,
      }))
    );

    // Get previous qualification for delta calculation
    const previousQual = await prisma.qualificationRun.findFirst({
      where: {
        projectId,
        status: "COMPLETED",
        id: { not: qualRun.id },
      },
      orderBy: { createdAt: "desc" },
      select: { healthScore: true },
    });

    const previousScore = previousQual?.healthScore ?? project.healthScore;

    // Get latest crawl info
    const latestCrawl = await prisma.crawl.findFirst({
      where: { projectId, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        totalPages: true,
        newPages: true,
        removedPages: true,
        completedAt: true,
      },
    });

    // Collect project stats
    const issueSummary: Record<string, number> = {};
    for (const issue of issues) {
      const key = `${issue.category}:${issue.severity}`;
      issueSummary[key] = (issueSummary[key] || 0) + 1;
    }

    // Build the full prompt
    const contextPrompt = [
      qualificationPrompt,
      "",
      "---",
      "",
      "## Project Information",
      `- Site URL: ${project.siteUrl}`,
      `- Project Name: ${project.name}`,
      `- Current Health Score: ${project.healthScore}`,
      `- Previous Qualification Score: ${previousScore}`,
      `- Total Pages: ${project.totalPages}`,
      `- Total Active Issues: ${project.totalIssues}`,
      latestCrawl
        ? `- Last Crawl: ${latestCrawl.completedAt?.toISOString()} (${latestCrawl.totalPages} pages, ${latestCrawl.newPages} new, ${latestCrawl.removedPages} removed)`
        : "- Last Crawl: None",
      "",
      "## Issue Summary by Category and Severity",
      "```json",
      JSON.stringify(issueSummary, null, 2),
      "```",
      "",
      `## Active Issues (${issues.length} shown)`,
      "```json",
      JSON.stringify(issues.slice(0, 150), null, 2),
      "```",
      "",
      `## AI Agent Findings (${agentFindings.length} from ${recentAgentRuns.length} recent runs)`,
      "```json",
      JSON.stringify(agentFindings.slice(0, 100), null, 2),
      "```",
    ].join("\n");

    // Call Gemini
    const client = createGeminiClient(project.user.geminiApiKey);
    const model = project.user.geminiModel;
    const rawOutput = await generateContent(client, model, contextPrompt, 0.3);

    // Parse the response
    const output = parseQualificationOutput(rawOutput);

    // Update the qualification run
    await prisma.qualificationRun.update({
      where: { id: qualRun.id },
      data: {
        status: "COMPLETED",
        output: output as unknown as Prisma.InputJsonValue,
        executiveSummary: output.executiveSummary,
        healthScore: output.healthScore,
        healthScoreDelta: output.healthScore - previousScore,
        modelUsed: model,
        agentRunIds,
        crawlId: latestCrawl?.id || null,
        completedAt: new Date(),
      },
    });

    console.log(
      `[Qualification] Completed for ${project.name}: qualification score ${output.healthScore} (delta: ${output.healthScore - previousScore})`
    );

    return qualRun.id;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    await prisma.qualificationRun.update({
      where: { id: qualRun.id },
      data: {
        status: "FAILED",
        errorMessage,
        completedAt: new Date(),
      },
    });

    console.error(`[Qualification] Failed for project ${projectId}:`, errorMessage);
    throw error;
  }
}
