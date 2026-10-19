const jwt = require('jsonwebtoken');

const COOKIE = 'hr_token';
const MAX_AGE_MS = 8 * 60 * 60 * 1000;

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET wajib diatur di production.');
  return 'dev-only-secret-ganti-di-production';
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, getSecret(), { expiresIn: '8h' });
}

function setSessionCookie(res, userId) {
  res.cookie(COOKIE, signToken(userId), {
    httpOnly: true, // tidak bisa dibaca JavaScript di browser
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE);
}

/** Memuat pengguna dari token. Pengguna diambil ulang dari database agar perubahan peran langsung berlaku. */
function requireAuth(db) {
  const find = db.prepare('SELECT id, name, email, division AS div, title, role, quota, used_before AS usedBefore FROM users WHERE id = ?');
  return (req, res, next) => {
    const token = req.cookies && req.cookies[COOKIE];
    if (!token) return res.status(401).json({ error: 'Silakan login terlebih dahulu.' });
    try {
      const payload = jwt.verify(token, getSecret());
      const user = find.get(payload.sub);
      if (!user) return res.status(401).json({ error: 'Sesi tidak valid.' });
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Sesi berakhir, silakan login lagi.' });
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Kamu tidak punya akses untuk aksi ini.' });
    next();
  };
}

/** Dipanggil saat server dibuat supaya salah konfigurasi ketahuan sejak start, bukan saat login pertama. */
const assertConfigured = () => { getSecret(); };

module.exports = { requireAuth, requireRole, setSessionCookie, clearSessionCookie, assertConfigured };
