'use strict';
/*
 * Klien HR Schedule Hub. Semua data berasal dari API; aturan bentrok dipakai dua kali:
 * di sini untuk pratinjau instan, dan di server (src/logic.js yang sama) sebagai penentu akhir.
 */
const { ymd, parse, addDays, mins, workdays, weekStart, person, pname, checkEvent, checkLeave, checkApproval, remaining, canApprove: canApproveRule } = HRLogic;

/* ---------- API ---------- */
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* respons tanpa body */ }
  if (!res.ok) {
    if (res.status === 401 && url !== '/api/auth/login') showLogin('Sesi berakhir, silakan masuk lagi.');
    const err = new Error((data && data.error) || 'Permintaan gagal.');
    err.status = res.status;
    err.data = data || {};
    throw err;
  }
  return data;
}

/* ---------- State ---------- */
const todayStr = () => ymd(new Date());
const S = {
  me: null, people: [], rooms: [], events: [], leaves: [],
  tab: 'dashboard', month: todayStr().slice(0, 7), sel: todayStr(),
  filters: { interview: true, training: true, company: true, leave: true },
  listType: 'all', listQ: '', listPast: false, leaveFilter: 'all', editId: null, confirmDel: null,
};
const ctx = () => ({ people: S.people, rooms: S.rooms, events: S.events, leaves: S.leaves, today: todayStr() });
const me = () => person(ctx(), S.me.id) || S.me;
const isAdmin = () => S.me.role === 'admin';
const canApprove = (l) => canApproveRule(S.me, l, ctx());

const TYPE_LABEL = { interview: 'Interview', training: 'Training', company: 'Acara perusahaan', leave: 'Cuti' };
const LEAVE_LABEL = { tahunan: 'Cuti tahunan', sakit: 'Sakit', izin: 'Izin' };
const STATUS_LABEL = { pending: 'Menunggu', approved: 'Disetujui', rejected: 'Ditolak' };
const DIVS = ['HR', 'IT', 'Finance', 'Marketing', 'Operations'];
const ROLE_LABEL = (p) => (p.role === 'admin' ? 'Admin HR' : p.role === 'manager' ? `Manager ${p.div}` : `Karyawan ${p.div}`);

/* ---------- Helper ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtLong = (s) => new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(parse(s));
const fmtShort = (s) => new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short' }).format(parse(s));
const fmtMonth = (m) => new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(parse(m + '-01'));
const first = (n) => n.split(' ')[0];
const roomName = (id) => (S.rooms.find((r) => r.id === id) || { name: '-' }).name;
const cmpEv = (a, b) => (a.date + a.start).localeCompare(b.date + b.start) || a.id - b.id;
const isWeekend = (s) => [0, 6].includes(parse(s).getDay());
function nextWorkday(from) {
  let d = from || todayStr();
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}
function peopleText(e) {
  if (e.allHands) return 'Seluruh karyawan';
  const n = e.people.map((id) => first(pname(ctx(), id)));
  const txt = n.length > 4 ? n.slice(0, 4).join(', ') + ` +${n.length - 4}` : n.join(', ');
  return e.candidate ? `${txt} · Kandidat: ${e.candidate}` : txt;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => { t.hidden = true; }, 3600);
}
/** Mengubah respons error server menjadi daftar kalimat yang bisa ditampilkan. */
function errorLines(err) {
  const d = err.data || {};
  if (Array.isArray(d.conflicts)) return d.conflicts.map((c) => c.msg);
  if (Array.isArray(d.errors) && d.errors.length) return d.errors;
  return [err.message];
}
function itemsOn(date) {
  const out = [];
  for (const e of S.events.filter((e) => e.date === date && S.filters[e.type]).sort(cmpEv)) out.push({ kind: 'event', type: e.type, e });
  if (S.filters.leave && !isWeekend(date)) {
    for (const l of S.leaves.filter((l) => l.status === 'approved' && l.start <= date && date <= l.end)) out.push({ kind: 'leave', type: 'leave', l });
  }
  return out;
}

