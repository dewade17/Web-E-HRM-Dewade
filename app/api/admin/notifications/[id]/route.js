import { NextResponse } from "next/server";
import db from "@/lib/prisma";
import { ensureAdminAuth } from "../_auth";

export async function PUT(req, { params }) {
  const auth = await ensureAdminAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;
  const { id } = params; // UUID dari URL (id_notification)

  if (!id) {
    return NextResponse.json(
      { ok: false, message: "ID notifikasi wajib diisi." },
      { status: 400 }
    );
  }

  try {
    const now = new Date();

    const updated = await db.notification.updateMany({
      where: {
        id_notification: id,     // ✅ cukup ini
        id_user: actorId,
        deleted_at: null,
      },
      data: {
        status: "read",
        read_at: now,
        seen_at: now,
      },
    });

    if (!updated.count) {
      return NextResponse.json(
        { ok: false, message: "Notifikasi tidak ditemukan." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Notifikasi telah ditandai dibaca.",
    });
  } catch (err) {
    console.error("PUT /api/admin/notifications/[id] error:", err);
    return NextResponse.json(
      { ok: false, message: "Gagal menandai notifikasi." },
      { status: 500 }
    );
  }
}
