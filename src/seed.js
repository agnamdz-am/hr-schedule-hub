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

// [id, nama, divisi, jabatan, cuti terpakai sebelumnya]. Semua karyawan di sini, tidak perlu punya akun.
const PEOPLE = [
  [1, 'Agna Mudzkia', 'HR', 'HR Manager', 3],
  [2, 'Dimas Pratama', 'HR', 'Recruiter', 2],
  [3, 'Ayu Lestari', 'HR', 'Training & Development Officer', 1],
  [4, 'Bagas Wicaksono', 'IT', 'IT Lead', 4],
  [5, 'Nanda Prakoso', 'IT', 'Frontend Developer', 2],
  [6, 'Putri Anjani', 'IT', 'Backend Developer', 5],
  [16, 'Citra Dewanti', 'IT', 'UI/UX Designer', 0],
  [17, 'Indah Permatasari', 'HR', 'Assistant HR Manager', 2],
  [7, 'Hendra Gunawan', 'Finance', 'Finance Manager', 6],
  [8, 'Fajar Kurniawan', 'Finance', 'Accountant', 3],
  [9, 'Maya Safitri', 'Finance', 'Tax Staff', 1],
  [10, 'Indra Setiawan', 'Marketing', 'Marketing Manager', 2],
  [11, 'Salsa Nuraini', 'Marketing', 'Content Specialist', 4],
  [12, 'Rizky Ramadhan', 'Marketing', 'Digital Marketer', 0],
  [13, 'Wahyu Hidayat', 'Operations', 'Operations Manager', 5],
  [14, 'Dewi Kusuma', 'Operations', 'Logistics Coordinator', 3],
  [15, 'Eko Saputra', 'Operations', 'Warehouse Supervisor', 1],
];