/* ---------- Tampilan ---------- */
const V = {};
function evRow(e, showDate) {
  return `<div class="item"><div class="tm">${showDate ? esc(fmtShort(e.date)) + '<br>' : ''}${e.start}–${e.end}</div>
    <div><div class="tt"><span class="pill tag t-${e.type}">${TYPE_LABEL[e.type]}</span>${esc(e.title)}</div>
    <div class="meta">${esc(roomName(e.room))} · ${esc(peopleText(e))}</div></div></div>`;
}
function leaveRow(l, withActions) {
  const p = person(ctx(), l.userId);
  const days = workdays(l.start, l.end);
  const range = l.start === l.end ? fmtShort(l.start) : `${fmtShort(l.start)} – ${fmtShort(l.end)}`;
  let acts = '';
  if (withActions && l.status === 'pending') {
    acts = canApprove(l)
      ? `<div class="acts"><button class="btn sm ok" data-action="approve" data-id="${l.id}">Setujui</button><button class="btn sm bad" data-action="reject" data-id="${l.id}">Tolak</button></div>`
      : `<span class="muted" style="font-size:12.5px">Menunggu ${p.div === 'HR' ? 'Admin HR' : 'manager ' + esc(p.div)}</span>`;
  }
  const by = l.by ? ` · oleh ${esc(first(pname(ctx(), l.by)))}` : '';
  return `<div class="lrow"><div class="top2"><span><b>${esc(p.name)}</b> <span class="muted">· ${esc(p.div)}</span></span><span class="pill ${l.status}">${STATUS_LABEL[l.status]}</span></div>
    <div>${LEAVE_LABEL[l.type]} · ${esc(range)} · <span class="mono">${days} hari kerja</span></div>
    <div class="muted" style="font-size:13px">${esc(l.reason)}${by}${l.note ? ` · ${esc(l.note)}` : ''}</div>${acts}</div>`;
}

V.dashboard = () => {
  const t = todayStr();
  const w0 = weekStart(t);
  const w1 = addDays(w0, 6);
  const m = me();
  const inWeek = S.events.filter((e) => e.date >= w0 && e.date <= w1);
  const iv = inWeek.filter((e) => e.type === 'interview');
  const train = S.events.filter((e) => e.type === 'training' && e.date >= t && e.date <= addDays(t, 14));
  const offToday = isWeekend(t) ? [] : S.leaves.filter((l) => l.status === 'approved' && l.start <= t && t <= l.end);
  const pend = S.leaves.filter((l) => l.status === 'pending');
  const up = S.events.filter((e) => e.date >= t).sort(cmpEv).slice(0, 8);
  const groups = {};
  up.forEach((e) => (groups[e.date] = groups[e.date] || []).push(e));
  const hours = {};
  S.rooms.forEach((r) => (hours[r.id] = 0));
  inWeek.forEach((e) => (hours[e.room] += (mins(e.end) - mins(e.start)) / 60));
  const hmax = Math.max(1, ...Object.values(hours));
  const rooms = S.rooms.slice().sort((a, b) => hours[b.id] - hours[a.id]);
  const offSoon = S.leaves.filter((l) => l.status === 'approved' && l.end >= t && l.start <= addDays(t, 14)).sort((a, b) => a.start.localeCompare(b.start));
  const hint = S.demo && S.demo.enabled ? `
  <section class="hint"><b>Coba di demo ini</b>
    <ol>
      <li>Masuk sebagai <b>Rina Maharani (Admin HR)</b>, buka Kalender, lalu tambah interview pukul 10:30 dengan Bagas Wicaksono pada hari Selasa. Server menolak karena Bagas sudah ada interview.</li>
      <li>Masuk sebagai <b>Salsa Nuraini</b> dan ajukan cuti tahunan 15 hari kerja. Pengajuan ditolak karena sisa cuti tidak cukup.</li>
      <li>Masuk sebagai <b>Indra Setiawan (Manager Marketing)</b> dan setujui cuti Salsa. Setelah itu coba ajukan cuti lain dari divisi Marketing pada tanggal yang sama.</li>
    </ol>
  </section>` : '';
  return `
  <div><h1>Halo, ${esc(first(m.name))}</h1><p class="lead">${esc(fmtLong(t))} · ${esc(ROLE_LABEL(m))}</p></div>
  <section class="tiles" aria-label="Ringkasan">
    <div class="tile"><div class="lbl">Interview minggu ini</div><div class="val">${iv.length}</div><div class="sub">${iv.filter((e) => e.date >= t).length} belum berlangsung</div></div>
    <div class="tile"><div class="lbl">Training 14 hari ke depan</div><div class="val">${train.length}</div><div class="sub">${train.reduce((a, e) => a + e.people.length, 0)} total kursi peserta</div></div>
    <div class="tile"><div class="lbl">Sedang cuti hari ini</div><div class="val">${offToday.length}</div><div class="sub">${offToday.length ? esc(offToday.map((l) => first(pname(ctx(), l.userId))).join(', ')) : 'Semua karyawan masuk'}</div></div>
    <div class="tile"><div class="lbl">Menunggu persetujuan</div><div class="val">${pend.length}</div><div class="sub">${pend.filter(canApprove).length} bisa kamu proses</div></div>
  </section>
  <div class="grid2">
    <section class="panel"><h2>Agenda terdekat <small>8 jadwal berikutnya</small></h2>
      ${up.length ? `<div class="agenda">${Object.keys(groups).map((d) => `<div><div class="dayhead">${esc(fmtLong(d))}</div>${groups[d].map((e) => evRow(e, false)).join('')}</div>`).join('')}</div>` : '<div class="empty">Belum ada jadwal mendatang.</div>'}
    </section>
    <div class="stack">
      <section class="panel"><h2>Perlu persetujuan <small>${pend.length} pengajuan</small></h2>
        ${pend.length ? pend.map((l) => leaveRow(l, true)).join('') : '<div class="empty">Tidak ada pengajuan yang menunggu.</div>'}
      </section>
      <section class="panel"><h2>Pemakaian ruangan <small>minggu ini, jam</small></h2>
        <div class="bars">${rooms.map((r) => `<div class="bar"><span>${esc(r.name)}</span><div class="track"><span style="width:${((hours[r.id] / hmax) * 100).toFixed(1)}%"></span></div><span class="num">${hours[r.id].toLocaleString('id-ID', { maximumFractionDigits: 1 })} jam</span></div>`).join('')}</div>
      </section>
      <section class="panel"><h2>Cuti 14 hari ke depan</h2>
        ${offSoon.length ? offSoon.map((l) => leaveRow(l, false)).join('') : '<div class="empty">Tidak ada cuti terjadwal.</div>'}
      </section>
    </div>
  </div>${hint}`;
};

