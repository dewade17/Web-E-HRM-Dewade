// Bentuk tag dari mobile: @[__<id>__](__<nama>__)
const TAG_RE = /@\[\s*__([\s\S]*?)__\s*\]\(\s*__([\s\S]*?)__\s*\)/g;

/** Ubah seluruh tag jadi @nama  */
export function handoverPlainText(raw) {
  const s = String(raw ?? '');
  return s.replace(TAG_RE, (_, _id, name) => `@${String(name).trim()}`);
}

/** Ambil daftar {id, name} dari teks handover */
export function extractHandoverTags(raw) {
  const s = String(raw ?? '');
  const out = [];
  for (const m of s.matchAll(TAG_RE)) {
    out.push({
      id: String(m[1] ?? '').trim(),
      name: String(m[2] ?? '').trim(),
    });
  }
  return out;
}

/** Merge dua array user (by id atau name case-insensitive) */
export function mergeUsers(a = [], b = []) {
  const seen = new Set();
  const key = (u) => (u?.id ? `id:${String(u.id).toLowerCase()}` : `name:${String(u.name).toLowerCase()}`);
  const res = [];
  for (const u of [...a, ...b]) {
    if (!u) continue;
    const k = key(u);
    if (seen.has(k)) continue;
    seen.add(k);
    res.push(u);
  }
  return res;
}
