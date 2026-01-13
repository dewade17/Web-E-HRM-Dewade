// app/api/admin/notifications/mark-all-as-read/route.js
import { NextResponse } from "next/server";
import db from "@/lib/prisma";
import { ensureAdminAuth } from "../_auth";

export async function PUT(req) {
  const auth = await ensureAdminAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;

  try {
    const now = new Date();

    await db.notification.updateMany({
      where: {
        id_user: actorId,
        status: "unread",
        deleted_at: null,
      },
      data: {
        status: "read",
        read_at: now,
        seen_at: now,
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Semua notifikasi telah ditandai dibaca.",
    });
  } catch (err) {
    console.error(
      "PUT /api/admin/notifications/mark-all-as-read error:",
      err
    );
    return NextResponse.json(
      { ok: false, message: "Gagal menandai semua notifikasi." },
      { status: 500 }
    );
  }
}