V.calendar = () => {
  const firstDay = `${S.month}-01`;
  const start = addDays(firstDay, -((parse(firstDay).getDay() + 6) % 7));
  const t = todayStr();
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i >= 35 && d.slice(0, 7) !== S.month) break;
    const its = itemsOn(d);
    const wk = isWeekend(d);
    const chips = its.slice(0, 3).map((it) => it.kind === 'event'
      ? `<span class="cchip t-${it.type}">${it.e.start} ${esc(it.e.title)}</span>`
      : `<span class="cchip t-leave">Cuti · ${esc(first(pname(ctx(), it.l.userId)))}</span>`).join('');
    const more = its.length > 3 ? `<span class="cmore">+${its.length - 3} lagi</span>` : '';
    const dots = its.slice(0, 6).map((it) => `<i class="t-${it.type}"></i>`).join('');
    cells += `<button class="cell${d.slice(0, 7) !== S.month ? ' off' : ''}${d === t ? ' today' : ''}${d === S.sel ? ' sel' : ''}${wk ? ' wk' : ''}" data-action="pick" data-date="${d}" aria-label="${esc(fmtLong(d))}, ${its.length} jadwal"><span class="d">${parse(d).getDate()}</span>${chips}${more}<span class="dots">${dots}</span></button>`;
  }
  const sel = itemsOn(S.sel);
  const filters = ['interview', 'training', 'company', 'leave'].map((k) => `<button class="fchip t-${k}" data-action="filter" data-key="${k}" aria-pressed="${S.filters[k]}"><i></i>${TYPE_LABEL[k]}</button>`).join('');
  return `
  <div class="row"><div><h1>Kalender</h1><p class="lead">Semua interview, training, acara perusahaan, dan cuti yang sudah disetujui.</p></div>
    ${isAdmin() ? '<button class="btn primary" data-action="new">+ Tambah jadwal</button>' : '<span class="muted" style="font-size:13px">Hanya Admin HR yang dapat menambah jadwal.</span>'}</div>
  <div class="chips">${filters}</div>
  <div class="grid2 cal-layout">
    <section class="panel">
      <div class="row" style="margin-bottom:12px"><h2 style="font-size:17px;text-transform:capitalize">${esc(fmtMonth(S.month))}</h2>
        <div class="acts"><button class="btn sm" data-action="prev" aria-label="Bulan sebelumnya">‹</button><button class="btn sm" data-action="todaymonth">Hari ini</button><button class="btn sm" data-action="next" aria-label="Bulan berikutnya">›</button></div></div>
      <div class="cal">${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((n) => `<div class="dow">${n}</div>`).join('')}${cells}</div>
    </section>
    <section class="panel"><h2>${esc(fmtLong(S.sel))}</h2>
      ${sel.length ? sel.map((it) => it.kind === 'event' ? evRow(it.e, false) : `<div class="item"><div class="tm">Seharian</div><div><div class="tt"><span class="pill tag t-leave">Cuti</span>${esc(pname(ctx(), it.l.userId))}</div><div class="meta">${LEAVE_LABEL[it.l.type]} · ${esc(person(ctx(), it.l.userId).div)}</div></div></div>`).join('') : '<div class="empty">Tidak ada jadwal pada tanggal ini.</div>'}
      ${isAdmin() ? `<div style="margin-top:12px"><button class="btn sm" data-action="new" data-date="${S.sel}">+ Tambah jadwal di tanggal ini</button></div>` : ''}
    </section>
  </div>`;
};

