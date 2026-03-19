import { GoogleGenerativeAI } from "@google/generative-ai";
import { decrypt } from "./encryption";

const GEMINI_LIST_MODELS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiListModelsResponse {
  models?: Array<{
    name?: string;
    displayName?: string;
    description?: string;
    supportedGenerationMethods?: string[];
    inputTokenLimit?: number;
    outputTokenLimit?: number;
  }>;
  error?: {
    message?: string;
  };
}

export interface GeminiModelOption {
  id: string;
  name: string;
  description: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
}

export async function listGeminiModels(
  apiKey: string
): Promise<GeminiModelOption[]> {
  const response = await fetch(`${GEMINI_LIST_MODELS_ENDPOINT}?key=${apiKey}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  const payload = (await response.json()) as GeminiListModelsResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || "Failed to fetch Gemini models");
  }

  const models = (payload.models || [])
    .filter((model) =>
      model.supportedGenerationMethods?.some(
        (method) => method === "generateContent" || method === "streamGenerateContent"
      )
    )
    .map((model) => {
      const fullName = model.name || "";
      const id = fullName.startsWith("models/") ? fullName.slice(7) : fullName;

      return {
        id,
        name: model.displayName || id,
        description: model.description || "Gemini model",
        inputTokenLimit: model.inputTokenLimit ?? null,
        outputTokenLimit: model.outputTokenLimit ?? null,
      };
    })
    .filter((model) => model.id.startsWith("gemini-"));

  models.sort((a, b) => a.id.localeCompare(b.id));

  return models;
}

export function createGeminiClient(encryptedApiKey: string): GoogleGenerativeAI {
  const apiKey = decrypt(encryptedApiKey);
  return new GoogleGenerativeAI(apiKey);
}

export async function generateContent(
  client: GoogleGenerativeAI,
  model: string,
  prompt: string,
  temperature: number = 0.2
): Promise<string> {
  const genModel = client.getGenerativeModel({
    model,
    generationConfig: { 
      temperature,
      responseMimeType: "application/json"
    },
  });

  try {
    const result = await genModel.generateContent(prompt);
    const response = result.response;
    const feedback = response.promptFeedback;
    if (feedback?.blockReason) {
      const msg = feedback.blockReasonMessage
        ? `${feedback.blockReason}: ${feedback.blockReasonMessage}`
        : String(feedback.blockReason);
      throw new Error(`Gemini blocked the request (${msg})`);
    }
    return response.text();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("Gemini blocked") ||
        error.message.startsWith("Gemini request failed"))
    ) {
      throw error;
    }
    const fromApi =
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : null;
    throw new Error(
      fromApi ? `Gemini request failed: ${fromApi}` : "Gemini request failed"
    );
  }
}

export async function verifyApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const models = await listGeminiModels(apiKey);
    if (models.length === 0) {
      return { valid: false, error: "No supported Gemini models available for this key" };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid API key",
    };
  }
}
