// app/api/admin/notifications/route.js
import { NextResponse } from "next/server";
import db from "@/lib/prisma";
import { ensureAdminAuth } from "./_auth";

export async function GET(req) {
  const auth = await ensureAdminAuth(req);
  if (auth instanceof NextResponse) return auth;

  const actorId = auth.actor?.id;

  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10))
    );
    const statusFilter = searchParams.get("status"); // "read" | "unread" | kosong = semua

    const where = {
      deleted_at: null,
      id_user: actorId,
    };

    if (statusFilter === "read" || statusFilter === "unread") {
      where.status = statusFilter;
    }

    const [total, items] = await Promise.all([
      db.notification.count({ where }),
      db.notification.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      data: items,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error("GET /api/admin/notifications error:", err);
    return NextResponse.json(
      { ok: false, message: "Gagal mengambil notifikasi." },
      { status: 500 }
    );
  }
}
