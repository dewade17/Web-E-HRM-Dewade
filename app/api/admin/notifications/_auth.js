// app/api/admin/notifications/_auth.js (opsional)
// atau copas ke tiap file route.js

import { NextResponse } from "next/server";
import { verifyAuthToken } from "@/lib/jwt";
import { authenticateRequest } from "@/app/utils/auth/authUtils";

const ADMIN_ROLES = new Set([
  "HR",
  "OPERASIONAL",
  "DIREKTUR",
  "SUPERADMIN",
  "SUBADMIN",
  "SUPERVISI",
]);

const normRole = (role) =>
  String(role || "")
    .trim()
    .toUpperCase();

export async function ensureAdminAuth(req) {
  const auth = req.headers.get("authorization") || "";

  // Coba pakai Bearer token dulu
  if (auth.startsWith("Bearer ")) {
    try {
      const payload = verifyAuthToken(auth.slice(7).trim());
      const id =
        payload?.sub || payload?.id_user || payload?.userId || payload?.id;
      const role = payload?.role;

      if (!id) {
        return NextResponse.json(
          { ok: false, message: "Unauthorized." },
          { status: 401 }
        );
      }
      if (!ADMIN_ROLES.has(normRole(role))) {
        return NextResponse.json(
          { ok: false, message: "Forbidden." },
          { status: 403 }
        );
      }

      return { actor: { id, role, source: "bearer" } };
    } catch (_) {
      // fallback ke NextAuth di bawah
    }
  }

  // Fallback: NextAuth session
  const sessionOrRes = await authenticateRequest();
  if (sessionOrRes instanceof NextResponse) return sessionOrRes;

  const id = sessionOrRes?.user?.id || sessionOrRes?.user?.id_user;
  const role = sessionOrRes?.user?.role;
  if (!id) {
    return NextResponse.json(
      { ok: false, message: "Unauthorized." },
      { status: 401 }
    );
  }
  if (!ADMIN_ROLES.has(normRole(role))) {
    return NextResponse.json(
      { ok: false, message: "Forbidden." },
      { status: 403 }
    );
  }

  return { actor: { id, role, source: "session", session: sessionOrRes } };
}
