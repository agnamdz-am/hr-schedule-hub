const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/recruit');
const { startApp, loginAs, D } = require('./helpers');

/* ---------- Aturan murni ---------- */
const admin = { id: 17, role: 'admin' };
const hrm = { id: 1, role: 'hr_manager' };
const job = { id: 1, openings: 1, status: 'open' };
const ev = (stage, score = 4, recommend = 'lanjut', interviewerId = 2) => ({ stage, score, recommend, interviewerId });
const move = (actor, stage, to, extra = {}) => R.checkMove(actor, { id: 1, stage }, to, { job, evaluations: [], hiredCount: 0, ...extra });

test('tahapan harus berurutan dan hanya Admin HR yang memindahkan sampai Penawaran', () => {
  assert.deepEqual(move(admin, 'applied', 'screening'), []);
  assert.match(move(admin, 'applied', 'interview_hr')[0], /berurutan/);
  assert.match(move(hrm, 'applied', 'screening')[0], /Admin HR/);
});

test('ke Interview User butuh penilaian Interview HR yang merekomendasikan lanjut', () => {
  assert.match(move(admin, 'interview_hr', 'interview_user')[0], /Interview HR/);
  assert.match(move(admin, 'interview_hr', 'interview_user', { evaluations: [ev('interview_hr', 4, 'tidak')] })[0], /Interview HR/);
  assert.deepEqual(move(admin, 'interview_hr', 'interview_user', { evaluations: [ev('interview_hr')] }), []);
});

test('ke Penawaran butuh penilaian Interview User dan rata-rata skor minimal 3', () => {
  assert.ok(move(admin, 'interview_user', 'offer', { evaluations: [ev('interview_hr')] }).length > 0);
  const low = move(admin, 'interview_user', 'offer', { evaluations: [ev('interview_hr', 2), ev('interview_user', 3)] });
  assert.match(low.join(' '), /di bawah 3/);
  assert.deepEqual(move(admin, 'interview_user', 'offer', { evaluations: [ev('interview_hr', 3), ev('interview_user', 3)] }), []);
});

test('penawaran hanya diputuskan Manager HR dan dibatasi kuota lowongan', () => {
  assert.match(move(admin, 'offer', 'hired')[0], /Manager HR/);
  assert.deepEqual(move(hrm, 'offer', 'hired'), []);
  assert.match(move(hrm, 'offer', 'hired', { hiredCount: 1 })[0], /Kuota/);
  assert.match(move(hrm, 'offer', 'hired', { job: { ...job, status: 'closed' } })[0], /ditutup/);
});

test('menolak kandidat wajib beralasan, dan penawaran hanya bisa ditolak Manager HR', () => {
  assert.match(move(admin, 'screening', 'rejected', { reason: ' ' })[0], /Alasan/);
  assert.deepEqual(move(admin, 'screening', 'rejected', { reason: 'Tidak sesuai kebutuhan' }), []);
  assert.ok(move(admin, 'offer', 'rejected', { reason: 'Gaji tidak cocok' }).length > 0);
  assert.deepEqual(move(hrm, 'offer', 'rejected', { reason: 'Gaji tidak cocok' }), []);
  assert.match(move(admin, 'hired', 'rejected', { reason: 'abc' })[0], /final/);
});

test('penilaian: hanya Admin HR, pewawancara terdaftar, tahap interview, satu kali per tahap, skor 1 sampai 5', () => {
  const cand = { id: 1, stage: 'interview_hr' };
  const input = { interviewerId: 2, score: 4, recommend: 'lanjut' };
  const check = (c, i, evals, ids, actor = admin) => R.checkEvaluation(actor, c, i, evals, ids);
  assert.deepEqual(check(cand, input, [], [2, 4]), []);
  assert.match(check(cand, input, [], [2, 4], hrm)[0], /Admin HR/);
  assert.match(check(cand, { ...input, interviewerId: 9 }, [], [2, 4])[0], /jadwal interview/);
  assert.match(check(cand, input, [ev('interview_hr')], [2, 4])[0], /sudah dinilai/);
  assert.ok(check(cand, { ...input, score: 6 }, [], [2]).length);
  assert.ok(check(cand, { ...input, recommend: 'mungkin' }, [], [2]).length);
  assert.match(check({ id: 1, stage: 'screening' }, input, [], [2])[0], /tahap interview/);
});

