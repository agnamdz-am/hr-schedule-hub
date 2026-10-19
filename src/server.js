require('dotenv').config({ quiet: true });
const path = require('path');
const { openDb } = require('./db');
const { seed } = require('./seed');
const { createApp } = require('./app');

const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'hr.db');
const port = Number(process.env.PORT) || 3000;

const db = openDb(file);
// Database kosong (pertama kali dijalankan): isi dengan data fiktif agar langsung bisa dicoba.
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  seed(db);
  console.log('Database baru diisi dengan data fiktif PT Gna Ascend Indonesia.');
}

createApp(db).listen(port, () => {
  console.log(`HR Schedule Hub berjalan di http://localhost:${port}`);
  console.log('Login demo: indah@gnaascend.test / password123');
});
