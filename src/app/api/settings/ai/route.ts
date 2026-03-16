import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/encryption";
import { z } from "zod";

const updateAiSettingsSchema = z.object({
  apiKey: z.string().trim().min(1).max(4096).nullable().optional(),
  model: z.string().trim().min(1).max(200).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      geminiApiKey: true,
      geminiModel: true,
      temperature: true,
    },
  });

  if (!user) {
    return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: {
      hasApiKey: Boolean(user.geminiApiKey),
      model: user.geminiModel,
      temperature: user.temperature,
    },
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = updateAiSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { apiKey, model, temperature } = parsed.data;

  const data: Record<string, unknown> = {};

  if (apiKey !== undefined) {
    data.geminiApiKey = apiKey === null ? null : encrypt(apiKey);
  }
  if (model) {
    data.geminiModel = model;
  }
  if (temperature !== undefined) {
    data.temperature = temperature;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ success: false, error: "No settings provided" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data,
  });

  return NextResponse.json({ success: true });
}
