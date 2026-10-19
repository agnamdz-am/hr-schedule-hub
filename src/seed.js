/*
 * Data fiktif PT Gna Ascend Indonesia.
 * Jalankan `npm run seed` untuk mengosongkan database lalu mengisinya ulang.
 * Tanggal jadwal dihitung relatif terhadap minggu berjalan, supaya kalender selalu terisi saat didemokan.
 */
require('dotenv').config({ quiet: true });
const path = require('path');
const bcrypt = require('bcryptjs');
const { openDb, insertEvent } = require('./db');
const { addDays, ymd } = require('./logic');

const DEMO_PASSWORD = 'password123';

const PEOPLE = [
  [1, 'Agna Mudzkia', 'HR', 'HR Manager', 'hr_manager', 3],
  [2, 'Dimas Pratama', 'HR', 'Recruiter', 'admin', 2],
  [3, 'Ayu Lestari', 'HR', 'Training & Development Officer', 'admin', 1],
  [4, 'Bagas Wicaksono', 'IT', 'IT Lead', 'manager', 4],
  [5, 'Nanda Prakoso', 'IT', 'Frontend Developer', 'staff', 2],
  [6, 'Putri Anjani', 'IT', 'Backend Developer', 'staff', 5],
  [16, 'Citra Dewanti', 'IT', 'UI/UX Designer', 'staff', 0],
  [17, 'Indah Permatasari', 'HR', 'Assistant HR Manager', 'admin', 2],
  [7, 'Hendra Gunawan', 'Finance', 'Finance Manager', 'manager', 6],
  [8, 'Fajar Kurniawan', 'Finance', 'Accountant', 'staff', 3],
  [9, 'Maya Safitri', 'Finance', 'Tax Staff', 'staff', 1],
  [10, 'Indra Setiawan', 'Marketing', 'Marketing Manager', 'manager', 2],
  [11, 'Salsa Nuraini', 'Marketing', 'Content Specialist', 'staff', 4],
  [12, 'Rizky Ramadhan', 'Marketing', 'Digital Marketer', 'staff', 0],
  [13, 'Wahyu Hidayat', 'Operations', 'Operations Manager', 'manager', 5],
  [14, 'Dewi Kusuma', 'Operations', 'Logistics Coordinator', 'staff', 3],
  [15, 'Eko Saputra', 'Operations', 'Warehouse Supervisor', 'staff', 1],
];

const ROOMS = [
  ['merapi', 'Merapi', 12],
  ['bromo', 'Bromo', 8],
  ['semeru', 'Semeru', 6],
  ['rinjani', 'Rinjani', 20],
  ['krakatau', 'Krakatau', 30],
  ['aula', 'Aula Utama', 80],
];

function emailOf(name) {
  return name.split(' ')[0].toLowerCase() + '@gnaascend.test';
}

function weekStart(s) {
  const [y, m, d] = s.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return addDays(s, -dow);
}

