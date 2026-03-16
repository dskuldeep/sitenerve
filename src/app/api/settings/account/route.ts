import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });

  if (!existingUser) {
    return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
  }

  await prisma.user.delete({
    where: { id: session.user.id },
  });

  return NextResponse.json({ success: true });
}