// Akun login: hanya Manager HR dan Admin HR. [id karyawan, peran]
const ACCOUNTS = [[1, 'hr_manager'], [17, 'admin']];

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

  db.exec('DELETE FROM evaluations; DELETE FROM event_participants; DELETE FROM events; DELETE FROM candidates; DELETE FROM jobs; DELETE FROM leaves; DELETE FROM users; DELETE FROM employees; DELETE FROM rooms;');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('events','leaves','jobs','candidates','evaluations','employees');");

  // Satu hash dipakai bersama karena semua akun demo memakai password yang sama.
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const insEmp = db.prepare('INSERT INTO employees (id,name,division,title,quota,used_before,active) VALUES (?,?,?,?,12,?,1)');
  for (const [id, name, div, title, used] of PEOPLE) insEmp.run(id, name, div, title, used);
  const insUser = db.prepare('INSERT INTO users (id,email,password_hash,role) VALUES (?,?,?,?)');
  for (const [id, role] of ACCOUNTS) insUser.run(id, emailOf(PEOPLE.find((p) => p[0] === id)[1]), hash, role);

  const insRoom = db.prepare('INSERT INTO rooms (id,name,cap) VALUES (?,?,?)');
  for (const r of ROOMS) insRoom.run(...r);

  // ----- Rekrutmen: lowongan, kandidat, dan penilaian -----
  const insJob = db.prepare("INSERT INTO jobs (title, division, openings, status, opened_on) VALUES (?, ?, ?, 'open', ?)");
  const JOBS = [
    ['Frontend Developer', 'IT', 1, -30], ['Backend Developer', 'IT', 1, -28], ['UI/UX Designer', 'IT', 1, -21],
    ['Finance Staff', 'Finance', 2, -25], ['Content Specialist', 'Marketing', 1, -20], ['Logistics Coordinator', 'Operations', 1, -18],
    ['Digital Marketer', 'Marketing', 1, -18], ['Marketing Manager', 'Marketing', 1, -40],
  ];
  for (const [title, div, n, off] of JOBS) insJob.run(title, div, n, D(off));

  // [nama, lowongan, tahap, sumber, tanggal melamar, tanggal pindah tahap, alasan ditolak]
  const CANDIDATES = [
    ['Alya Rahmawati', 1, 'interview_user', 'LinkedIn', -12, -1],
    ['Bima Aditya', 3, 'interview_hr', 'Referral', -9, -3],
    ['Kartika Sari', 4, 'interview_hr', 'Situs perusahaan', -8, -2],
    ['Rafi Maulana', 2, 'interview_hr', 'LinkedIn', -10, -3],
    ['Nabila Putri', 5, 'interview_hr', 'Job fair', -7, -2],
    ['Yoga Permana', 6, 'interview_hr', 'Referral', -6, -1],
    ['Lintang Maharani', 7, 'interview_hr', 'LinkedIn', -6, -2],
    ['Gita Paramitha', 8, 'offer', 'LinkedIn', -20, -3],
    ['Faisal Ramadhan', 2, 'screening', 'Situs perusahaan', -4, -2],
    ['Dina Larasati', 1, 'applied', 'Lainnya', -2, -2],
    ['Maharani Putri', 4, 'applied', 'LinkedIn', -1, -1],
    ['Reza Aditya', 2, 'rejected', 'LinkedIn', -14, -8, 'Pengalaman belum sesuai kebutuhan posisi'],
  ];
  const insCand = db.prepare('INSERT INTO candidates (job_id, name, email, source, stage, applied_on, stage_changed_on, reject_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const candIds = {};
  for (const [name, job, stage, source, ap, ch, why] of CANDIDATES) {
    const email = name.toLowerCase().replace(/ /g, '.') + '@mail.example';
    candIds[name] = Number(insCand.run(job, name, email, source, stage, D(ap), D(ch), why || '').lastInsertRowid);
  }
  const cid = (name) => candIds[name];

  const insEval = db.prepare('INSERT INTO evaluations (candidate_id, interviewer_id, recorded_by, stage, score, recommend, note, created_on) VALUES (?, ?, 17, ?, ?, ?, ?, ?)');
  insEval.run(cid('Alya Rahmawati'), 2, 'interview_hr', 4, 'lanjut', 'Komunikasi jelas dan motivasi tinggi.', D(-1));
  insEval.run(cid('Gita Paramitha'), 1, 'interview_hr', 4, 'lanjut', 'Pengalaman memimpin tim yang relevan.', D(-5));
  insEval.run(cid('Gita Paramitha'), 10, 'interview_user', 5, 'lanjut', 'Strategi pemasarannya matang, cocok dengan tim.', D(-3));

  // owner/attendees dipakai training dan acara; untuk interview jumlah hadir = pewawancara + kandidat.
  const ev = (type, title, d, start, end, room, people, extra = {}) =>
    insertEvent(db, { type, title, date: D(d), start, end, room, people, allHands: false, candidate: '', ownerId: null, attendees: people.length + 1, ...extra }, 17);

  ev('company', 'Briefing Mingguan HR', 0, '09:00', '09:30', 'semeru', [1], { ownerId: 1, attendees: 3 });
  ev('interview', 'Interview Frontend Developer', 1, '10:00', '11:00', 'merapi', [2, 4, 5], { candidate: 'Alya Rahmawati', candidateId: cid('Alya Rahmawati') });
  ev('interview', 'Interview UI/UX Designer', 1, '13:00', '14:00', 'bromo', [2, 16], { candidate: 'Bima Aditya', candidateId: cid('Bima Aditya') });
  ev('interview', 'Interview Finance Staff', 2, '09:30', '10:30', 'semeru', [2, 7], { candidate: 'Kartika Sari', candidateId: cid('Kartika Sari') });
  ev('interview', 'Interview Backend Developer', 3, '14:00', '15:00', 'merapi', [2, 4, 6], { candidate: 'Rafi Maulana', candidateId: cid('Rafi Maulana') });
  ev('training', 'Data Privacy Awareness (UU PDP)', 3, '13:00', '15:00', 'krakatau', [3], { ownerId: 3, attendees: 25 });
  ev('interview', 'Interview Content Specialist', 4, '10:00', '11:00', 'bromo', [2, 10], { candidate: 'Nabila Putri', candidateId: cid('Nabila Putri') });
  ev('company', 'Town Hall Q4', 4, '16:00', '17:00', 'aula', [1], { allHands: true, ownerId: 1, attendees: 17 });
  ev('training', 'Onboarding Karyawan Baru', 7, '09:00', '12:00', 'rinjani', [3], { ownerId: 3, attendees: 6 });
  ev('interview', 'Interview Logistics Coordinator', 8, '10:00', '11:00', 'semeru', [2, 13], { candidate: 'Yoga Permana', candidateId: cid('Yoga Permana') });
  ev('training', 'Excel untuk Analisis Data', 9, '09:00', '12:00', 'krakatau', [3], { ownerId: 3, attendees: 12 });
  ev('interview', 'Interview Digital Marketer', 9, '11:00', '12:00', 'bromo', [2, 10], { candidate: 'Lintang Maharani', candidateId: cid('Lintang Maharani') });
  ev('interview', 'Interview Lanjutan Frontend Developer', 10, '15:00', '16:00', 'merapi', [1, 4], { candidate: 'Alya Rahmawati', candidateId: cid('Alya Rahmawati') });
  ev('training', 'K3 Dasar untuk Operations', 11, '13:00', '16:00', 'krakatau', [3], { ownerId: 3, attendees: 10 });
  ev('training', 'Leadership Essentials', 15, '09:00', '17:00', 'rinjani', [3], { ownerId: 3, attendees: 8 });
  ev('company', 'Gathering Akhir Tahun', 18, '10:00', '15:00', 'aula', [3], { allHands: true, ownerId: 3, attendees: 17 });
  ev('interview', 'Interview Marketing Manager', -3, '10:00', '11:30', 'merapi', [1, 10], { candidate: 'Gita Paramitha', candidateId: cid('Gita Paramitha') });
  ev('training', 'Etika Kerja Profesional', -4, '13:00', '15:00', 'krakatau', [3], { ownerId: 3, attendees: 15 });

  const insLeave = db.prepare('INSERT INTO leaves (employee_id,type,start_date,end_date,reason,status,decided_by,note,submitted_by) VALUES (?,?,?,?,?,?,?,?,17)');
  insLeave.run(5, 'tahunan', D(7), D(9), 'Pulang kampung', 'approved', 1, '');
  insLeave.run(14, 'tahunan', D(14), D(18), 'Liburan keluarga', 'approved', 1, '');
  insLeave.run(6, 'tahunan', D(-6), D(-5), 'Urusan pribadi', 'approved', 1, '');
  insLeave.run(15, 'sakit', D(2), D(2), 'Demam, surat dokter terlampir', 'approved', 1, '');
  insLeave.run(11, 'tahunan', D(8), D(10), 'Acara pernikahan saudara', 'pending', null, '');
  insLeave.run(9, 'tahunan', D(10), D(11), 'Mengurus dokumen keluarga', 'pending', null, '');
  insLeave.run(16, 'izin', D(11), D(11), 'Keperluan keluarga', 'pending', null, '');
  insLeave.run(12, 'tahunan', D(3), D(4), 'Ikut acara komunitas', 'rejected', 1, 'Bentrok dengan training Data Privacy Awareness');
}

module.exports = { seed, emailOf, DEMO_PASSWORD, PEOPLE, ACCOUNTS };

if (require.main === module) {
  const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'hr.db');
  const db = openDb(file);
  seed(db);
  console.log(`Database diisi ulang: ${file}`);
  console.log(`Login demo: indah@gnaascend.test (Admin HR) atau agna@gnaascend.test (Manager HR) / ${DEMO_PASSWORD}`);
}
