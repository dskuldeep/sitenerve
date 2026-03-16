import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { projectId } = await params;

  const runs = await prisma.qualificationRun.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({ success: true, data: runs });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { projectId } = await params;

  try {
    const { qualificationQueue } = await import("@/lib/queue");
    await qualificationQueue.add("qualify", { projectId });
    return NextResponse.json({ success: true, message: "Qualification enqueued" });
  } catch {
    try {
      const { runQualification } = await import("@/services/qualification/pipeline");
      const runId = await runQualification(projectId);
      return NextResponse.json({ success: true, data: { runId } });
    } catch (error) {
      return NextResponse.json(
        { success: false, error: "Failed to run qualification" },
        { status: 500 }
      );
    }
  }
}
