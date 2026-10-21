const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, loadCtx } = require('../src/db');
const { seed } = require('../src/seed');
const L = require('../src/logic');
const { D } = require('./helpers');

const db = openDb(':memory:');
seed(db);
const ctx = loadCtx(db);
const ev = (o) => ({ type: 'interview', title: 'Tes', room: 'bromo', allHands: false, people: [], attendees: 2, ...o });

test('data seed tidak punya jadwal yang bentrok satu sama lain', () => {
  for (const e of ctx.events) assert.deepEqual(L.checkEvent(e, ctx, e.id), [], e.title);
});

test('orang yang sama tidak bisa dijadwalkan dua kali di jam yang beririsan', () => {
  // Bagas ada interview Selasa 10:00-11:00
  const issues = L.checkEvent(ev({ date: D(1), start: '10:30', end: '11:30', people: [4] }), ctx);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'person');
  assert.match(issues[0].msg, /Bagas/);
});

test('penanggung jawab acara juga dicek bentrok', () => {
  // Ayu (id 3) penanggung jawab Data Privacy Kamis 13:00-15:00
  const issues = L.checkEvent(ev({ type: 'training', date: D(3), start: '14:00', end: '15:00', room: 'aula', people: [3], attendees: 10 }), ctx);
  assert.deepEqual(issues.map((i) => i.kind), ['person']);
  assert.match(issues[0].msg, /Ayu Lestari/);
});

test('ruangan yang sama tidak bisa dipakai dua kali di jam yang beririsan', () => {
  const issues = L.checkEvent(ev({ date: D(1), start: '10:00', end: '11:00', room: 'merapi', people: [3] }), ctx);
  assert.deepEqual(issues.map((i) => i.kind), ['room']);
});

test('jadwal yang berurutan tanpa jeda tidak dianggap bentrok', () => {
  assert.deepEqual(L.checkEvent(ev({ date: D(1), start: '11:00', end: '12:00', room: 'merapi', people: [4] }), ctx), []);
  assert.deepEqual(L.checkEvent(ev({ date: D(1), start: '09:00', end: '10:00', room: 'merapi', people: [4] }), ctx), []);
});

test('pewawancara atau penanggung jawab yang sedang cuti disetujui tidak bisa dijadwalkan', () => {
  // Nanda cuti D(7)-D(9)
  const issues = L.checkEvent(ev({ date: D(8), start: '13:00', end: '14:00', people: [5] }), ctx);
  assert.deepEqual(issues.map((i) => i.kind), ['leave']);
});

test('kapasitas ruangan dihitung dari jumlah peserta', () => {
  const issues = L.checkEvent(ev({ type: 'training', date: D(2), start: '15:00', end: '16:00', room: 'semeru', people: [3], attendees: 7 }), ctx);
  assert.ok(issues.some((i) => /hanya muat 6 orang, sedangkan peserta 7 orang/.test(i.msg)));
  assert.deepEqual(L.checkEvent(ev({ type: 'training', date: D(2), start: '15:00', end: '16:00', room: 'semeru', people: [3], attendees: 6 }), ctx), []);
});

test('acara seluruh karyawan dihitung sebanyak karyawan aktif', () => {
  assert.equal(L.activeCount(ctx), 17);
  const issues = L.checkEvent(ev({ type: 'company', date: D(2), start: '15:00', end: '16:00', room: 'rinjani', people: [3], allHands: true, attendees: undefined }), ctx);
  assert.deepEqual(issues, []); // 17 <= 20
  const small = L.checkEvent(ev({ type: 'company', date: D(2), start: '15:00', end: '16:00', room: 'merapi', people: [3], allHands: true, attendees: undefined }), ctx);
  assert.ok(small.some((i) => /sedangkan peserta 17 orang/.test(i.msg)));
});

test('jumlah peserta wajib diisi', () => {
  assert.match(L.checkEvent(ev({ date: D(2), start: '10:00', end: '11:00', people: [1], attendees: 0 }), ctx)[0].msg, /jumlah peserta/i);
});

test('jam selesai harus setelah jam mulai', () => {
  assert.match(L.checkEvent(ev({ date: D(2), start: '11:00', end: '10:00', people: [1] }), ctx)[0].msg, /setelah jam mulai/);
});

