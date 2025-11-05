export function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function isNullLike(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return true;
    const lowered = trimmed.toLowerCase();
    if (lowered === 'null' || lowered === 'undefined') return true;
  }
  return false;
}

export function isFile(value) {
  return typeof File !== 'undefined' && value instanceof File;
}

export async function parseRequestBody(req) {
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const obj = {};

    for (const [key, value] of form.entries()) {
      // --- LOGIKA BARU UNTUK ARRAY ---
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        // Jika key sudah ada, ubah/tambahkan ke array
        if (Array.isArray(obj[key])) {
          obj[key].push(value);
        } else {
          // Ubah dari string/file tunggal menjadi array
          obj[key] = [obj[key], value];
        }
      } else {
        // Jika key baru, set nilainya
        obj[key] = value;
      }
      // --- AKHIR LOGIKA BARU ---
    }
    return { type: 'form', body: obj };
  }

  try {
    const body = await req.json();
    return { type: 'json', body };
  } catch (_) {
    const err = new Error('Body harus berupa JSON atau form-data.');
    err.status = 400;
    throw err;
  }
}

export function findFileInBody(body, keys = []) {
  for (const key of keys) {
    const val = body[key];
    if (isFile(val) && val.size > 0) return val;
  }
  return null;
}
