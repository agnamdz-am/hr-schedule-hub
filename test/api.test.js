const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, loginAs, D } = require('./helpers');

let app;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.close(); });

const ev = (o) => ({ type: 'interview', title: 'Interview Tes', date: D(1), start: '11:00', end: '12:00', room: 'merapi', people: [4], candidate: 'Kandidat Fiktif', ...o });
const countEvents = () => app.ctx().events.length;

test('endpoint data menolak permintaan tanpa login', async () => {
  const r = await fetch(`${app.base}/api/bootstrap`);
  assert.equal(r.status, 401);
});

test('login gagal dengan password salah', async () => {
  const r = await fetch(`${app.base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'rina@gnaascend.test', password: 'salah' }),
  });
  assert.equal(r.status, 401);
});

test('login berhasil memberi cookie httpOnly dan data awal', async () => {
  const res = await fetch(`${app.base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'rina@gnaascend.test', password: 'password123' }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.getSetCookie()[0], /HttpOnly/i);
  const call = await loginAs(app.base, 'rina@gnaascend.test');
  const { status, data } = await call('GET', '/api/bootstrap');
  assert.equal(status, 200);
  assert.equal(data.me.role, 'admin');
  assert.equal(data.people.length, 16);
  assert.equal(data.rooms.length, 6);
  assert.ok(data.events.length >= 18);
  assert.equal(data.me.password_hash, undefined);
});

test('karyawan biasa tidak boleh membuat jadwal', async () => {
  const call = await loginAs(app.base, 'salsa@gnaascend.test');
  const before = countEvents();
  const r = await call('POST', '/api/events', ev());
  assert.equal(r.status, 403);
  assert.equal(countEvents(), before);
});

test('admin ditolak saat menjadwalkan orang yang sudah punya jadwal, dan tidak ada data yang tersimpan', async () => {
  const call = await loginAs(app.base, 'rina@gnaascend.test');
  const before = countEvents();
  const r = await call('POST', '/api/events', ev({ start: '10:30', end: '11:30', room: 'bromo' }));
  assert.equal(r.status, 409);
  assert.match(r.data.conflicts[0].msg, /Bagas Wicaksono sudah ada jadwal/);
  assert.equal(countEvents(), before);
});

test('admin bisa membuat, mengubah, dan menghapus jadwal yang tidak bentrok', async () => {
  const call = await loginAs(app.base, 'rina@gnaascend.test');
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

test('input jadwal yang tidak valid ditolak dengan 400', async () => {
  const call = await loginAs(app.base, 'rina@gnaascend.test');
  assert.equal((await call('POST', '/api/events', ev({ date: '2026-02-31' }))).status, 400);
  assert.equal((await call('POST', '/api/events', ev({ start: '25:00' }))).status, 400);
  assert.equal((await call('POST', '/api/events', ev({ room: 'tidak-ada' }))).status, 400);
  assert.equal((await call('POST', '/api/events', ev({ people: [9999] }))).status, 400);
  assert.equal((await call('POST', '/api/events', ev({ title: '   ' }))).status, 400);
});

test('pengajuan cuti melebihi sisa kuota ditolak server', async () => {
  const call = await loginAs(app.base, 'salsa@gnaascend.test');
  const r = await call('POST', '/api/leaves', { type: 'tahunan', start: D(21), end: D(35), reason: 'Liburan panjang' });
  assert.equal(r.status, 409);
  assert.match(r.data.errors.join(' '), /Sisa cuti tahunan/);
});

test('cuti tahunan tidak boleh diajukan untuk tanggal yang sudah lewat, cuti sakit boleh', async () => {
  const call = await loginAs(app.base, 'fajar@gnaascend.test');
  const past = D(-14);
  assert.equal((await call('POST', '/api/leaves', { type: 'tahunan', start: past, end: past })).status, 409);
  assert.equal((await call('POST', '/api/leaves', { type: 'sakit', start: past, end: past, reason: 'Demam' })).status, 201);
});

test('alur persetujuan cuti: hak akses, bentrok satu divisi, dan keputusan final', async () => {
  const leaves = () => app.ctx().leaves;
  const salsa = leaves().find((l) => l.userId === 11 && l.status === 'pending');

  // Rizky (Marketing) mengajukan tanggal yang beririsan. Boleh diajukan karena cuti Salsa belum disetujui.
  const rizky = await loginAs(app.base, 'rizky@gnaascend.test');
  const submitted = await rizky('POST', '/api/leaves', { type: 'tahunan', start: D(9), end: D(9), reason: 'Urusan keluarga' });
  assert.equal(submitted.status, 201);
  const rizkyLeave = submitted.data.leave;
  assert.equal(rizkyLeave.status, 'pending');

  // Yang tidak berwenang ditolak
  assert.equal((await (await loginAs(app.base, 'fajar@gnaascend.test'))('POST', `/api/leaves/${salsa.id}/approve`)).status, 403);
  assert.equal((await (await loginAs(app.base, 'bagas@gnaascend.test'))('POST', `/api/leaves/${salsa.id}/approve`)).status, 403);
  assert.equal((await (await loginAs(app.base, 'salsa@gnaascend.test'))('POST', `/api/leaves/${salsa.id}/approve`)).status, 403);

  // Manager Marketing menyetujui Salsa
  const indra = await loginAs(app.base, 'indra@gnaascend.test');
  const ok = await indra('POST', `/api/leaves/${salsa.id}/approve`);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.leave.status, 'approved');
  assert.equal(ok.data.leave.by, 10);

  // Sekarang cuti Rizky bentrok dengan Salsa di divisi yang sama
  const clash = await indra('POST', `/api/leaves/${rizkyLeave.id}/approve`);
  assert.equal(clash.status, 409);
  assert.match(clash.data.error, /divisi yang sama/);

  // Sudah diputuskan tidak bisa diproses ulang
  assert.equal((await indra('POST', `/api/leaves/${salsa.id}/approve`)).status, 409);

  // Menolak dengan catatan
  const rej = await indra('POST', `/api/leaves/${rizkyLeave.id}/reject`, { note: 'Bentrok dengan Salsa' });
  assert.equal(rej.status, 200);
  assert.equal(rej.data.leave.status, 'rejected');
  assert.equal(rej.data.leave.note, 'Bentrok dengan Salsa');
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
