import Cookies from 'js-cookie';

async function crudRequest(
  endpoint,
  method = 'GET',
  body = undefined,
  opts = {} // { useToken?, headers? }
) {
  try {
    const token = Cookies.get('token');
    const useToken = opts.useToken ?? method !== 'POST'; // POST default TANPA token
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

    const headers = new Headers(opts.headers || {});
    // Hanya set JSON header kalau BUKAN FormData
    if (!isForm) headers.set('Content-Type', 'application/json');
    // Sisipkan token kecuali dimatikan
    if (useToken && token) headers.set('Authorization', `Bearer ${token}`);

    const options = {
      method,
      headers,
      body: isForm ? body : body != null ? JSON.stringify(body) : undefined,
    };

    const response = await fetch(endpoint, options);

    const contentType = response.headers.get('Content-Type') || '';
    let data;

    if (contentType.includes('application/json')) {
      data = await response.json().catch(() => ({}));
    } else if (contentType.includes('text/') || contentType.includes('application/xml')) {
      data = { message: await response.text() };
    } else {
      // fallback untuk file/binary
      const blob = await response.blob();
      data = { blob, filename: getFilenameFromResponse(response) };
    }

    if (!response.ok || (data && data.error)) {
      throw {
        status: response.status,
        message: data?.message || response.statusText,
      };
    }

    return data;
  } catch (error) {
    throw error;
  }
}

function getFilenameFromResponse(response) {
  const cd = response.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export const crudService = {
  // GET, PUT, PATCH, DELETE default pakai token
  get: (endpoint, opts) => crudRequest(endpoint, 'GET', undefined, opts),
  put: (endpoint, data, opts) => crudRequest(endpoint, 'PUT', data, opts),
  patch: (endpoint, data, opts) => crudRequest(endpoint, 'PATCH', data, opts),
  delete: (endpoint, data, opts) => crudRequest(endpoint, 'DELETE', data, opts),

  // POST default TANPA token
  post: (endpoint, data, opts) => crudRequest(endpoint, 'POST', data, { ...opts, useToken: false }),

  // Helper untuk multipart/form-data (FormData) TANPA token
  postForm: (endpoint, formData, opts) => crudRequest(endpoint, 'POST', formData, { ...opts, useToken: false }),

  // Kalau suatu saat perlu POST pakai token, bisa gunakan ini:
  postAuth: (endpoint, data, opts) => crudRequest(endpoint, 'POST', data, { ...opts, useToken: true }),

  // Low-level
  request: (options) => crudRequest(options.endpoint, options.method, options.body, options),
};
