/* Akses database: membuka koneksi dan membaca/menulis data dalam bentuk yang dipakai logic.js. */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

/** Membuka database (file atau ':memory:') dan memastikan semua tabel ada. */
function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(schema);
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

function getPeople(db) {
  return db
    .prepare('SELECT id, name, division AS div, title, role, quota, used_before AS usedBefore FROM users ORDER BY id')
    .all();
}

function getRooms(db) {
  return db.prepare('SELECT id, name, cap FROM rooms ORDER BY rowid').all();
}

function getEvents(db) {
  const rows = db
    .prepare(
      `SELECT id, type, title, candidate, event_date AS date, start_time AS start, end_time AS end,
              room_id AS room, all_hands AS allHands
         FROM events ORDER BY event_date, start_time, id`
    )
    .all();
  const byEvent = new Map();
  for (const { event_id, user_id } of db.prepare('SELECT event_id, user_id FROM event_participants ORDER BY user_id').all()) {
    if (!byEvent.has(event_id)) byEvent.set(event_id, []);
    byEvent.get(event_id).push(user_id);
  }
  return rows.map((r) => ({ ...r, allHands: r.allHands === 1, people: byEvent.get(r.id) || [] }));
}

function getLeaves(db) {
  return db
    .prepare(
      `SELECT id, user_id AS userId, type, start_date AS start, end_date AS end, reason, status,
              decided_by AS by, note
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
  const ins = db.prepare('INSERT INTO event_participants (event_id, user_id) VALUES (?, ?)');
  for (const uid of people) ins.run(eventId, uid);
}

/** Menyimpan jadwal beserta pesertanya dalam satu transaksi. Mengembalikan id baru. */
const insertEvent = (db, e, createdBy) =>
  inTransaction(db, () => {
    const info = db
      .prepare(
        `INSERT INTO events (type, title, candidate, event_date, start_time, end_time, room_id, all_hands, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(e.type, e.title, e.candidate || '', e.date, e.start, e.end, e.room, e.allHands ? 1 : 0, createdBy);
    const id = Number(info.lastInsertRowid);
    if (!e.allHands) setParticipants(db, id, e.people);
    return id;
  });

const updateEvent = (db, id, e) =>
  inTransaction(db, () => {
    db.prepare(
      `UPDATE events SET type = ?, title = ?, candidate = ?, event_date = ?, start_time = ?, end_time = ?,
                         room_id = ?, all_hands = ? WHERE id = ?`
    ).run(e.type, e.title, e.candidate || '', e.date, e.start, e.end, e.room, e.allHands ? 1 : 0, id);
    setParticipants(db, id, e.allHands ? [] : e.people);
  });

module.exports = { openDb, inTransaction, loadCtx, getPeople, getRooms, getEvents, getLeaves, insertEvent, updateEvent };
