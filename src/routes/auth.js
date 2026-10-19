const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { setSessionCookie, clearSessionCookie, requireAuth } = require('../middleware/auth');
const { DEMO_PASSWORD } = require('../seed');

// Hash palsu agar waktu respons sama baik email ada maupun tidak (mencegah menebak email yang terdaftar).
const DUMMY_HASH = bcrypt.hashSync('tidak-dipakai', 10);

function authRoutes(db, { loginLimit = 10 } = {}) {
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginLimit,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // hanya login gagal yang dihitung
    message: { error: 'Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.' },
  });
  const byEmail = db.prepare('SELECT id, password_hash FROM users WHERE email = ?');
  const publicUser = db.prepare('SELECT id, name, email, division AS div, title, role, quota, used_before AS usedBefore FROM users WHERE id = ?');

  router.post('/login', limiter, (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email dan password wajib diisi.' });
    }
    const row = byEmail.get(email.trim().toLowerCase());
    const ok = bcrypt.compareSync(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !ok) return res.status(401).json({ error: 'Email atau password salah.' });
    setSessionCookie(res, row.id);
    res.json({ user: publicUser.get(row.id) });
  });

  router.post('/logout', (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth(db), (req, res) => res.json({ user: req.user }));

  // Daftar akun contoh untuk halaman login. Matikan dengan DEMO_MODE=false di deployment sungguhan.
  router.get('/demo', (req, res) => {
    if (process.env.DEMO_MODE === 'false') return res.json({ enabled: false, accounts: [] });
    const accounts = db.prepare('SELECT name, email, role, division AS div, title FROM users ORDER BY id').all();
    res.json({ enabled: true, password: DEMO_PASSWORD, accounts });
  });

  return router;
}

module.exports = authRoutes;