/* ---------- API ---------- */
let app;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.close(); });

const candId = (name) => app.db.prepare('SELECT id FROM candidates WHERE name = ?').get(name).id;
const stageOf = (name) => app.db.prepare('SELECT stage FROM candidates WHERE name = ?').get(name).stage;

test('semua data rekrutmen hanya bisa dilihat akun HR (login wajib)', async () => {
  assert.equal((await fetch(`${app.base}/api/recruit`)).status, 401);
  for (const email of ['agna@gnaascend.test', 'indah@gnaascend.test']) {
    const r = (await (await loginAs(app.base, email))('GET', '/api/recruit')).data;
    assert.equal(r.candidates.length, 12);
    assert.ok(r.candidates[0].email);
    assert.equal(r.evaluations.length, 3);
    assert.equal(r.evaluations[0].recordedBy, 17);
  }
});

test('hanya Admin HR yang menambah lowongan dan kandidat; duplikat dan lowongan tutup ditolak', async () => {
  const agna = await loginAs(app.base, 'agna@gnaascend.test');
  assert.equal((await agna('POST', '/api/recruit/candidates', { jobId: 1, name: 'Tes Baru', email: 'tes@mail.example' })).status, 403);
  assert.equal((await agna('POST', '/api/recruit/jobs', { title: 'X', division: 'IT', openings: 1 })).status, 403);

  const indah = await loginAs(app.base, 'indah@gnaascend.test');
  const job = await indah('POST', '/api/recruit/jobs', { title: 'Data Analyst', division: 'IT', openings: 2 });
  assert.equal(job.status, 201);
  const body = { jobId: job.data.job.id, name: 'Kandidat Baru', email: 'Baru@Mail.example' };
  assert.equal((await indah('POST', '/api/recruit/candidates', body)).status, 201);
  const dup = await indah('POST', '/api/recruit/candidates', { ...body, email: 'baru@mail.example' });
  assert.equal(dup.status, 409);
  assert.match(dup.data.error, /sudah melamar/);
  assert.equal((await indah('POST', '/api/recruit/candidates', { ...body, email: 'bukan-email' })).status, 400);
  assert.equal((await indah('POST', '/api/recruit/jobs', { title: 'Y', division: 'IT', openings: 0 })).status, 400);
});

test('tahap tidak bisa dilompati dan syarat penilaian ditegakkan server', async () => {
  const indah = await loginAs(app.base, 'indah@gnaascend.test');
  const bima = candId('Bima Aditya'); // tahap Interview HR, belum ada penilaian
  const skip = await indah('POST', `/api/recruit/candidates/${bima}/move`, { to: 'offer' });
  assert.equal(skip.status, 409);
  const noEval = await indah('POST', `/api/recruit/candidates/${bima}/move`, { to: 'interview_user' });
  assert.equal(noEval.status, 409);
  assert.match(noEval.data.error, /penilaian Interview HR/);
  assert.equal(stageOf('Bima Aditya'), 'interview_hr');

  const noReason = await indah('POST', `/api/recruit/candidates/${candId('Dina Larasati')}/move`, { to: 'rejected' });
  assert.equal(noReason.status, 409);
  const ok = await indah('POST', `/api/recruit/candidates/${candId('Dina Larasati')}/move`, { to: 'rejected', reason: 'Portofolio belum sesuai' });
  assert.equal(ok.status, 200);
  assert.equal(stageOf('Dina Larasati'), 'rejected');
  assert.equal((await indah('POST', `/api/recruit/candidates/${candId('Dina Larasati')}/move`, { to: 'screening' })).status, 409);
});

