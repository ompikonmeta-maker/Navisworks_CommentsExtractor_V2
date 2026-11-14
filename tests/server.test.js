import { describe, it, expect, vi, afterEach } from 'vitest';

// detectRemote caches its answer at module level, so each case loads a fresh copy.
async function detectWith(fetchImpl) {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(fetchImpl));
  const { detectRemote } = await import('../src/lib/server.js');
  return detectRemote();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectRemote', () => {
  it('stays offline when a static host answers /api/health with index.html (200)', async () => {
    const html = new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    expect(await detectWith(async () => html)).toBe(false);
  });

  it('goes remote when the server answers JSON {"status":"ok"}', async () => {
    const ok = new Response(JSON.stringify({ status: 'ok', version: 'test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    expect(await detectWith(async () => ok)).toBe(true);
  });

  it('stays offline when JSON has another status', async () => {
    const other = new Response(JSON.stringify({ status: 'down' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    expect(await detectWith(async () => other)).toBe(false);
  });

  it('stays offline on a network error', async () => {
    expect(await detectWith(async () => { throw new TypeError('Failed to fetch'); })).toBe(false);
  });

  it('stays offline on 404', async () => {
    expect(await detectWith(async () => new Response('Not found', { status: 404 }))).toBe(false);
  });

  it('caches the answer', async () => {
    vi.resetModules();
    const f = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const { detectRemote } = await import('../src/lib/server.js');
    expect(await detectRemote()).toBe(true);
    expect(await detectRemote()).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
