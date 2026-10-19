/* Pintu masuk untuk Vercel (serverless). Database ada di /tmp dan diisi data fiktif saat pertama dipakai.
 * Catatan: di Vercel data bisa kembali ke data awal sewaktu-waktu (fungsi tidak menyala terus). */
const path = require('path');
const { openDb } = require('../src/db');
const { seed } = require('../src/seed');
const { createApp } = require('../src/app');

const db = openDb(process.env.DB_PATH || path.join('/tmp', 'hr.db'));
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) seed(db);

module.exports = createApp(db);