V.list = () => {
  const t = todayStr();
  let rows = S.events.slice().sort(cmpEv);
  if (!S.listPast) rows = rows.filter((e) => e.date >= t);
  if (S.listType !== 'all') rows = rows.filter((e) => e.type === S.listType);
  const q = S.listQ.trim().toLowerCase();
  if (q) rows = rows.filter((e) => (e.title + ' ' + e.candidate + ' ' + roomName(e.room) + ' ' + e.people.map((id) => pname(ctx(), id)).join(' ')).toLowerCase().includes(q));
  const body = rows.map((e) => `<tr><td class="mono">${esc(fmtShort(e.date))}</td><td class="mono">${e.start}–${e.end}</td>
    <td><span class="pill t-${e.type}">${TYPE_LABEL[e.type]}</span></td><td><div class="ttl">${esc(e.title)}</div></td>
    <td>${esc(roomName(e.room))}</td><td style="max-width:280px">${esc(peopleText(e))}</td>
    <td>${isAdmin() ? (S.confirmDel === e.id ? `<div class="acts"><button class="btn sm bad" data-action="delyes" data-id="${e.id}">Hapus</button><button class="btn sm" data-action="delno">Batal</button></div>` : `<div class="acts"><button class="btn sm" data-action="edit" data-id="${e.id}">Ubah</button><button class="btn sm" data-action="del" data-id="${e.id}">Hapus</button></div>`) : ''}</td></tr>`).join('');
  return `
  <div class="row"><div><h1>Daftar jadwal</h1><p class="lead">${rows.length} jadwal ditampilkan.</p></div>
    ${isAdmin() ? '<button class="btn primary" data-action="new">+ Tambah jadwal</button>' : ''}</div>
  <div class="filters">
    <input id="lq" type="search" placeholder="Cari judul, nama, ruang" value="${esc(S.listQ)}" aria-label="Cari jadwal">
    <select id="ltype" aria-label="Jenis jadwal"><option value="all">Semua jenis</option>${['interview', 'training', 'company'].map((k) => `<option value="${k}"${S.listType === k ? ' selected' : ''}>${TYPE_LABEL[k]}</option>`).join('')}</select>
    <label class="chk" style="align-items:center"><input type="checkbox" id="lpast"${S.listPast ? ' checked' : ''}><span>Tampilkan yang sudah lewat</span></label>
  </div>
  <div class="tablewrap"><table><thead><tr><th>Tanggal</th><th>Waktu</th><th>Jenis</th><th>Kegiatan</th><th>Ruang</th><th>Peserta</th><th></th></tr></thead>
    <tbody>${body || '<tr><td colspan="7" class="empty" style="padding:16px">Tidak ada jadwal yang cocok.</td></tr>'}</tbody></table></div>`;
};

