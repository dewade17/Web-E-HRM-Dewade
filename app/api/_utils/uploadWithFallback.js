// app/api/_utils/uploadWithFallback.js
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import storageClient from './storageClient';

function isFileLike(value) {
  return value && typeof value === 'object' && typeof value.arrayBuffer === 'function' && 'size' in value;
}

function guessExt(filename) {
  const parts = String(filename || '').split('.');
  if (parts.length > 1) {
    const ext = parts.pop().toLowerCase();
    if (ext && /^[a-z0-9]+$/.test(ext)) return ext;
  }
  return 'bin';
}

function sanitizePathPart(value) {
  const v = String(value ?? '').trim();
  const safe = v
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
  return safe || 'anon';
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const err = new Error('Supabase env tidak lengkap. Butuh SUPABASE_URL (atau NEXT_PUBLIC_SUPABASE_URL) dan SUPABASE_SERVICE_ROLE_KEY.');
    err.code = 'SUPABASE_ENV_MISSING';
    throw err;
  }
  return createClient(url, key);
}

function extractSupabaseBucketPath(publicUrl) {
  try {
    const u = new URL(publicUrl);
    // format: /storage/v1/object/public/<bucket>/<path>
    const m = u.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (m) return { bucket: m[1], path: decodeURIComponent(m[2]) };
  } catch (_) {}
  return null;
}

/**
 * Upload media (file/foto) dengan strategi:
 * 1) Coba ke Storage API (OSS) via presign (storageClient.uploadBufferWithPresign)
 * 2) Jika gagal -> fallback ke Supabase Storage
 *
 * @param {File} file - File dari req.formData()
 * @param {object} opts
 * @param {string} opts.storageFolder - folder untuk Storage API (default: 'pengajuan')
 * @param {boolean} opts.isPublic - flag public untuk Storage API (default: true)
 * @param {number} opts.expiresIn - TTL presign (opsional)
 * @param {string} opts.supabaseBucket - bucket Supabase (default env SUPABASE_STORAGE_BUCKET atau 'e-hrm')
 * @param {string} opts.supabasePrefix - prefix path Supabase (default: 'uploads')
 * @param {string[]} opts.pathSegments - segmen path tambahan (mis. [userId])
 * @param {string} opts.forceFilenameBase - base nama file (opsional)
 * @returns {Promise<{provider:'storage'|'supabase', publicUrl:string|null, key?:string, etag?:string, size?:number, bucket?:string, path?:string, errors?:object}>}
 */
export async function uploadMediaWithFallback(
  file,
  { storageFolder = 'pengajuan', isPublic = true, expiresIn, supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'e-hrm', supabasePrefix = 'uploads', pathSegments = [], forceFilenameBase } = {}
) {
  if (!isFileLike(file)) {
    const err = new Error('File tidak valid untuk diunggah (harus File dari formData).');
    err.status = 400;
    throw err;
  }

  const errors = {};
  const mime = file.type || 'application/octet-stream';
  const ext = guessExt(file.name);

  // ====== 1) TRY PRIMARY STORAGE (OSS / Storage API) ======
  try {
    const uploaded = await storageClient.uploadBufferWithPresign(file, {
      folder: storageFolder,
      isPublic,
      expiresIn,
    });

    return {
      provider: 'storage',
      publicUrl: uploaded.publicUrl ?? null,
      key: uploaded.key,
      etag: uploaded.etag,
      size: uploaded.size,
      errors,
    };
  } catch (e) {
    errors.storage = {
      message: e?.message || 'Upload ke Storage gagal',
      status: e?.status,
      payload: e?.payload,
    };
  }

  // ====== 2) FALLBACK SUPABASE ======
  const supabase = getSupabase();

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const filenameBase = sanitizePathPart(forceFilenameBase) || `${Date.now()}-${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)}`;

  const segs = [sanitizePathPart(supabasePrefix), ...pathSegments.map(sanitizePathPart).filter(Boolean)].filter(Boolean);

  const path = `${segs.join('/')}/${filenameBase}.${ext}`;

  const { error: upErr } = await supabase.storage.from(supabaseBucket).upload(path, buffer, {
    upsert: true,
    contentType: mime,
  });

  if (upErr) {
    errors.supabase = { message: upErr.message };
    const err = new Error(`Gagal upload (Storage & Supabase). Storage: ${errors.storage?.message || '-'} | Supabase: ${upErr.message}`);
    err.status = 502;
    err.errors = errors;
    throw err;
  }

  const { data: pub } = supabase.storage.from(supabaseBucket).getPublicUrl(path);

  return {
    provider: 'supabase',
    publicUrl: pub?.publicUrl || null,
    bucket: supabaseBucket,
    path,
    errors,
  };
}

/**
 * Hapus object di Supabase jika publicUrl adalah URL Supabase Storage.
 * Jika bukan URL Supabase, fungsi ini NO-OP.
 */
export async function deleteSupabaseByPublicUrl(publicUrl) {
  if (!publicUrl) return { deleted: false, reason: 'empty' };

  const info = extractSupabaseBucketPath(publicUrl);
  if (!info) return { deleted: false, reason: 'not-supabase-url' };

  const supabase = getSupabase();
  const { error } = await supabase.storage.from(info.bucket).remove([info.path]);

  if (error) {
    return { deleted: false, reason: 'remove-failed', error: error.message };
  }
  return { deleted: true, bucket: info.bucket, path: info.path };
}
