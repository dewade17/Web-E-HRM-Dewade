import test from 'node:test';
import assert from 'node:assert/strict';

import { createStorageClient } from '../app/api/_utils/storageClient.js';

function makeFakeFile({ name = 'file.bin', type = 'application/octet-stream', size = 4, content = 'test' } = {}) {
  return {
    name,
    type,
    size,
    async arrayBuffer() {
      const enc = new TextEncoder();
      return enc.encode(content).buffer;
    },
  };
}

test('storageClient.uploadBufferWithPresign success flow', async (t) => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    calls.push({ input, init });
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/api/storage/create-upload')) {
      return new Response(JSON.stringify({ uploadUrl: 'http://upload.local/presigned', key: 'obj-key-1', uploadHeaders: { 'x-test': '1' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === 'http://upload.local/presigned') {
      return new Response(null, { status: 200, headers: { ETag: '"etag-xyz"' } });
    }
    if (url.endsWith('/api/storage/confirm')) {
      return new Response(JSON.stringify({ ok: true, publicUrl: 'https://cdn.local/public/obj-key-1', key: 'obj-key-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ message: 'unexpected' }), { status: 500 });
  };

  try {
    const client = createStorageClient({ baseURL: 'https://gateway.local' });
    const fake = makeFakeFile({ name: 'dokumen.pdf', type: 'application/pdf', content: 'abcdef' });
    const res = await client.uploadBufferWithPresign(fake, { folder: 'pengajuan' });
    assert.equal(res.key, 'obj-key-1');
    assert.equal(res.publicUrl, 'https://cdn.local/public/obj-key-1');
    assert.equal(res.etag, 'etag-xyz');
    assert.ok(res.size > 0);
    assert.equal(calls.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('storageClient.uploadBufferWithPresign confirm failure throws', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/api/storage/create-upload')) {
      return new Response(JSON.stringify({ uploadUrl: 'http://upload.local/presigned', key: 'obj-key-2' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === 'http://upload.local/presigned') {
      return new Response(null, { status: 200, headers: { ETag: 'etag-2' } });
    }
    if (url.endsWith('/api/storage/confirm')) {
      return new Response(JSON.stringify({ message: 'confirm failed' }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ message: 'unexpected' }), { status: 500 });
  };

  try {
    const client = createStorageClient({ baseURL: 'https://gateway.local' });
    const fake = makeFakeFile();
    await assert.rejects(() => client.uploadBufferWithPresign(fake, { folder: 'pengajuan' }));
  } finally {
    global.fetch = originalFetch;
  }
});

