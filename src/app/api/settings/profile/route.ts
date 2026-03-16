import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  image: z
    .string()
    .trim()
    .url("Profile image must be a valid URL")
    .or(z.literal(""))
    .optional(),
});

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || "Invalid profile payload" },
      { status: 400 }
    );
  }

  const updatedUser = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      name: parsed.data.name,
      avatarUrl: parsed.data.image?.trim() ? parsed.data.image.trim() : null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      image: updatedUser.avatarUrl,
    },
  });
}
