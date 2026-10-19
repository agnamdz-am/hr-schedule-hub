/*
 * Logika bisnis penjadwalan HR.
 *
 * File ini dipakai di dua tempat:
 *  - server (require) sebagai aturan resmi yang menolak jadwal/cuti bermasalah
 *  - browser (<script>) untuk pratinjau bentrok langsung saat mengisi form
 *
 * Semua fungsi murni: menerima data biasa, mengembalikan hasil, tanpa akses
 * database atau jaringan. Karena itu gampang diuji.
 *
 * Bentuk data:
 *  person: { id, name, div, title, role, quota, usedBefore }
 *  room:   { id, name, cap }
 *  event:  { id, type, title, date, start, end, room, people: [id], allHands }
 *  leave:  { id, userId, type, start, end, status }
 *  ctx:    { people, rooms, events, leaves, today? }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HRLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (s, n) => {
    const d = parse(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  };
  const mins = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  // Nomor hari sejak 1970 (UTC), supaya selisih tanggal tidak terpengaruh zona waktu.
  const dnum = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 864e5;
  };
  const absTime = (date, t) => dnum(date) * 1440 + mins(t);
  // Dua rentang [a0,a1) dan [b0,b1) bentrok bila saling menimpa. Jadwal yang
  // selesai tepat saat jadwal lain mulai (11:00 dan 11:00) tidak dianggap bentrok.
  const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
  const isWeekend = (s) => {
    const w = new Date(dnum(s) * 864e5).getUTCDay();
    return w === 0 || w === 6;
  };
  // Hari kerja (Senin sampai Jumat) di antara dua tanggal, inklusif.
  function workdays(a, b) {
    let n = 0;
    for (let d = dnum(a); d <= dnum(b); d++) {
      const w = new Date(d * 864e5).getUTCDay();
      if (w !== 0 && w !== 6) n++;
    }
    return n;
  }
  // Senin dari minggu yang memuat tanggal s.
  const weekStart = (s) => addDays(s, -((parse(s).getDay() + 6) % 7));

  const person = (ctx, id) => ctx.people.find((p) => p.id === id);
  const pname = (ctx, id) => (person(ctx, id) || { name: '?' }).name;

  /**
   * Memeriksa jadwal baru/ubahan. Mengembalikan daftar masalah (kosong = aman).
   * ignoreId dipakai saat mengubah jadwal supaya tidak bentrok dengan dirinya sendiri.
   */
  function checkEvent(d, ctx, ignoreId) {
    const out = [];
    if (!d.date || !d.start || !d.end) return [{ kind: 'form', msg: 'Isi tanggal, jam mulai, dan jam selesai.' }];
    if (mins(d.end) <= mins(d.start)) return [{ kind: 'form', msg: 'Jam selesai harus setelah jam mulai.' }];
    const s = absTime(d.date, d.start);
    const e = absTime(d.date, d.end);
    const room = ctx.rooms.find((r) => r.id === d.room);
    const ids = d.allHands ? ctx.people.map((p) => p.id) : d.people;
    if (room && ids.length > room.cap) {
      out.push({ kind: 'room', msg: `Ruang ${room.name} hanya muat ${room.cap} orang, sedangkan peserta ${ids.length} orang.` });
    }
    for (const o of ctx.events) {
      if (o.id === ignoreId || o.date !== d.date) continue;
      if (!overlaps(s, e, absTime(o.date, o.start), absTime(o.date, o.end))) continue;
      const t = `${o.title} (${o.start}–${o.end})`;
      if (o.room === d.room) out.push({ kind: 'room', msg: `Ruang ${room ? room.name : ''} sudah dipakai: ${t}.` });
      if (!d.allHands && !o.allHands) {
        for (const pid of d.people) {
          if (o.people.includes(pid)) out.push({ kind: 'person', msg: `${pname(ctx, pid)} sudah ada jadwal: ${t}.` });
        }
      }
    }
    if (!d.allHands) {
      for (const pid of d.people) {
        const l = ctx.leaves.find((x) => x.userId === pid && x.status === 'approved' && x.start <= d.date && d.date <= x.end);
        if (l) out.push({ kind: 'leave', msg: `${pname(ctx, pid)} sedang cuti pada tanggal itu.` });
      }
    }
    return out;
  }

  /** Sisa cuti tahunan. withPending=true ikut menghitung pengajuan yang belum diputuskan. */
  function remaining(uid, ctx, ignoreId, withPending) {
    const p = person(ctx, uid);
    const used = ctx.leaves
      .filter((l) => l.userId === uid && l.type === 'tahunan' && l.id !== ignoreId && (l.status === 'approved' || (withPending && l.status === 'pending')))
      .reduce((a, l) => a + workdays(l.start, l.end), 0);
    return p.quota - p.usedBefore - used;
  }

  /** Cuti lain yang sudah disetujui, satu divisi, dan tanggalnya beririsan. */
  function divisionClash(l, ctx, ignoreId) {
    const p = person(ctx, l.userId);
    if (!p) return undefined;
    return ctx.leaves.find((o) => {
      if (o.id === ignoreId || o.userId === l.userId || o.status !== 'approved') return false;
      const op = person(ctx, o.userId);
      return op && op.div === p.div && o.start <= l.end && l.start <= o.end;
    });
  }

  /** Memeriksa pengajuan cuti sebelum dikirim. errors menolak, warnings hanya mengingatkan. */
  function checkLeave(l, ctx) {
    const errors = [];
    const warnings = [];
    if (!l.start || !l.end) return { errors: ['Isi tanggal mulai dan selesai.'], warnings, days: 0 };
    if (l.end < l.start) return { errors: ['Tanggal selesai tidak boleh sebelum tanggal mulai.'], warnings, days: 0 };
    const days = workdays(l.start, l.end);
    if (days === 0) errors.push('Rentang tanggal hanya berisi akhir pekan.');
    if (ctx.today && l.type !== 'sakit' && l.start < ctx.today) {
      errors.push('Tanggal mulai tidak boleh sebelum hari ini. Hanya cuti sakit yang boleh diajukan untuk tanggal yang sudah lewat.');
    }
    const own = ctx.leaves.find((o) => o.userId === l.userId && o.status !== 'rejected' && o.start <= l.end && l.start <= o.end);
    if (own) errors.push('Kamu sudah punya pengajuan cuti di rentang tanggal ini.');
    if (l.type === 'tahunan') {
      const sisa = remaining(l.userId, ctx, null, true);
      if (days > sisa) errors.push(`Sisa cuti tahunan ${sisa} hari, pengajuan ini ${days} hari.`);
    }
    const clash = divisionClash(l, ctx, null);
    if (clash) {
      errors.push(`${pname(ctx, clash.userId)} dari divisi yang sama sudah disetujui cuti di rentang ini. Satu divisi hanya boleh satu orang cuti dalam waktu bersamaan.`);
    }
    const evs = ctx.events.filter((e) => !e.allHands && e.people.includes(l.userId) && e.date >= l.start && e.date <= l.end);
    for (const e of evs) warnings.push(`Kamu terjadwal di "${e.title}" pada ${e.date}. Koordinasikan dengan HR.`);
    return { errors, warnings, days };
  }

  /** Pemeriksaan ulang saat atasan menekan Setujui (kondisi bisa berubah sejak diajukan). */
  function checkApproval(l, ctx) {
    const errors = [];
    const clash = divisionClash(l, ctx, l.id);
    if (clash) errors.push(`Bentrok: ${pname(ctx, clash.userId)} dari divisi yang sama sudah cuti di rentang ini.`);
    if (l.type === 'tahunan') {
      const days = workdays(l.start, l.end);
      const sisa = remaining(l.userId, ctx, l.id, false);
      if (days > sisa) errors.push(`Sisa cuti tahunan ${pname(ctx, l.userId)} hanya ${sisa} hari.`);
    }
    return errors;
  }

  /**
   * Siapa yang boleh memutuskan cuti:
   * - Manager HR: semua orang.
   * - Manager divisi: staf di divisinya.
   * - Admin HR (yang mengelola jadwal) tidak menyetujui cuti, kecuali cuti Manager HR sendiri.
   * Tidak ada yang boleh menyetujui cuti dirinya sendiri.
   */
  function canApprove(actor, leave, ctx) {
    if (!actor || actor.id === leave.userId) return false;
    if (actor.role === 'hr_manager') return true;
    const owner = person(ctx, leave.userId);
    if (!owner) return false;
    if (actor.role === 'admin') return owner.role === 'hr_manager';
    return actor.role === 'manager' && owner.div === actor.div && owner.role === 'staff';
  }

  return {
    pad, ymd, parse, addDays, mins, dnum, overlaps, isWeekend, workdays, weekStart,
    person, pname, checkEvent, remaining, divisionClash, checkLeave, checkApproval, canApprove,
  };
});
