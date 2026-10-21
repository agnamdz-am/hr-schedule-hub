/* Akses database: membuka koneksi dan membaca/menulis data dalam bentuk yang dipakai logic.js. */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

// Naikkan angka ini setiap kali struktur tabel berubah.
const SCHEMA_VERSION = 2;

/**
 * Membuka database (file atau ':memory:') dan memastikan semua tabel ada.
 * Aplikasi ini berisi data fiktif untuk demo, jadi bila struktur tabel di file lama
 * berbeda (versi lebih rendah), tabel lama dihapus dan dibuat ulang. Data demo akan diisi ulang
 * otomatis oleh server saat tabel pengguna kosong.
 */
function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version < SCHEMA_VERSION) {
    db.exec('PRAGMA foreign_keys = OFF;');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    for (const t of tables) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schema);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  return db;
}

/**
 * Menjalankan fn dalam satu transaksi: semua tulis berhasil atau tidak ada yang tersimpan.
 * BEGIN IMMEDIATE langsung mengambil kunci tulis, jadi tidak ada proses lain yang bisa menyela.
 */
function inTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Karyawan beserta peran akunnya (role = null bila tidak punya akun login). */
function getPeople(db) {
  return db
    .prepare(
      `SELECT e.id, e.name, e.division AS div, e.title, u.role AS role, e.quota, e.used_before AS usedBefore, e.active
         FROM employees e LEFT JOIN users u ON u.id = e.id ORDER BY e.id`
    )
    .all()
    .map((p) => ({ ...p, active: p.active === 1 }));
}

function getRooms(db) {
  return db.prepare('SELECT id, name, cap FROM rooms ORDER BY rowid').all();
}

function getEvents(db) {
  const rows = db
    .prepare(
      `SELECT id, type, title, candidate, candidate_id AS candidateId, owner_id AS ownerId, attendees,
              event_date AS date, start_time AS start, end_time AS end, room_id AS room, all_hands AS allHands
         FROM events ORDER BY event_date, start_time, id`
    )
    .all();
  const byEvent = new Map();
  for (const { event_id, employee_id } of db.prepare('SELECT event_id, employee_id FROM event_participants ORDER BY employee_id').all()) {
    if (!byEvent.has(event_id)) byEvent.set(event_id, []);
    byEvent.get(event_id).push(employee_id);
  }
  return rows.map((r) => ({ ...r, allHands: r.allHands === 1, people: byEvent.get(r.id) || [] }));
}

function getLeaves(db) {
  return db
    .prepare(
      `SELECT id, employee_id AS employeeId, type, start_date AS start, end_date AS end, reason, status,
              decided_by AS by, note, submitted_by AS submittedBy
         FROM leaves ORDER BY start_date, id`
    )
    .all();
}

/** Semua data yang dibutuhkan logic.js untuk memeriksa bentrok. */
function loadCtx(db) {
  return { people: getPeople(db), rooms: getRooms(db), events: getEvents(db), leaves: getLeaves(db) };
}

function setParticipants(db, eventId, people) {
  db.prepare('DELETE FROM event_participants WHERE event_id = ?').run(eventId);
  const ins = db.prepare('INSERT INTO event_participants (event_id, employee_id) VALUES (?, ?)');
  for (const id of people) ins.run(eventId, id);
}

/** Menyimpan jadwal beserta orang yang dicek bentrok dalam satu transaksi. Mengembalikan id baru. */
const insertEvent = (db, e, createdBy) =>
  inTransaction(db, () => {
    const info = db
      .prepare(
        `INSERT INTO events (type, title, candidate, candidate_id, owner_id, attendees, event_date, start_time, end_time,
                             room_id, all_hands, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(e.type, e.title, e.candidate || '', e.candidateId || null, e.ownerId || null, e.attendees, e.date, e.start, e.end, e.room, e.allHands ? 1 : 0, createdBy);
    const id = Number(info.lastInsertRowid);
    setParticipants(db, id, e.people);
    return id;
  });

const updateEvent = (db, id, e) =>
  inTransaction(db, () => {
    db.prepare(
      `UPDATE events SET type = ?, title = ?, candidate = ?, candidate_id = ?, owner_id = ?, attendees = ?, event_date = ?,
                         start_time = ?, end_time = ?, room_id = ?, all_hands = ? WHERE id = ?`
    ).run(e.type, e.title, e.candidate || '', e.candidateId || null, e.ownerId || null, e.attendees, e.date, e.start, e.end, e.room, e.allHands ? 1 : 0, id);
    setParticipants(db, id, e.people);
  });

module.exports = { openDb, inTransaction, loadCtx, getPeople, getRooms, getEvents, getLeaves, insertEvent, updateEvent };
