// app/api/admin/notifications/recent/route.js
import { NextResponse } from "next/server";
import db from "@/lib/prisma";
import { ensureAdminAuth } from "../_auth"; // atau copas fungsinya di sini

export async function GET(req) {
  const auth = await ensureAdminAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;

  try {
    const { searchParams } = new URL(req.url);
    const daysRaw = searchParams.get("days");
    const typesRaw = searchParams.get("types"); // "pengajuan_cuti,izin_tukar_hari,..."

    const days = Math.max(1, parseInt(daysRaw || "7", 10));

    const typeList = (typesRaw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 3600 * 1000);

    const where = {
      deleted_at: null,
      id_user: actorId, // notif milik admin yang login
      created_at: { gte: since },
    };

    if (typeList.length) {
      // kita pakai related_table sebagai "type" seperti yg kamu kirim di payload notif
      where.related_table = { in: typeList };
    }

    const items = await db.notification.findMany({
      where,
      orderBy: { created_at: "desc" },
      // boleh dibatasi 100/200 biar nggak banjir
      take: 150,
    });

    return NextResponse.json({ ok: true, data: items });
  } catch (err) {
    console.error("GET /api/admin/notifications/recent error:", err);
    return NextResponse.json(
      { ok: false, message: "Gagal mengambil notifikasi." },
      { status: 500 }
    );
  }
}
