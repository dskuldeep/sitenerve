import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "50");
  const projectId = searchParams.get("projectId");

  const where: Record<string, unknown> = { userId: session.user.id };
  if (projectId) where.projectId = projectId;

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      project: { select: { name: true } },
    },
  });

  return NextResponse.json({ success: true, data: notifications });
}
