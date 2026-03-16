import type { AgentFindingData } from "@/types/agents";

const VALID_TYPES = new Set(["issue", "recommendation", "observation"]);
const VALID_SEVERITIES = new Set(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);

function validateFinding(raw: unknown): AgentFindingData | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  // Validate required fields
  if (typeof obj.title !== "string" || !obj.title.trim()) {
    return null;
  }

  if (typeof obj.description !== "string" || !obj.description.trim()) {
    return null;
  }

  // Normalize type
  const type = typeof obj.type === "string" ? obj.type.toLowerCase() : "observation";
  if (!VALID_TYPES.has(type)) {
    return null;
  }

  // Normalize severity
  const severity =
    typeof obj.severity === "string" ? obj.severity.toUpperCase() : "MEDIUM";
  if (!VALID_SEVERITIES.has(severity)) {
    return null;
  }

  // Normalize affectedUrls
  let affectedUrls: string[] = [];
  if (Array.isArray(obj.affectedUrls)) {
    affectedUrls = obj.affectedUrls.filter(
      (u): u is string => typeof u === "string" && u.trim().length > 0
    );
  } else if (typeof obj.affectedUrls === "string") {
    affectedUrls = [obj.affectedUrls];
  }

  // Normalize optional fields
  const remediation =
    typeof obj.remediation === "string" ? obj.remediation : undefined;
  const confidence =
    typeof obj.confidence === "number" &&
    obj.confidence >= 0 &&
    obj.confidence <= 1
      ? obj.confidence
      : undefined;
  const source =
    typeof obj.source === "string" ? obj.source : undefined;

  return {
    type: type as AgentFindingData["type"],
    title: obj.title.trim(),
    severity,
    description: obj.description.trim(),
    affectedUrls,
    remediation,
    confidence,
    source,
  };
}

function extractJsonArray(text: string): unknown[] | null {
  // Try parsing the whole string as JSON
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    // If it's a single object, wrap it
    if (typeof parsed === "object" && parsed !== null) {
      return [parsed];
    }
  } catch {
    // Not valid JSON as-is, try to extract
  }

  // Try to find a JSON array in the text (common with markdown code blocks)
  const patterns = [
    /```json\s*\n?([\s\S]*?)\n?\s*```/,
    /```\s*\n?([\s\S]*?)\n?\s*```/,
    /(\[[\s\S]*\])/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (Array.isArray(parsed)) {
          return parsed;
        }
        if (typeof parsed === "object" && parsed !== null) {
          return [parsed];
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

export function parseFindings(output: string): AgentFindingData[] {
  if (!output || !output.trim()) {
    console.warn("[FindingParser] Empty output received");
    return [];
  }

  const rawArray = extractJsonArray(output);

  if (!rawArray) {
    console.error(
      "[FindingParser] Could not extract JSON array from output:",
      output.substring(0, 500)
    );
    return [];
  }

  const findings: AgentFindingData[] = [];

  for (let i = 0; i < rawArray.length; i++) {
    const validated = validateFinding(rawArray[i]);
    if (validated) {
      findings.push(validated);
    } else {
      console.warn(
        `[FindingParser] Skipping invalid finding at index ${i}:`,
        JSON.stringify(rawArray[i]).substring(0, 200)
      );
    }
  }

  return findings;
}
