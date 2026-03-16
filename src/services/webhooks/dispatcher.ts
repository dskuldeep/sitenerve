import { prisma } from "@/lib/prisma";
import { signPayload } from "./signer";
import { decrypt } from "@/lib/encryption";

interface WebhookDispatchOptions {
  projectId: string;
  event: string;
  payload: Record<string, unknown>;
}

interface DispatchResult {
  success: boolean;
  deliveryId: string;
  statusCode?: number;
  errorMessage?: string;
}

async function attemptDelivery(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ statusCode: number; responseBody: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const responseBody = await response.text().catch(() => "");

  return {
    statusCode: response.status,
    responseBody: responseBody.substring(0, 5000),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function dispatchWebhook(
  options: WebhookDispatchOptions
): Promise<DispatchResult> {
  const { projectId, event, payload } = options;

  // Load project webhook config
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      webhookUrl: true,
      webhookHeaders: true,
      webhookSecret: true,
      webhookRetries: true,
      webhookTimeout: true,
      webhookEvents: true,
    },
  });

  if (!project.webhookUrl) {
    throw new Error(`No webhook URL configured for project ${projectId}`);
  }

  // Check if this event type is enabled
  if (project.webhookEvents) {
    const enabledEvents = project.webhookEvents as string[];
    if (Array.isArray(enabledEvents) && !enabledEvents.includes(event)) {
      throw new Error(`Event "${event}" is not enabled for this project's webhook`);
    }
  }

  const url = project.webhookUrl;
  const maxAttempts = project.webhookRetries || 3;
  const timeoutMs = (project.webhookTimeout || 30) * 1000;

  // Build the request body
  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    projectId,
    data: payload,
  });

  // Build headers
  const customHeaders: Record<string, string> = {};

  // Parse custom headers from project config
  if (project.webhookHeaders && typeof project.webhookHeaders === "object") {
    const rawHeaders = project.webhookHeaders as Record<string, string>;
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (typeof key === "string" && typeof value === "string") {
        customHeaders[key] = value;
      }
    }
  }

  // Add signature header if a secret is configured
  if (project.webhookSecret) {
    const secret = decrypt(project.webhookSecret);
    const signature = signPayload(body, secret);
    customHeaders["X-SiteNerve-Signature"] = signature;
  }

  // Create the delivery record
  const delivery = await prisma.webhookDelivery.create({
    data: {
      projectId,
      event,
      payload: payload as any,
      url,
      attempt: 1,
      maxAttempts,
      success: false,
    },
  });

  // Attempt delivery with exponential backoff
  let lastError: string | undefined;
  let lastStatusCode: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await attemptDelivery(url, body, customHeaders, timeoutMs);
      lastStatusCode = result.statusCode;

      const success = result.statusCode >= 200 && result.statusCode < 300;

      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempt,
          statusCode: result.statusCode,
          responseBody: result.responseBody,
          success,
          deliveredAt: success ? new Date() : null,
          errorMessage: success
            ? null
            : `HTTP ${result.statusCode}: ${result.responseBody.substring(0, 500)}`,
        },
      });

      if (success) {
        return {
          success: true,
          deliveryId: delivery.id,
          statusCode: result.statusCode,
        };
      }

      lastError = `HTTP ${result.statusCode}`;
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : "Unknown delivery error";

      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempt,
          success: false,
          errorMessage: lastError,
        },
      });
    }

    // Exponential backoff before retry (1s, 4s, 16s, ...)
    if (attempt < maxAttempts) {
      const backoffMs = Math.pow(4, attempt - 1) * 1000;
      console.log(
        `[WebhookDispatcher] Attempt ${attempt} failed for ${url}, retrying in ${backoffMs}ms`
      );
      await delay(backoffMs);
    }
  }

  // All attempts exhausted
  console.error(
    `[WebhookDispatcher] All ${maxAttempts} attempts failed for ${url}: ${lastError}`
  );

  return {
    success: false,
    deliveryId: delivery.id,
    statusCode: lastStatusCode,
    errorMessage: lastError,
  };
}
