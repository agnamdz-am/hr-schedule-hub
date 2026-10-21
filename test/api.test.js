const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, loginAs, D } = require('./helpers');

let app;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.close(); });

const ev = (o) => ({ type: 'interview', title: 'Interview Tes', date: D(1), start: '11:00', end: '12:00', room: 'merapi', people: [4], ...o });
const trn = (o) => ({ type: 'training', title: 'Training Tes', date: D(5), start: '10:00', end: '12:00', room: 'rinjani', ownerId: 3, attendees: 10, ...o });
const countEvents = () => app.ctx().events.length;

test('endpoint data menolak permintaan tanpa login', async () => {
  const r = await fetch(`${app.base}/api/bootstrap`);
  assert.equal(r.status, 401);
});

test('login gagal dengan password salah', async () => {
  const r = await fetch(`${app.base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'indah@gnaascend.test', password: 'salah' }),
  });
  assert.equal(r.status, 401);
});

test('login berhasil memberi cookie httpOnly dan data awal', async () => {
  const res = await fetch(`${app.base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'indah@gnaascend.test', password: 'password123' }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.getSetCookie()[0], /HttpOnly/i);
  const call = await loginAs(app.base, 'indah@gnaascend.test');
  const { status, data } = await call('GET', '/api/bootstrap');
  assert.equal(status, 200);
  assert.equal(data.me.role, 'admin');
  assert.equal(data.people.length, 17);
  assert.equal(data.rooms.length, 6);
  assert.ok(data.events.length >= 18);
  assert.equal(data.me.password_hash, undefined);
});

test('hanya Admin HR yang membuat jadwal; Manager HR ditolak', async () => {
  const before = countEvents();
  assert.equal((await (await loginAs(app.base, 'agna@gnaascend.test'))('POST', '/api/events', ev())).status, 403);
  assert.equal(countEvents(), before);
});

