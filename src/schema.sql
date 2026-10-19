-- Skema database HR Schedule Hub (SQLite)
-- Tanggal disimpan sebagai teks 'YYYY-MM-DD' dan jam sebagai 'HH:MM'.
-- Format itu bisa dibandingkan langsung sebagai teks dan tidak bergantung zona waktu.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  division      TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
  quota         INTEGER NOT NULL DEFAULT 12 CHECK (quota >= 0),  -- jatah cuti tahunan
  used_before   INTEGER NOT NULL DEFAULT 0  CHECK (used_before >= 0) -- cuti yang sudah terpakai sebelum sistem ini
);

CREATE TABLE IF NOT EXISTS rooms (
  id   TEXT    PRIMARY KEY,
  name TEXT    NOT NULL,
  cap  INTEGER NOT NULL CHECK (cap > 0)
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT    NOT NULL CHECK (type IN ('interview', 'training', 'company')),
  title      TEXT    NOT NULL,
  candidate  TEXT    NOT NULL DEFAULT '',
  event_date TEXT    NOT NULL,
  start_time TEXT    NOT NULL,
  end_time   TEXT    NOT NULL,
  room_id    TEXT    NOT NULL REFERENCES rooms (id),
  all_hands  INTEGER NOT NULL DEFAULT 0 CHECK (all_hands IN (0, 1)),
  created_by INTEGER REFERENCES users (id),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events (event_date);

CREATE TABLE IF NOT EXISTS event_participants (
  event_id INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users (id),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_participants_user ON event_participants (user_id);

CREATE TABLE IF NOT EXISTS leaves (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users (id),
  type       TEXT    NOT NULL CHECK (type IN ('tahunan', 'sakit', 'izin')),
  start_date TEXT    NOT NULL,
  end_date   TEXT    NOT NULL,
  reason     TEXT    NOT NULL DEFAULT '',
  status     TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by INTEGER REFERENCES users (id),
  note       TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_leaves_user  ON leaves (user_id);
CREATE INDEX IF NOT EXISTS idx_leaves_dates ON leaves (start_date, end_date);