test('alur lengkap: penilaian atas nama pewawancara, ke Penawaran, persetujuan Manager HR, lowongan otomatis tutup', async () => {
  const alya = candId('Alya Rahmawati'); // tahap Interview User, pewawancara terdaftar: Dimas(2), Bagas(4), Nanda(5), Agna(1)
  const indah = await loginAs(app.base, 'indah@gnaascend.test');
  const agna = await loginAs(app.base, 'agna@gnaascend.test');
  const evalUrl = `/api/recruit/candidates/${alya}/evaluations`;

  // belum ada penilaian Interview User
  assert.equal((await indah('POST', `/api/recruit/candidates/${alya}/move`, { to: 'offer' })).status, 409);
  // Manager HR bukan pengisi penilaian
  assert.equal((await agna('POST', evalUrl, { interviewerId: 4, score: 5, recommend: 'lanjut' })).status, 403);
  // pewawancara yang tidak ada di jadwal interview kandidat ini ditolak
  assert.equal((await indah('POST', evalUrl, { interviewerId: 11, score: 5, recommend: 'lanjut' })).status, 409);
  // skor tidak valid
  assert.equal((await indah('POST', evalUrl, { interviewerId: 4, score: 9, recommend: 'lanjut' })).status, 409);

  const ev1 = await indah('POST', evalUrl, { interviewerId: 4, score: 4, recommend: 'lanjut', note: 'Teknis kuat.' });
  assert.equal(ev1.status, 201);
  const saved = ev1.data.evaluations.find((e) => e.interviewerId === 4 && e.stage === 'interview_user');
  assert.equal(saved.recordedBy, 17);
  assert.equal((await indah('POST', evalUrl, { interviewerId: 4, score: 5, recommend: 'lanjut' })).status, 409); // sekali per pewawancara per tahap

  assert.equal((await indah('POST', `/api/recruit/candidates/${alya}/move`, { to: 'offer' })).status, 200);
  // Admin HR tidak boleh memutuskan penawaran, Manager HR yang memutuskan
  assert.equal((await indah('POST', `/api/recruit/candidates/${alya}/move`, { to: 'hired' })).status, 409);
  assert.equal((await indah('POST', `/api/recruit/candidates/${alya}/move`, { to: 'rejected', reason: 'Tidak jadi' })).status, 409);
  const hired = await agna('POST', `/api/recruit/candidates/${alya}/move`, { to: 'hired' });
  assert.equal(hired.status, 200);
  assert.equal(hired.data.job.status, 'closed'); // kuota 1 terpenuhi

  const late = await indah('POST', '/api/recruit/candidates', { jobId: 1, name: 'Terlambat', email: 'terlambat@mail.example' });
  assert.equal(late.status, 409);
  assert.match(late.data.error, /ditutup/);
});

test('jadwal interview ditautkan ke kandidat terdaftar, nama diambil dari data kandidat, peserta = pewawancara + kandidat', async () => {
  const indah = await loginAs(app.base, 'indah@gnaascend.test');
  const body = { type: 'interview', title: 'Interview Lanjutan', date: D(2), start: '16:00', end: '17:00', room: 'rinjani', people: [5, 6] };
  const ok = await indah('POST', '/api/events', { ...body, candidate: 'Nama Palsu', candidateId: candId('Bima Aditya') });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.event.candidate, 'Bima Aditya');
  assert.equal(ok.data.event.attendees, 3);
  const bad = await indah('POST', '/api/events', { ...body, start: '17:30', end: '18:00', candidateId: 99999 });
  assert.equal(bad.status, 400);
  // Nanda kini tercatat sebagai pewawancara Bima, jadi bisa dinilai atas namanya
  const evl = await indah('POST', `/api/recruit/candidates/${candId('Bima Aditya')}/evaluations`, { interviewerId: 5, score: 4, recommend: 'lanjut' });
  assert.equal(evl.status, 201);
});
