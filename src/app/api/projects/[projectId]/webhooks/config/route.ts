import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";

function parseEvents(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { projectId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: {
      webhookUrl: true,
      webhookHeaders: true,
      webhookSecret: true,
      webhookRetries: true,
      webhookTimeout: true,
      webhookEvents: true,
    },
  });

  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: {
      enabled: Boolean(project.webhookUrl),
      url: project.webhookUrl || "",
      secret: "",
      hasSecret: Boolean(project.webhookSecret),
      events: parseEvents(project.webhookEvents),
      retries: project.webhookRetries,
      timeout: project.webhookTimeout,
      headers:
        project.webhookHeaders && typeof project.webhookHeaders === "object"
          ? project.webhookHeaders
          : {},
    },
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { projectId } = await params;
  const body = await req.json();

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });

  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
  const urlInput =
    typeof body.url === "string"
      ? body.url.trim()
      : typeof body.webhookUrl === "string"
        ? body.webhookUrl.trim()
        : "";
  const events = parseEvents(body.events ?? body.webhookEvents);
  const timeout =
    typeof body.timeout === "number"
      ? body.timeout
      : typeof body.webhookTimeout === "number"
        ? body.webhookTimeout
        : project.webhookTimeout;
  const retries =
    typeof body.retries === "number"
      ? body.retries
      : typeof body.webhookRetries === "number"
        ? body.webhookRetries
        : project.webhookRetries;
  const incomingSecret =
    typeof body.secret === "string"
      ? body.secret.trim()
      : typeof body.webhookSecret === "string"
        ? body.webhookSecret.trim()
        : undefined;

  if (enabled && !urlInput) {
    return NextResponse.json(
      { success: false, error: "Webhook URL is required when webhook is enabled" },
      { status: 400 }
    );
  }

  if (enabled && urlInput) {
    try {
      const parsed = new URL(urlInput);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
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
  }

  const secretToStore =
    incomingSecret === undefined
      ? project.webhookSecret
      : incomingSecret.length > 0
        ? encrypt(incomingSecret)
        : null;

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      webhookUrl: enabled ? urlInput : null,
      webhookHeaders:
        body.headers && typeof body.headers === "object"
          ? body.headers
          : body.webhookHeaders && typeof body.webhookHeaders === "object"
            ? body.webhookHeaders
            : project.webhookHeaders,
      webhookSecret: secretToStore,
      webhookRetries: Math.max(1, Math.min(10, Number(retries) || 3)),
      webhookTimeout: Math.max(5, Math.min(120, Number(timeout) || 30)),
      webhookEvents: events,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      enabled: Boolean(updated.webhookUrl),
      url: updated.webhookUrl || "",
      secret: "",
      hasSecret: Boolean(updated.webhookSecret),
      events: parseEvents(updated.webhookEvents),
      retries: updated.webhookRetries,
      timeout: updated.webhookTimeout,
      headers:
        updated.webhookHeaders && typeof updated.webhookHeaders === "object"
          ? updated.webhookHeaders
          : {},
    },
  });
}