V.leave = () => {
  const m = me();
  const c = ctx();
  const sisa = remaining(m.id, c, null, false);
  const pending = remaining(m.id, c, null, true);
  let list = S.leaves.slice().sort((a, b) => b.start.localeCompare(a.start) || b.id - a.id);
  if (S.leaveFilter !== 'all') list = list.filter((l) => l.status === S.leaveFilter);
  const defStart = nextWorkday(addDays(todayStr(), 14));
  const defEnd = nextWorkday(addDays(defStart, 1));
  return `
  <div><h1>Cuti dan izin</h1><p class="lead">Pengajuan, persetujuan, dan sisa cuti tahunan. Satu divisi hanya boleh satu orang cuti bersamaan.</p></div>
  <div class="grid2 leave-layout">
    <section class="panel"><h2>Ajukan cuti <small>${esc(m.name)}</small></h2>
      <form id="lform" class="form">
        <label class="field"><span>Jenis</span><select id="l-type">${Object.keys(LEAVE_LABEL).map((k) => `<option value="${k}">${LEAVE_LABEL[k]}</option>`).join('')}</select></label>
        <div class="field"><span>Sisa cuti tahunan</span><div class="mono" style="padding:8px 0;font-size:18px;font-weight:600">${sisa} <span class="muted" style="font-size:13px;font-family:var(--font-body)">dari ${m.quota} hari${pending !== sisa ? ` · ${sisa - pending} hari menunggu` : ''}</span></div></div>
        <label class="field"><span>Mulai</span><input type="date" id="l-start" value="${defStart}"></label>
        <label class="field"><span>Selesai</span><input type="date" id="l-end" value="${defEnd}"></label>
        <label class="field full"><span>Alasan</span><textarea id="l-reason" rows="2" maxlength="200" placeholder="Contoh: acara keluarga"></textarea></label>
        <div class="full" id="l-status"></div>
        <div class="full"><button class="btn primary" type="button" id="l-submit" data-action="submit-leave">Kirim pengajuan</button></div>
      </form>
    </section>
    <section class="panel"><h2>Pengajuan <small>${list.length} data</small></h2>
      <div class="filters" style="margin-bottom:8px"><select id="lf" aria-label="Filter status"><option value="all">Semua status</option>${Object.keys(STATUS_LABEL).map((k) => `<option value="${k}"${S.leaveFilter === k ? ' selected' : ''}>${STATUS_LABEL[k]}</option>`).join('')}</select></div>
      ${list.length ? list.map((l) => leaveRow(l, true)).join('') : '<div class="empty">Tidak ada pengajuan.</div>'}
    </section>
  </div>
  <section class="panel"><h2>Sisa cuti tahunan seluruh karyawan <small>kuota ${m.quota} hari</small></h2>
    <div class="bal">${S.people.map((p) => { const r = remaining(p.id, c, null, false); return `<div class="item2"><div class="nm"><span>${esc(p.name)} <span class="muted">· ${esc(p.div)}</span></span><span class="mono">${r}/${p.quota}</span></div><div class="track" style="height:8px;border-radius:4px;background:var(--surface2);overflow:hidden"><span style="display:block;height:100%;width:${Math.max(0, (r / p.quota) * 100).toFixed(1)}%;background:var(--accent)"></span></div></div>`; }).join('')}</div>
  </section>`;
};

/* ---------- Render ---------- */
const TABS = [['dashboard', 'Dashboard'], ['calendar', 'Kalender'], ['list', 'Jadwal'], ['leave', 'Cuti']];
function render() {
  const pend = S.leaves.filter((l) => l.status === 'pending' && canApprove(l)).length;
  $('#tabs').innerHTML = TABS.map(([k, n]) => `<button class="tab" role="tab" aria-selected="${S.tab === k}" data-action="tab" data-tab="${k}">${n}${k === 'leave' && pend ? `<span class="n">${pend}</span>` : ''}</button>`).join('');
  $('#view').innerHTML = V[S.tab]();
  if (S.tab === 'leave') updateLeavePreview();
}

