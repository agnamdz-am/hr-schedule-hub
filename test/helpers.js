const { openDb, loadCtx } = require('../src/db');
const { seed, DEMO_PASSWORD } = require('../src/seed');
const { createApp } = require('../src/app');
const { addDays, ymd } = require('../src/logic');

// Senin minggu ini, sama seperti yang dipakai seed.js
const weekStart = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return addDays(s, -((new Date(y, m - 1, d).getDay() + 6) % 7));
};
const W0 = weekStart(ymd(new Date()));
const D = (n) => addDays(W0, n);

/** Menjalankan server sungguhan di port acak dengan database memori yang sudah diisi data fiktif. */
async function startApp() {
  const db = openDb(':memory:');
  seed(db);
  const app = createApp(db, { loginLimit: 1000 });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { db, base, ctx: () => loadCtx(db), close: () => new Promise((r) => server.close(r)) };
}

/** Login dan mengembalikan fungsi request yang otomatis membawa cookie sesi. */
async function loginAs(base, email) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`login ${email} gagal: ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await r.json(); } catch { /* tanpa body */ }
    return { status: r.status, data };
  };
}

module.exports = { startApp, loginAs, D, W0 };
