import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updatePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || "Invalid password payload" },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });

  if (!user) {
    return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
  }

  if (!user.passwordHash) {
    return NextResponse.json(
      {
        success: false,
        error: "Password changes are not available for this account. Sign in through your connected provider or add password support first.",
      },
      { status: 400 }
    );
  }

  const isCurrentPasswordValid = await bcrypt.compare(
    parsed.data.currentPassword,
    user.passwordHash
  );
  if (!isCurrentPasswordValid) {
    return NextResponse.json(
      { success: false, error: "Current password is incorrect" },
      { status: 400 }
    );
  }

  const nextPasswordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { passwordHash: nextPasswordHash },
  });

  return NextResponse.json({ success: true });
}
