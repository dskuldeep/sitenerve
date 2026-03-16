import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { signPayload } from "@/services/webhooks/signer";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { projectId } = await params;
  const body = await req.json().catch(() => ({}));

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });

  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  const requestUrl =
    typeof body?.url === "string"
      ? body.url.trim()
      : typeof body?.webhookUrl === "string"
        ? body.webhookUrl.trim()
        : "";
  const requestSecret =
    typeof body?.secret === "string"
      ? body.secret.trim()
      : typeof body?.webhookSecret === "string"
        ? body.webhookSecret.trim()
        : undefined;
  const requestTimeout =
    typeof body?.timeout === "number"
      ? body.timeout
      : typeof body?.webhookTimeout === "number"
        ? body.webhookTimeout
        : undefined;

  if (!project.webhookUrl) {
    // Allow testing with an unsaved URL from request payload.
    if (!requestUrl) {
      return NextResponse.json(
        { success: false, error: "No webhook URL configured" },
        { status: 400 }
      );
    }
  }

  const webhookUrl = requestUrl || project.webhookUrl!;
  const timeoutMs = (requestTimeout ?? project.webhookTimeout ?? 30) * 1000;

  try {
    const parsedUrl = new URL(webhookUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return NextResponse.json(
        { success: false, error: "Webhook URL must start with http:// or https://" },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json(
      { success: false, error: "Webhook URL must be a valid absolute URL" },
      { status: 400 }
    );
  }

  let signingSecret = "";
  if (requestSecret !== undefined) {
    signingSecret = requestSecret;
  } else if (project.webhookSecret) {
    try {
      signingSecret = decrypt(project.webhookSecret);
    } catch {
      // Backward-compatibility for plaintext legacy values.
      signingSecret = project.webhookSecret;
    }
  }

  const testPayload = {
    event: "test",
    projectId: project.id,
    projectName: project.name,
    siteUrl: project.siteUrl,
    timestamp: new Date().toISOString(),
    message: "This is a test webhook from SiteNerve",
  };

  const payloadStr = JSON.stringify(testPayload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (signingSecret) {
    headers["X-SiteNerve-Signature"] = signPayload(payloadStr, signingSecret);
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: payloadStr,
      signal: AbortSignal.timeout(timeoutMs),
    });

    await prisma.webhookDelivery.create({
      data: {
        projectId: project.id,
        event: "test",
        payload: testPayload,
        url: webhookUrl,
        statusCode: response.status,
        success: response.ok,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        statusCode: response.status,
        success: response.ok,
      },
    });
  } catch (error) {
    await prisma.webhookDelivery.create({
      data: {
        projectId: project.id,
        event: "test",
        payload: testPayload,
        url: webhookUrl,
        success: false,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
    });

    return NextResponse.json(
      { success: false, error: "Webhook delivery failed" },
      { status: 502 }
    );
  }
}
