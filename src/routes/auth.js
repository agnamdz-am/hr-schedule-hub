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
  const publicUser = db.prepare('SELECT u.id, e.name, u.email, e.division AS div, e.title, u.role, e.quota, e.used_before AS usedBefore FROM users u JOIN employees e ON e.id = u.id WHERE u.id = ?');

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
    // Hanya dua akun: Manager HR dan Admin HR.
    const accounts = db
      .prepare("SELECT e.name, u.email, u.role, e.division AS div, e.title FROM users u JOIN employees e ON e.id = u.id WHERE u.id IN (1, 17) ORDER BY CASE u.role WHEN 'hr_manager' THEN 0 ELSE 1 END, u.id")
      .all();
    res.json({ enabled: true, password: DEMO_PASSWORD, accounts });
  });

  return router;
}

module.exports = authRoutes;