test('mengubah jadwal tidak bentrok dengan dirinya sendiri', () => {
  const e = ctx.events.find((x) => x.title === 'Interview Frontend Developer');
  assert.deepEqual(L.checkEvent({ ...e, end: '11:30' }, ctx, e.id), []);
});

test('hari kerja tidak menghitung Sabtu dan Minggu', () => {
  assert.equal(L.workdays(D(0), D(6)), 5);
  assert.equal(L.workdays(D(5), D(6)), 0);
  assert.equal(L.workdays(D(4), D(7)), 2); // Jumat dan Senin
});

test('sisa cuti tahunan memperhitungkan yang sudah terpakai dan yang masih menunggu', () => {
  assert.equal(L.remaining(11, ctx, null, false), 8); // Salsa: 12 - 4
  assert.equal(L.remaining(11, ctx, null, true), 5); // 3 hari menunggu
});

test('pengajuan melebihi sisa cuti ditolak, pesan menyebut nama karyawan', () => {
  const r = L.checkLeave({ employeeId: 11, type: 'tahunan', start: D(21), end: D(35) }, ctx);
  assert.ok(r.errors.some((e) => /Sisa cuti tahunan Salsa Nuraini/.test(e)));
});

test('cuti sakit tidak memotong kuota tahunan', () => {
  assert.deepEqual(L.checkLeave({ employeeId: 11, type: 'sakit', start: D(21), end: D(35) }, ctx).errors, []);
});

test('satu divisi tidak boleh cuti bersamaan', () => {
  // Nanda (IT) sudah disetujui D(7)-D(9), Citra (IT) minta D(8)
  const r = L.checkLeave({ employeeId: 16, type: 'tahunan', start: D(8), end: D(8) }, ctx);
  assert.ok(r.errors.some((e) => /divisi yang sama/.test(e)));
});

test('cuti hanya akhir pekan ditolak', () => {
  assert.ok(L.checkLeave({ employeeId: 11, type: 'izin', start: D(12), end: D(13) }, ctx).errors.some((e) => /akhir pekan/.test(e)));
});

test('karyawan nonaktif tidak bisa diajukan cuti', () => {
  const c = { ...ctx, people: ctx.people.map((p) => (p.id === 15 ? { ...p, active: false } : p)) };
  assert.ok(L.checkLeave({ employeeId: 15, type: 'izin', start: D(21), end: D(21) }, c).errors.some((e) => /tidak aktif/.test(e)));
});

test('cuti non-sakit tidak boleh di masa lalu bila hari ini diketahui', () => {
  const c = { ...ctx, today: D(3) };
  assert.ok(L.checkLeave({ employeeId: 11, type: 'izin', start: D(2), end: D(2) }, c).errors.some((e) => /sebelum hari ini/.test(e)));
  assert.deepEqual(L.checkLeave({ employeeId: 11, type: 'sakit', start: D(2), end: D(2) }, c).errors, []);
});

test('pengajuan menampilkan peringatan bila karyawan terjadwal di kegiatan lain', () => {
  const r = L.checkLeave({ employeeId: 4, type: 'izin', start: D(1), end: D(1) }, ctx); // Bagas, Selasa ada interview
  assert.ok(r.warnings.length >= 1);
});

test('siapa yang boleh menyetujui cuti', () => {
  const pending = ctx.leaves.find((l) => l.employeeId === 11 && l.status === 'pending'); // Salsa
  const by = (id) => ctx.people.find((p) => p.id === id);
  assert.equal(L.canApprove(by(1), pending, ctx), true); // Manager HR
  assert.equal(L.canApprove(by(17), pending, ctx), false); // Admin HR tidak menyetujui cuti karyawan
  assert.equal(L.canApprove(by(10), pending, ctx), false); // manager divisi tidak punya akun/peran
  assert.equal(L.canApprove(by(1), { ...pending, employeeId: 1 }, ctx), false); // tidak menyetujui cuti sendiri
  assert.equal(L.canApprove(by(17), { ...pending, employeeId: 1 }, ctx), true); // cuti Manager HR diproses Admin HR
  assert.equal(L.canApprove(by(17), { ...pending, employeeId: 17 }, ctx), false);
});
