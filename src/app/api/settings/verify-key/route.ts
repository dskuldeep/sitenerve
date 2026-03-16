import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyApiKey } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { apiKey } = await req.json();
  const normalizedKey = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!normalizedKey) {
    return NextResponse.json({ success: false, error: "API key required" }, { status: 400 });
  }

  const result = await verifyApiKey(normalizedKey);

  if (result.valid) {
    return NextResponse.json({ success: true, data: { valid: true } });
  } else {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: 400 }
    );
  }
}
