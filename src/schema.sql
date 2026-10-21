-- Skema database HR Schedule Hub (SQLite), versi 2.
-- Tanggal disimpan sebagai teks 'YYYY-MM-DD' dan jam sebagai 'HH:MM'.
-- Format itu bisa dibandingkan langsung sebagai teks dan tidak bergantung zona waktu.

-- Data karyawan (satu tempat). Semua fitur lain memilih karyawan dari tabel ini.
-- Karyawan tidak perlu punya akun login.
CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  division    TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  quota       INTEGER NOT NULL DEFAULT 12 CHECK (quota >= 0),     -- jatah cuti tahunan
  used_before INTEGER NOT NULL DEFAULT 0  CHECK (used_before >= 0), -- cuti yang sudah terpakai sebelum sistem ini
  active      INTEGER NOT NULL DEFAULT 1  CHECK (active IN (0, 1)) -- 0 = sudah keluar, tidak muncul di pilihan form
);

-- Akun login. Hanya Admin HR dan Manager HR. id sama dengan id karyawannya.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY REFERENCES employees (id),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('hr_manager', 'admin'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id   TEXT    PRIMARY KEY,
  name TEXT    NOT NULL,
  cap  INTEGER NOT NULL CHECK (cap > 0)
);

CREATE TABLE IF NOT EXISTS jobs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  title     TEXT    NOT NULL,
  division  TEXT    NOT NULL,
  openings  INTEGER NOT NULL CHECK (openings > 0),  -- jumlah orang yang dicari
  status    TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_on TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id           INTEGER NOT NULL REFERENCES jobs (id),
  name             TEXT    NOT NULL,
  email            TEXT    NOT NULL,
  source           TEXT    NOT NULL DEFAULT 'Lainnya',
  stage            TEXT    NOT NULL DEFAULT 'applied'
                   CHECK (stage IN ('applied', 'screening', 'interview_hr', 'interview_user', 'offer', 'hired', 'rejected')),
  applied_on       TEXT    NOT NULL,
  stage_changed_on TEXT    NOT NULL,
  reject_reason    TEXT    NOT NULL DEFAULT '',
  UNIQUE (job_id, email)  -- satu orang tidak bisa melamar dua kali ke lowongan yang sama
);
CREATE INDEX IF NOT EXISTS idx_candidates_job ON candidates (job_id);

-- Interview: yang dicek bentrok adalah pewawancara (event_participants).
-- Training dan acara perusahaan: yang dicek bentrok adalah penanggung jawab (owner_id),
-- sedangkan peserta cukup berupa jumlah (attendees) untuk memeriksa kapasitas ruang.
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT    NOT NULL CHECK (type IN ('interview', 'training', 'company')),
  title        TEXT    NOT NULL,
  candidate    TEXT    NOT NULL DEFAULT '',
  candidate_id INTEGER REFERENCES candidates (id) ON DELETE SET NULL,  -- kandidat terdaftar (bila ada)
  owner_id     INTEGER REFERENCES employees (id),                      -- penanggung jawab (training dan acara)
  attendees    INTEGER NOT NULL DEFAULT 1 CHECK (attendees >= 1),      -- jumlah orang yang hadir
  event_date   TEXT    NOT NULL,
  start_time   TEXT    NOT NULL,
  end_time     TEXT    NOT NULL,
  room_id      TEXT    NOT NULL REFERENCES rooms (id),
  all_hands    INTEGER NOT NULL DEFAULT 0 CHECK (all_hands IN (0, 1)),
  created_by   INTEGER REFERENCES users (id),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events (event_date);

CREATE TABLE IF NOT EXISTS event_participants (
  event_id    INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees (id),
  PRIMARY KEY (event_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_participants_employee ON event_participants (employee_id);

-- Cuti selalu diajukan Admin HR atas nama karyawan (submitted_by) dan diputuskan Manager HR (decided_by).
CREATE TABLE IF NOT EXISTS leaves (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees (id),
  type         TEXT    NOT NULL CHECK (type IN ('tahunan', 'sakit', 'izin')),
  start_date   TEXT    NOT NULL,
  end_date     TEXT    NOT NULL,
  reason       TEXT    NOT NULL DEFAULT '',
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by   INTEGER REFERENCES users (id),
  note         TEXT    NOT NULL DEFAULT '',
  submitted_by INTEGER REFERENCES users (id),
  created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_leaves_employee ON leaves (employee_id);
CREATE INDEX IF NOT EXISTS idx_leaves_dates ON leaves (start_date, end_date);

-- Penilaian interview diisi Admin HR (recorded_by) atas nama pewawancara (interviewer_id).
CREATE TABLE IF NOT EXISTS evaluations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id   INTEGER NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  interviewer_id INTEGER NOT NULL REFERENCES employees (id),
  recorded_by    INTEGER REFERENCES users (id),
  stage          TEXT    NOT NULL CHECK (stage IN ('interview_hr', 'interview_user')),
  score          INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  recommend      TEXT    NOT NULL CHECK (recommend IN ('lanjut', 'tidak')),
  note           TEXT    NOT NULL DEFAULT '',
  created_on     TEXT    NOT NULL,
  UNIQUE (candidate_id, interviewer_id, stage)  -- satu penilaian per pewawancara per tahap
);
CREATE INDEX IF NOT EXISTS idx_evaluations_candidate ON evaluations (candidate_id);
