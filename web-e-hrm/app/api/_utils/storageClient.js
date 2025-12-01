function joinUrl(base, path) {
  if (!base) return path;
  return base.replace(/\/?$/, '') + path;
}

function apiHeaders(extra) {
  const headers = { 'content-type': 'application/json' };
  const apiKey = process.env.OSS_STORAGE_API_KEY;
  if (apiKey) headers['x-api-key'] = apiKey;
  return { ...headers, ...(extra || {}) };
}

async function toJsonOrThrow(res, defaultMessage) {
  let payload = null;
  try {
    payload = await res.json();
  } catch (_) {}
  if (!res.ok) {
    const message = payload?.message || defaultMessage || `Storage API error (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function guessExt(filename) {
  const parts = String(filename || '').split('.');
  if (parts.length > 1) {
    const ext = parts.pop().toLowerCase();
    if (ext && /^[a-z0-9]+$/.test(ext)) return ext;
  }
  return 'bin';
}

function isFileLike(value) {
  return value && typeof value === 'object' && typeof value.arrayBuffer === 'function' && 'size' in value;
}

export function createStorageClient(opts = {}) {
  const baseURL = opts.baseURL ?? process.env.OSS_STORAGE_BASE_URL ?? '';

  return {
    baseURL,

    async createUpload({ mime, ext, folder = 'pengajuan', isPublic = true, checksum, expiresIn, metadata } = {}) {
      const body = { mime, ext, folder };
      if (isPublic !== undefined) body.isPublic = isPublic;
      if (checksum) body.checksum = checksum;
      if (expiresIn) body.expiresIn = expiresIn;

      if (metadata) {
        if (metadata.isPublic !== undefined && isPublic === undefined) {
          body.isPublic = metadata.isPublic;
        }
        body.metadata = metadata;
      }

      const res = await fetch(joinUrl(baseURL, '/api/storage/create-upload'), {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify(body),
      });
      const json = await toJsonOrThrow(res, 'Gagal membuat upload URL.');

      const uploadUrl = json.uploadUrl || json.url || json.upload_url;
      const key = json.key || json.objectKey || json.object_key;
      const headers = json.uploadHeaders || json.headers || {};
      const publicUrl = json.publicUrl || json.public_url || json.url || null;
      const expires = json.expiresIn || json.expires_in || null;

      if (!uploadUrl || !key) {
        const err = new Error('Respon create-upload tidak lengkap.');
        err.payload = json;
        throw err;
      }
      return { uploadUrl, key, headers, publicUrl, expiresIn: expires };
    },

    async confirmUpload({ key, etag, size }) {
      const res = await fetch(joinUrl(baseURL, '/api/storage/confirm'), {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ key, etag, size }),
      });
      const json = await toJsonOrThrow(res, 'Gagal konfirmasi upload.');
      const publicUrl = json.publicUrl || json.public_url || json.url;
      return { ...json, publicUrl };
    },

    async createDownload({ key, expiresIn }) {
      const res = await fetch(joinUrl(baseURL, '/api/storage/create-download'), {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ key, expiresIn }),
      });
      return toJsonOrThrow(res, 'Gagal membuat download URL.');
    },

    async uploadBufferWithPresign(fileOrBlob, { folder = 'pengajuan', isPublic = true, expiresIn, baseURL: overrideBaseURL } = {}) {
      if (!isFileLike(fileOrBlob)) {
        throw new Error('File tidak valid untuk diunggah.');
      }

      const file = fileOrBlob;
      const mime = file.type || 'application/octet-stream';
      const ext = guessExt(file.name);

      const client = overrideBaseURL ? createStorageClient({ baseURL: overrideBaseURL }) : this;

      const { uploadUrl, key, headers, publicUrl: presignedPublicUrl } = await client.createUpload({ mime, ext, folder, isPublic, expiresIn });

      const buffer = Buffer.from(await file.arrayBuffer());
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': mime, ...(headers || {}) },
        body: buffer,
      });
      if (!uploadRes.ok) {
        const err = new Error(`Upload gagal (${uploadRes.status}).`);
        try {
          err.body = await uploadRes.text();
        } catch (_) {}
        throw err;
      }

      const etagHeader = uploadRes.headers?.get?.('etag') || uploadRes.headers?.get?.('ETag');
      const etag = etagHeader ? etagHeader.replace(/^W\//, '').replace(/^"|"$/g, '') : undefined;
      const size = typeof file.size === 'number' ? file.size : buffer.length;

      const confirmed = await client.confirmUpload({ key, etag, size });
      const publicUrl = confirmed.publicUrl || confirmed.url || presignedPublicUrl || null;

      return { key, publicUrl, etag, size, raw: confirmed };
    },
  };
}

const defaultClient = createStorageClient();
export default defaultClient;