test('daftar demo hanya berisi dua akun HR dan karyawan biasa tidak bisa login', async () => {
  const d = await (await fetch(`${app.base}/api/auth/demo`)).json();
  assert.deepEqual(d.accounts.map((a) => a.role), ['hr_manager', 'admin']);
  const r = await fetch(`${app.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'salsa@gnaascend.test', password: 'password123' }) });
  assert.equal(r.status, 401);
});

test('admin ditolak saat menjadwalkan pewawancara yang sudah punya jadwal, dan tidak ada data yang tersimpan', async () => {
  const call = await loginAs(app.base, 'indah@gnaascend.test');
  const before = countEvents();
  const r = await call('POST', '/api/events', ev({ start: '10:30', end: '11:30', room: 'bromo' }));
  assert.equal(r.status, 409);
  assert.match(r.data.conflicts[0].msg, /Bagas Wicaksono sudah ada jadwal/);
  assert.equal(countEvents(), before);
});

test('admin bisa membuat, mengubah, dan menghapus jadwal yang tidak bentrok', async () => {
  const call = await loginAs(app.base, 'indah@gnaascend.test');
  const created = await call('POST', '/api/events', ev());
  assert.equal(created.status, 201);
  const id = created.data.event.id;
  assert.deepEqual(created.data.event.people, [4]);

  const updated = await call('PUT', `/api/events/${id}`, ev({ title: 'Interview Tes (diubah)', end: '12:30' }));
  assert.equal(updated.status, 200);
  assert.equal(updated.data.event.title, 'Interview Tes (diubah)');
  assert.equal(updated.data.event.end, '12:30');

  assert.equal((await call('DELETE', `/api/events/${id}`)).status, 200);
  assert.equal((await call('DELETE', `/api/events/${id}`)).status, 404);
});

test('training: penanggung jawab dan jumlah peserta; kapasitas ruang dan bentrok penanggung jawab dicek', async () => {
  const call = await loginAs(app.base, 'indah@gnaascend.test');
  const ok = await call('POST', '/api/events', trn());
  assert.equal(ok.status, 201);
  assert.equal(ok.data.event.ownerId, 3);
  assert.equal(ok.data.event.attendees, 10);
  assert.deepEqual(ok.data.event.people, [3]);
  const big = await call('POST', '/api/events', trn({ start: '14:00', end: '15:00', attendees: 25 }));
  assert.equal(big.status, 409);
  assert.match(big.data.conflicts[0].msg, /hanya muat 20 orang, sedangkan peserta 25 orang/);
  const clash = await call('POST', '/api/events', trn({ room: 'krakatau', start: '11:00', end: '13:00' }));
  assert.equal(clash.status, 409);
  assert.match(clash.data.conflicts.map((c) => c.msg).join(' '), /Ayu Lestari sudah ada jadwal/);
  assert.equal((await call('POST', '/api/events', trn({ ownerId: undefined }))).status, 400);
  assert.equal((await call('POST', '/api/events', trn({ attendees: 0 }))).status, 400);
});

test('input jadwal yang tidak valid ditolak dengan 400', async () => {
  const call = await loginAs(app.base, 'indah@gnaascend.test');
  assert.equal((await call('POST', '/api/events', ev({ date: '2026-02-31' }))).status, 400);
  assert.equal((await call('POST', '/api/events', ev({ start: '25:00' }))).status, 400);
  assert.equal((await call('POST', '/api/events', ev({ room: 'tidak-ada' }))).status, 400);
  assert.equal((await call('POST', '/api/events', ev({ people: [9999] }))).status, 400);
  assert.equal((await call('POST', '/api/events', ev({ people: [] }))).status, 400);
  assert.equal((await call('POST', '/api/events', ev({ title: '   ' }))).status, 400);
});

const leaveBody = (o) => ({ employeeId: 11, type: 'tahunan', start: D(21), end: D(21), reason: 'Dicatat HR', ...o });

test('pengajuan cuti melebihi sisa kuota ditolak server', async () => {
  const call = await loginAs(app.base, 'indah@gnaascend.test');
  const r = await call('POST', '/api/leaves', leaveBody({ start: D(21), end: D(35) }));
  assert.equal(r.status, 409);
  assert.match(r.data.errors.join(' '), /Sisa cuti tahunan Salsa Nuraini/);
});

test('cuti tahunan tidak boleh diajukan untuk tanggal yang sudah lewat, cuti sakit boleh', async () => {
  const call = await loginAs(app.base, 'indah@gnaascend.test');
  const past = D(-14);
  assert.equal((await call('POST', '/api/leaves', leaveBody({ employeeId: 8, start: past, end: past }))).status, 409);
  assert.equal((await call('POST', '/api/leaves', leaveBody({ employeeId: 8, type: 'sakit', start: past, end: past, reason: 'Demam' }))).status, 201);
});

test('Admin HR mengajukan cuti atas nama karyawan terdaftar; tercatat pengajunya', async () => {
  const indah = await loginAs(app.base, 'indah@gnaascend.test');
  const made = await indah('POST', '/api/leaves', leaveBody());
  assert.equal(made.status, 201);
  assert.equal(made.data.leave.employeeId, 11);
  assert.equal(made.data.leave.submittedBy, 17);
  assert.equal(made.data.leave.status, 'pending');
  // pengajuan ganda di tanggal yang sama menyebut nama karyawannya
  const dup = await indah('POST', '/api/leaves', leaveBody());
  assert.equal(dup.status, 409);
  assert.match(dup.data.error, /Salsa Nuraini sudah punya pengajuan/);
});

test('hanya Admin HR yang mengajukan cuti; karyawan harus terdaftar dan aktif', async () => {
  assert.equal((await (await loginAs(app.base, 'agna@gnaascend.test'))('POST', '/api/leaves', leaveBody({ start: D(22), end: D(22) }))).status, 403);
  const indah = await loginAs(app.base, 'indah@gnaascend.test');
  assert.equal((await indah('POST', '/api/leaves', leaveBody({ employeeId: 9999, start: D(22), end: D(22) }))).status, 400);
  assert.equal((await indah('POST', '/api/leaves', leaveBody({ employeeId: '11', start: D(22), end: D(22) }))).status, 400);
  assert.equal((await indah('POST', '/api/leaves', leaveBody({ employeeId: undefined, start: D(22), end: D(22) }))).status, 400);
});

test('persetujuan cuti semuanya lewat Manager HR; Admin HR ditolak', async () => {
  const salsa = app.ctx().leaves.find((l) => l.employeeId === 11 && l.status === 'pending');
  const indah = await loginAs(app.base, 'indah@gnaascend.test');
  const agna = await loginAs(app.base, 'agna@gnaascend.test');
  assert.equal((await indah('POST', `/api/leaves/${salsa.id}/approve`)).status, 403);
  assert.equal((await indah('POST', `/api/leaves/${salsa.id}/reject`)).status, 403);

  // Rizky (Marketing) diajukan di tanggal yang beririsan. Boleh diajukan karena cuti Salsa belum disetujui.
  const rizky = await indah('POST', '/api/leaves', leaveBody({ employeeId: 12, start: D(9), end: D(9), reason: 'Urusan keluarga' }));
  assert.equal(rizky.status, 201);

  const ok = await agna('POST', `/api/leaves/${salsa.id}/approve`);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.leave.status, 'approved');
  assert.equal(ok.data.leave.by, 1);

  // sekarang cuti Rizky bentrok dengan Salsa di divisi yang sama
  const clash = await agna('POST', `/api/leaves/${rizky.data.leave.id}/approve`);
  assert.equal(clash.status, 409);
  assert.match(clash.data.error, /divisi yang sama/);
  assert.equal((await agna('POST', `/api/leaves/${salsa.id}/approve`)).status, 409); // sudah diputuskan

  const rej = await agna('POST', `/api/leaves/${rizky.data.leave.id}/reject`, { note: 'Bentrok dengan Salsa' });
  assert.equal(rej.status, 200);
  assert.equal(rej.data.leave.status, 'rejected');
  assert.equal(rej.data.leave.note, 'Bentrok dengan Salsa');
});

test('cuti Manager HR diproses Admin HR, dan Manager HR tidak bisa menyetujui cutinya sendiri', async () => {
  const indah = await loginAs(app.base, 'indah@gnaascend.test');
  const agna = await loginAs(app.base, 'agna@gnaascend.test');
  const made = await indah('POST', '/api/leaves', leaveBody({ employeeId: 1, type: 'izin', start: D(23), end: D(23) }));
  assert.equal(made.status, 201);
  const id = made.data.leave.id;
  assert.equal((await agna('POST', `/api/leaves/${id}/approve`)).status, 403);
  const ok = await indah('POST', `/api/leaves/${id}/approve`);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.leave.by, 17);
});

test('body bukan JSON mendapat 400, endpoint tak dikenal 404', async () => {
  const r = await fetch(`${app.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{rusak' });
  assert.equal(r.status, 400);
  assert.equal((await fetch(`${app.base}/api/tidak-ada`)).status, 404);
});

test('logout memerintahkan browser menghapus cookie sesi', async () => {
  const out = await fetch(`${app.base}/api/auth/logout`, { method: 'POST' });
  assert.equal(out.status, 200);
  assert.match(out.headers.getSetCookie().join(';'), /hr_token=;/);
});

/* ---------- Karyawan ---------- */
test('Admin HR menambah karyawan; langsung muncul di data awal dan bisa dipilih di form', async () => {
  const indah = await loginAs(app.base, 'indah@gnaascend.test');
  const made = await indah('POST', '/api/employees', { name: 'Tari Wulandari', div: 'Finance', title: 'Auditor', quota: 12 });
  assert.equal(made.status, 201);
  const id = made.data.person.id;
  assert.equal(made.data.person.active, true);
  assert.equal(made.data.person.role, null);
  assert.ok((await indah('GET', '/api/bootstrap')).data.people.some((p) => p.id === id));
  assert.equal((await indah('POST', '/api/leaves', leaveBody({ employeeId: id, start: D(24), end: D(24) }))).status, 201);
});

test('karyawan: validasi, hak akses, nonaktif menyembunyikan dari pilihan tetapi riwayat tetap ada', async () => {
  const indah = await loginAs(app.base, 'indah@gnaascend.test');
  const agna = await loginAs(app.base, 'agna@gnaascend.test');
  assert.equal((await agna('POST', '/api/employees', { name: 'Tes Tes', div: 'IT', title: 'Dev' })).status, 403);
  assert.equal((await indah('POST', '/api/employees', { name: 'T', div: 'IT', title: 'Dev' })).status, 400);
  assert.equal((await indah('POST', '/api/employees', { name: 'Tes Tes', div: 'Legal', title: 'Dev' })).status, 400);

  // Eko (15) punya cuti sakit di riwayat; dinonaktifkan
  const off = await indah('PUT', '/api/employees/15', { name: 'Eko Saputra', div: 'Operations', title: 'Warehouse Supervisor', quota: 12, active: false });
  assert.equal(off.status, 200);
  assert.equal(off.data.person.active, false);
  assert.ok(app.ctx().leaves.some((l) => l.employeeId === 15)); // riwayat tetap
  assert.equal((await indah('POST', '/api/leaves', leaveBody({ employeeId: 15, start: D(25), end: D(25) }))).status, 409);
  assert.equal((await indah('POST', '/api/events', trn({ ownerId: 15, start: '15:00', end: '16:00', date: D(6) }))).status, 400);

  // yang punya akun login tidak boleh dinonaktifkan
  assert.equal((await indah('PUT', '/api/employees/17', { name: 'Indah Permatasari', div: 'HR', title: 'Assistant HR Manager', active: false })).status, 409);
  assert.equal((await indah('PUT', '/api/employees/9999', { name: 'Tes Tes', div: 'IT', title: 'Dev' })).status, 404);
});