/* ---------- Form cuti ---------- */
const readLeave = () => ({ userId: S.me.id, type: $('#l-type').value, start: $('#l-start').value, end: $('#l-end').value });
function statusBox(errors, warnings, okText) {
  let html = '';
  if (errors.length) html += `<div class="status bad"><b>Tidak bisa diajukan</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
  else html += `<div class="status ok">${okText}</div>`;
  if (warnings.length) html += `<div class="status warn" style="margin-top:8px"><ul style="margin:0">${warnings.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
  return html;
}
function updateLeavePreview() {
  if (!$('#l-type')) return;
  const r = checkLeave(readLeave(), ctx());
  $('#l-status').innerHTML = statusBox(r.errors, r.warnings, `Aman diajukan: <span class="mono">${r.days}</span> hari kerja, tanpa bentrok tim.`);
  $('#l-submit').disabled = r.errors.length > 0;
}
async function submitLeave() {
  const l = readLeave();
  if (checkLeave(l, ctx()).errors.length) return;
  $('#l-submit').disabled = true;
  try {
    await api('POST', '/api/leaves', { type: l.type, start: l.start, end: l.end, reason: $('#l-reason').value });
    toast('Pengajuan terkirim, menunggu persetujuan atasan.');
    await reload();
  } catch (err) {
    if (err.status === 401) return;
    await reload(false);
    $('#l-status').innerHTML = statusBox(errorLines(err), [], '');
    $('#l-submit').disabled = false;
  }
}

/* ---------- Modal jadwal ---------- */
function openEvent(id, date) {
  S.editId = id;
  const e = id ? S.events.find((x) => x.id === id) : { type: 'interview', title: '', candidate: '', date: date || nextWorkday(), start: '09:00', end: '10:00', room: S.rooms[0].id, people: [], allHands: false };
  const checks = DIVS.map((dv) => `<fieldset class="pgroup"><legend>${dv}</legend>${S.people.filter((p) => p.div === dv).map((p) => `<label class="chk"><input type="checkbox" name="p" value="${p.id}"${e.people.includes(p.id) ? ' checked' : ''}><span>${esc(p.name)}<small>${esc(p.title)}</small></span></label>`).join('')}</fieldset>`).join('');
  $('#modal').innerHTML = `
    <div class="row"><h1 id="mtitle" style="font-size:19px">${id ? 'Ubah jadwal' : 'Tambah jadwal'}</h1><button class="btn sm" data-action="close" aria-label="Tutup">Tutup</button></div>
    <form id="eform" class="form">
      <label class="field"><span>Jenis</span><select id="f-type">${['interview', 'training', 'company'].map((k) => `<option value="${k}"${e.type === k ? ' selected' : ''}>${TYPE_LABEL[k]}</option>`).join('')}</select></label>
      <label class="field"><span>Ruang</span><select id="f-room">${S.rooms.map((r) => `<option value="${r.id}"${e.room === r.id ? ' selected' : ''}>${esc(r.name)} (maks. ${r.cap})</option>`).join('')}</select></label>
      <label class="field full"><span>Judul</span><input id="f-title" maxlength="120" value="${esc(e.title)}" placeholder="Contoh: Interview Data Analyst"></label>
      <label class="field full" id="f-cand-wrap"><span>Nama kandidat</span><input id="f-cand" maxlength="100" value="${esc(e.candidate)}" placeholder="Nama kandidat (fiktif)"></label>
      <label class="field"><span>Tanggal</span><input type="date" id="f-date" value="${e.date}"></label>
      <div class="form" style="grid-template-columns:1fr 1fr;gap:12px">
        <label class="field"><span>Mulai</span><input type="time" id="f-start" value="${e.start}"></label>
        <label class="field"><span>Selesai</span><input type="time" id="f-end" value="${e.end}"></label>
      </div>
      <label class="chk full" id="f-all-wrap"><input type="checkbox" id="f-all"${e.allHands ? ' checked' : ''}><span>Seluruh karyawan diundang</span></label>
      <fieldset class="field full" id="f-people-wrap" style="border:0;padding:0;margin:0"><legend>Peserta dan pewawancara</legend><div class="plist">${checks}</div></fieldset>
      <div class="full" id="f-status"></div>
      <div class="full acts"><button class="btn primary" type="button" id="f-save" data-action="save-event">Simpan</button><button class="btn" type="button" data-action="close">Batal</button></div>
    </form>`;
  $('#overlay').hidden = false;
  syncEventForm();
  setTimeout(() => { const t = $('#f-title'); if (t) t.focus(); }, 0);
}
function readEvent() {
  const type = $('#f-type').value;
  const all = type === 'company' && $('#f-all').checked;
  return {
    type, title: $('#f-title').value.trim(), candidate: type === 'interview' ? $('#f-cand').value.trim() : '',
    date: $('#f-date').value, start: $('#f-start').value, end: $('#f-end').value, room: $('#f-room').value, allHands: all,
    people: all ? [] : [...document.querySelectorAll('#eform input[name="p"]:checked')].map((i) => +i.value),
  };
}
function eventStatusHtml(issues, d) {
  if (issues.length) return `<div class="status bad"><b>${issues.length} bentrok atau masalah</b><ul>${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
  if (!d.allHands && !d.people.length) return '<div class="status warn">Pilih minimal satu peserta.</div>';
  return '<div class="status ok">Tidak ada bentrok. Jadwal siap disimpan.</div>';
}
function syncEventForm() {
  const d = readEvent();
  $('#f-cand-wrap').hidden = d.type !== 'interview';
  $('#f-all-wrap').hidden = d.type !== 'company';
  $('#f-people-wrap').hidden = d.allHands;
  const issues = checkEvent(d, ctx(), S.editId).map((i) => i.msg);
  $('#f-status').innerHTML = eventStatusHtml(issues, d);
  $('#f-save').disabled = issues.length > 0 || !d.title || (!d.allHands && !d.people.length);
}
function closeModal() { $('#overlay').hidden = true; S.editId = null; }
async function saveEvent() {
  const d = readEvent();
  if (checkEvent(d, ctx(), S.editId).length || !d.title) return;
  $('#f-save').disabled = true;
  try {
    const { event } = S.editId ? await api('PUT', `/api/events/${S.editId}`, d) : await api('POST', '/api/events', d);
    S.sel = event.date;
    S.month = event.date.slice(0, 7);
    closeModal();
    toast('Jadwal disimpan.');
    await reload();
  } catch (err) {
    if (err.status === 401) return;
    // Data di server bisa sudah berubah sejak halaman dimuat. Ambil data terbaru lalu tampilkan alasan penolakannya.
    await reload(false);
    $('#f-status').innerHTML = `<div class="status bad"><b>Server menolak jadwal ini</b><ul>${errorLines(err).map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>`;
    $('#f-save').disabled = false;
  }
}

/* ---------- Sesi ---------- */
async function reload(draw = true) {
  const d = await api('GET', '/api/bootstrap');
  S.me = d.me; S.people = d.people; S.rooms = d.rooms; S.events = d.events; S.leaves = d.leaves;
  if (draw) render();
}
function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#whoami').textContent = `${S.me.name} · ${ROLE_LABEL(S.me)}`;
  render();
}
async function loadDemoAccounts() {
  try { S.demo = await api('GET', '/api/auth/demo'); } catch { S.demo = { enabled: false, accounts: [] }; }
  const box = $('#demo-box');
  box.hidden = !S.demo.enabled;
  if (!S.demo.enabled) return;
  $('#demo-pass').textContent = S.demo.password;
  $('#demo-list').innerHTML = S.demo.accounts.map((a) => `<button type="button" class="demo-btn" data-action="demo" data-email="${esc(a.email)}"><span>${esc(a.name)}</span><small>${esc(ROLE_LABEL({ role: a.role, div: a.div }))}</small></button>`).join('');
}
function showLogin(msg) {
  closeModal();
  S.me = null;
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-error').innerHTML = msg ? `<div class="status warn">${esc(msg)}</div>` : '';
  $('#password').value = '';
  loadDemoAccounts();
}
async function login(ev) {
  ev.preventDefault();
  $('#login-btn').disabled = true;
  try {
    await api('POST', '/api/auth/login', { email: $('#email').value, password: $('#password').value });
    await reload(false);
    S.tab = 'dashboard';
    S.demo = S.demo || { enabled: false };
    showApp();
  } catch (err) {
    $('#login-error').innerHTML = `<div class="status bad">${esc(err.message)}</div>`;
  } finally {
    $('#login-btn').disabled = false;
  }
}

/* ---------- Event listener ---------- */
document.addEventListener('submit', (ev) => { if (ev.target.id !== 'loginform') ev.preventDefault(); });
$('#loginform').addEventListener('submit', login);
$('#logout').addEventListener('click', async () => {
  try { await api('POST', '/api/auth/logout'); } catch { /* tetap keluar di sisi klien */ }
  showLogin('');
});
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-action]');
  if (!b) return;
  const a = b.dataset.action;
  const id = Number(b.dataset.id);
  if (a === 'demo') { $('#email').value = b.dataset.email; $('#password').value = S.demo.password; $('#login-btn').focus(); }
  else if (a === 'tab') { S.tab = b.dataset.tab; S.confirmDel = null; render(); }
  else if (a === 'pick') { S.sel = b.dataset.date; if (b.dataset.date.slice(0, 7) !== S.month) S.month = b.dataset.date.slice(0, 7); render(); }
  else if (a === 'filter') { S.filters[b.dataset.key] = !S.filters[b.dataset.key]; render(); }
  else if (a === 'prev' || a === 'next') { const d = parse(S.month + '-01'); d.setMonth(d.getMonth() + (a === 'next' ? 1 : -1)); S.month = ymd(d).slice(0, 7); render(); }
  else if (a === 'todaymonth') { S.month = todayStr().slice(0, 7); S.sel = todayStr(); render(); }
  else if (a === 'new') { if (isAdmin()) openEvent(null, b.dataset.date); }
  else if (a === 'edit') { if (isAdmin()) openEvent(id); }
  else if (a === 'del') { S.confirmDel = id; render(); }
  else if (a === 'delno') { S.confirmDel = null; render(); }
  else if (a === 'delyes') {
    try { await api('DELETE', `/api/events/${id}`); toast('Jadwal dihapus.'); } catch (err) { toast(err.message); }
    S.confirmDel = null;
    try { await reload(); } catch { /* sesi habis, sudah ke halaman login */ }
  }
  else if (a === 'close') closeModal();
  else if (a === 'save-event') saveEvent();
  else if (a === 'submit-leave') submitLeave();
  else if (a === 'approve' || a === 'reject') {
    try {
      await api('POST', `/api/leaves/${id}/${a}`, a === 'reject' ? {} : undefined);
      toast(a === 'approve' ? 'Cuti disetujui.' : 'Cuti ditolak.');
    } catch (err) { toast(err.message); }
    try { await reload(); } catch { /* sesi habis, sudah ke halaman login */ }
  }
});
$('#overlay').addEventListener('mousedown', (ev) => { if (ev.target.id === 'overlay') closeModal(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#overlay').hidden) closeModal(); });
$('#modal').addEventListener('input', syncEventForm);
$('#modal').addEventListener('change', syncEventForm);
$('#view').addEventListener('input', (ev) => {
  const id = ev.target.id;
  if (id === 'lq') {
    S.listQ = ev.target.value;
    const pos = ev.target.selectionStart;
    render();
    const i = $('#lq');
    i.focus();
    i.setSelectionRange(pos, pos);
  } else if (id === 'l-start' || id === 'l-end' || id === 'l-type') updateLeavePreview();
});
$('#view').addEventListener('change', (ev) => {
  const id = ev.target.id;
  if (id === 'ltype') { S.listType = ev.target.value; render(); }
  else if (id === 'lpast') { S.listPast = ev.target.checked; render(); }
  else if (id === 'lf') { S.leaveFilter = ev.target.value; render(); }
  else if (id === 'l-start' || id === 'l-end' || id === 'l-type') updateLeavePreview();
});

/* ---------- Mulai ---------- */
(async function start() {
  await loadDemoAccounts();
  try {
    await reload(false);
    showApp();
  } catch {
    showLogin('');
  }
})();
