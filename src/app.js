const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { requireAuth, assertConfigured } = require('./middleware/auth');
const { loadCtx } = require('./db');
const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/events');
const leaveRoutes = require('./routes/leaves');

function createApp(db, opts = {}) {
  assertConfigured();
  const app = express();
  app.disable('x-powered-by');
  // Di belakang proxy hosting (Render, Railway, dll.) agar rate limit membaca IP pengguna asli.
  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // Nonaktif agar browser tidak memaksa https saat dijalankan lewat http://localhost.
          // Di produksi, https ditangani oleh platform hosting.
          'upgrade-insecure-requests': null,
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
        },
      },
    })
  );
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());

  const auth = requireAuth(db);

  app.use('/api/auth', authRoutes(db, { loginLimit: opts.loginLimit }));

  // Satu panggilan untuk memuat seluruh data awal setelah login.
  app.get('/api/bootstrap', auth, (req, res) => {
    const ctx = loadCtx(db);
    res.json({ me: req.user, ...ctx });
  });
  app.use('/api/events', auth, eventRoutes(db));
  app.use('/api/leaves', auth, leaveRoutes(db));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

  // logic.js dipakai bersama oleh server dan browser.
  app.get('/logic.js', (req, res) => res.type('application/javascript').sendFile(path.join(__dirname, 'logic.js')));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Format JSON tidak valid.' });
    console.error(err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  });

  return app;
}

module.exports = { createApp };