function seed(db) {
  const W0 = weekStart(ymd(new Date()));
  const D = (n) => addDays(W0, n);

  db.exec('DELETE FROM event_participants; DELETE FROM events; DELETE FROM leaves; DELETE FROM users; DELETE FROM rooms;');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('events','leaves');");

  // Satu hash dipakai bersama karena semua akun demo memakai password yang sama.
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const insUser = db.prepare('INSERT INTO users (id,name,email,password_hash,division,title,role,quota,used_before) VALUES (?,?,?,?,?,?,?,12,?)');
  for (const [id, name, div, title, role, used] of PEOPLE) insUser.run(id, name, emailOf(name), hash, div, title, role, used);

  const insRoom = db.prepare('INSERT INTO rooms (id,name,cap) VALUES (?,?,?)');
  for (const r of ROOMS) insRoom.run(...r);

  const ev = (type, title, d, start, end, room, people, extra = {}) =>
    insertEvent(db, { type, title, date: D(d), start, end, room, people, allHands: false, candidate: '', ...extra }, 1);

  ev('company', 'Briefing Mingguan HR', 0, '09:00', '09:30', 'semeru', [1, 2, 3]);
  ev('interview', 'Interview Frontend Developer', 1, '10:00', '11:00', 'merapi', [2, 4, 5], { candidate: 'Alya Rahmawati' });
  ev('interview', 'Interview UI/UX Designer', 1, '13:00', '14:00', 'bromo', [2, 16], { candidate: 'Bima Aditya' });
  ev('interview', 'Interview Finance Staff', 2, '09:30', '10:30', 'semeru', [2, 7], { candidate: 'Kartika Sari' });
  ev('interview', 'Interview Backend Developer', 3, '14:00', '15:00', 'merapi', [2, 4, 6], { candidate: 'Rafi Maulana' });
  ev('training', 'Data Privacy Awareness (UU PDP)', 3, '13:00', '15:00', 'krakatau', [3, 5, 8, 9, 11, 12, 14, 15, 16]);
  ev('interview', 'Interview Content Specialist', 4, '10:00', '11:00', 'bromo', [2, 10], { candidate: 'Nabila Putri' });
  ev('company', 'Town Hall Q4', 4, '16:00', '17:00', 'aula', [], { allHands: true });
  ev('training', 'Onboarding Karyawan Baru', 7, '09:00', '12:00', 'rinjani', [1, 3]);
  ev('interview', 'Interview Logistics Coordinator', 8, '10:00', '11:00', 'semeru', [2, 13], { candidate: 'Yoga Permana' });
  ev('training', 'Excel untuk Analisis Data', 9, '09:00', '12:00', 'krakatau', [3, 8, 9, 12, 14]);
  ev('interview', 'Interview Digital Marketer', 9, '11:00', '12:00', 'bromo', [2, 10], { candidate: 'Lintang Maharani' });
  ev('interview', 'Interview Lanjutan Frontend Developer', 10, '15:00', '16:00', 'merapi', [1, 4], { candidate: 'Alya Rahmawati' });
  ev('training', 'K3 Dasar untuk Operations', 11, '13:00', '16:00', 'krakatau', [3, 13, 14, 15]);
  ev('training', 'Leadership Essentials', 15, '09:00', '17:00', 'rinjani', [3, 4, 7, 10, 13]);
  ev('company', 'Gathering Akhir Tahun', 18, '10:00', '15:00', 'aula', [], { allHands: true });
  ev('interview', 'Interview Marketing Manager', -3, '10:00', '11:30', 'merapi', [1, 10], { candidate: 'Gita Paramitha' });
  ev('training', 'Etika Kerja Profesional', -4, '13:00', '15:00', 'krakatau', [3, 5, 6, 8, 11, 14]);

  const insLeave = db.prepare('INSERT INTO leaves (user_id,type,start_date,end_date,reason,status,decided_by,note) VALUES (?,?,?,?,?,?,?,?)');
  insLeave.run(5, 'tahunan', D(7), D(9), 'Pulang kampung', 'approved', 4, '');
  insLeave.run(14, 'tahunan', D(14), D(18), 'Liburan keluarga', 'approved', 13, '');
  insLeave.run(6, 'tahunan', D(-6), D(-5), 'Urusan pribadi', 'approved', 4, '');
  insLeave.run(15, 'sakit', D(2), D(2), 'Demam, surat dokter terlampir', 'approved', 13, '');
  insLeave.run(11, 'tahunan', D(8), D(10), 'Acara pernikahan saudara', 'pending', null, '');
  insLeave.run(9, 'tahunan', D(10), D(11), 'Mengurus dokumen keluarga', 'pending', null, '');
  insLeave.run(16, 'izin', D(11), D(11), 'Keperluan keluarga', 'pending', null, '');
  insLeave.run(12, 'tahunan', D(3), D(4), 'Ikut acara komunitas', 'rejected', 10, 'Bentrok dengan training Data Privacy Awareness');
}

module.exports = { seed, emailOf, DEMO_PASSWORD, PEOPLE };

if (require.main === module) {
  const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'hr.db');
  const db = openDb(file);
  seed(db);
  console.log(`Database diisi ulang: ${file}`);
  console.log(`Login demo: indah@gnaascend.test / ${DEMO_PASSWORD}`);
}
