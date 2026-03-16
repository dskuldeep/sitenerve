import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { listGeminiModels } from "@/lib/gemini";
import { z } from "zod";

const listModelsSchema = z.object({
  apiKey: z.string().min(1).optional(),
});

async function getUserApiKey(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { geminiApiKey: true },
  });

  if (!user?.geminiApiKey) {
    return null;
  }

  return decrypt(user.geminiApiKey);
}

async function listForAuthenticatedUser(userId: string, apiKeyOverride?: string) {
  const apiKey = apiKeyOverride?.trim() || (await getUserApiKey(userId));
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "No Gemini API key configured in profile" },
      { status: 400 }
    );
  }

  const models = await listGeminiModels(apiKey);
  return NextResponse.json({ success: true, data: models });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await listForAuthenticatedUser(session.user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch models";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = listModelsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    return await listForAuthenticatedUser(session.user.id, parsed.data.apiKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch models";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
