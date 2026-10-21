'use strict';
/*
 * Klien HR Schedule Hub. Semua data berasal dari API; aturan bentrok dipakai dua kali:
 * di sini untuk pratinjau instan, dan di server (src/logic.js yang sama) sebagai penentu akhir.
 */
const { ymd, parse, addDays, mins, dnum, workdays, weekStart, person, pname, checkEvent, checkLeave, checkApproval, remaining, canApprove: canApproveRule } = HRLogic;

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
  rec: { jobs: [], candidates: [], evaluations: [] }, recJob: 'all', candId: null,
  tab: 'dashboard', jview: 'cal', empQ: '', empInactive: false, month: todayStr().slice(0, 7), sel: todayStr(),
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
const ROLE_HINT = { hr_manager: 'Menyetujui cuti dan keputusan penawaran', admin: 'Kelola jadwal, cuti, rekrutmen, karyawan' };
const ROLE_LABEL = (p) => (p.role === 'hr_manager' ? 'Manager HR' : p.role === 'admin' ? 'Admin HR' : 'Karyawan');
const activePeople = () => S.people.filter((p) => p.active);

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
  const ppl = (ids) => ids.map((id) => { const p = person(ctx(), id); return p ? `${first(p.name)} (${p.title})` : '?'; });
  if (e.type === 'interview') {
    const base = `Pewawancara: ${ppl(e.people).join(', ')}`;
    return e.candidate ? `${base} · Kandidat: ${e.candidate}` : base;
  }
  const owner = e.ownerId ? `PJ: ${pname(ctx(), e.ownerId)}` : '';
  return `${owner}${owner ? ' · ' : ''}${e.allHands ? 'Seluruh karyawan' : e.attendees + ' peserta'}`;
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
  const p = person(ctx(), l.employeeId) || { name: '?', div: '' };
  const days = workdays(l.start, l.end);
  const range = l.start === l.end ? fmtShort(l.start) : `${fmtShort(l.start)} – ${fmtShort(l.end)}`;
  let acts = '';
  if (withActions && l.status === 'pending') {
    acts = canApprove(l)
      ? `<div class="acts"><button class="btn sm ok" data-action="approve" data-id="${l.id}">Setujui</button><button class="btn sm bad" data-action="reject" data-id="${l.id}">Tolak</button></div>`
      : `<span class="muted" style="font-size:12.5px">Menunggu ${p.role === 'hr_manager' ? 'Admin HR' : 'Manager HR'}</span>`;
  }
  const by = (l.by ? ` · oleh ${esc(first(pname(ctx(), l.by)))}` : '') + (l.submittedBy ? ` · diajukan oleh ${esc(first(pname(ctx(), l.submittedBy)))}` : '');
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
      <li>Masuk sebagai <b>Indah Permatasari (Admin HR)</b>, buka Jadwal, lalu tambah interview Selasa pukul 10:30 dengan pewawancara Bagas Wicaksono. Server menolak karena Bagas sudah ada interview.</li>
      <li>Buka Cuti dan ajukan cuti tahunan 15 hari kerja atas nama Salsa Nuraini (pilih dari daftar karyawan). Ditolak karena sisa cuti tidak cukup.</li>
      <li>Rekrutmen: buka kartu Alya, isi penilaian atas nama pewawancara, lalu pindahkan ke Penawaran. Masuk sebagai <b>Agna Mudzkia (Manager HR)</b> untuk menyetujui penawaran dan cuti.</li>
      <li>Buka Karyawan, tambah karyawan baru, lalu lihat namanya langsung muncul di semua form.</li>
    </ol>
  </section>` : '';
  return `
  <div><h1>Halo, ${esc(first(m.name))}</h1><p class="lead">${esc(fmtLong(t))} · ${esc(ROLE_LABEL(m))}</p></div>
  <section class="tiles" aria-label="Ringkasan">
    <div class="tile"><div class="lbl">Interview minggu ini</div><div class="val">${iv.length}</div><div class="sub">${iv.filter((e) => e.date >= t).length} belum berlangsung</div></div>
    <div class="tile"><div class="lbl">Training 14 hari ke depan</div><div class="val">${train.length}</div><div class="sub">${train.reduce((a, e) => a + e.attendees, 0)} total kursi peserta</div></div>
    <div class="tile"><div class="lbl">Sedang cuti hari ini</div><div class="val">${offToday.length}</div><div class="sub">${offToday.length ? esc(offToday.map((l) => first(pname(ctx(), l.employeeId))).join(', ')) : 'Semua karyawan masuk'}</div></div>
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

const calBody = () => {
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
      : `<span class="cchip t-leave">Cuti · ${esc(first(pname(ctx(), it.l.employeeId)))}</span>`).join('');
    const more = its.length > 3 ? `<span class="cmore">+${its.length - 3} lagi</span>` : '';
    const dots = its.slice(0, 6).map((it) => `<i class="t-${it.type}"></i>`).join('');
    cells += `<button class="cell${d.slice(0, 7) !== S.month ? ' off' : ''}${d === t ? ' today' : ''}${d === S.sel ? ' sel' : ''}${wk ? ' wk' : ''}" data-action="pick" data-date="${d}" aria-label="${esc(fmtLong(d))}, ${its.length} jadwal"><span class="d">${parse(d).getDate()}</span>${chips}${more}<span class="dots">${dots}</span></button>`;
  }
  const sel = itemsOn(S.sel);
  const filters = ['interview', 'training', 'company', 'leave'].map((k) => `<button class="fchip t-${k}" data-action="filter" data-key="${k}" aria-pressed="${S.filters[k]}"><i></i>${TYPE_LABEL[k]}</button>`).join('');
  return `
  <div class="chips">${filters}</div>
  <div class="grid2 cal-layout">
    <section class="panel">
      <div class="row" style="margin-bottom:12px"><h2 style="font-size:17px;text-transform:capitalize">${esc(fmtMonth(S.month))}</h2>
        <div class="acts"><button class="btn sm" data-action="prev" aria-label="Bulan sebelumnya">‹</button><button class="btn sm" data-action="todaymonth">Hari ini</button><button class="btn sm" data-action="next" aria-label="Bulan berikutnya">›</button></div></div>
      <div class="cal">${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((n) => `<div class="dow">${n}</div>`).join('')}${cells}</div>
    </section>
    <section class="panel"><h2>${esc(fmtLong(S.sel))}</h2>
      ${sel.length ? sel.map((it) => it.kind === 'event' ? evRow(it.e, false) : `<div class="item"><div class="tm">Seharian</div><div><div class="tt"><span class="pill tag t-leave">Cuti</span>${esc(pname(ctx(), it.l.employeeId))}</div><div class="meta">${LEAVE_LABEL[it.l.type]} · ${esc(person(ctx(), it.l.employeeId).div)}</div></div></div>`).join('') : '<div class="empty">Tidak ada jadwal pada tanggal ini.</div>'}
      ${isAdmin() ? `<div style="margin-top:12px"><button class="btn sm" data-action="new" data-date="${S.sel}">+ Tambah jadwal di tanggal ini</button></div>` : ''}
    </section>
  </div>`;
};

const listBody = () => {
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
  <p class="lead" style="margin:0 0 8px">${rows.length} jadwal ditampilkan.</p>
  <div class="filters">
    <input id="lq" type="search" placeholder="Cari judul, nama, ruang" value="${esc(S.listQ)}" aria-label="Cari jadwal">
    <select id="ltype" aria-label="Jenis jadwal"><option value="all">Semua jenis</option>${['interview', 'training', 'company'].map((k) => `<option value="${k}"${S.listType === k ? ' selected' : ''}>${TYPE_LABEL[k]}</option>`).join('')}</select>
    <label class="chk" style="align-items:center"><input type="checkbox" id="lpast"${S.listPast ? ' checked' : ''}><span>Tampilkan yang sudah lewat</span></label>
  </div>
  <div class="tablewrap"><table><thead><tr><th>Tanggal</th><th>Waktu</th><th>Jenis</th><th>Kegiatan</th><th>Ruang</th><th>Penanggung jawab / peserta</th><th></th></tr></thead>
    <tbody>${body || '<tr><td colspan="7" class="empty" style="padding:16px">Tidak ada jadwal yang cocok.</td></tr>'}</tbody></table></div>`;
};

V.schedule = () => `
  <div class="row"><div><h1>Jadwal</h1><p class="lead">${isAdmin() ? 'Interview, training, acara perusahaan, dan cuti yang sudah disetujui.' : 'Hanya Admin HR yang dapat mengubah jadwal.'}</p></div>
    <div class="acts"><div class="seg" role="group" aria-label="Tampilan jadwal">
      <button class="btn sm${S.jview === 'cal' ? ' primary' : ''}" data-action="jview" data-v="cal" aria-pressed="${S.jview === 'cal'}">Kalender</button>
      <button class="btn sm${S.jview === 'list' ? ' primary' : ''}" data-action="jview" data-v="list" aria-pressed="${S.jview === 'list'}">Daftar</button></div>
      ${isAdmin() ? '<button class="btn primary" data-action="new">+ Tambah jadwal</button>' : ''}</div></div>
  ${S.jview === 'cal' ? calBody() : listBody()}`;

V.leave = () => {
  const c = ctx();
  let list = S.leaves.slice().sort((a, b) => b.start.localeCompare(a.start) || b.id - a.id);
  if (S.leaveFilter !== 'all') list = list.filter((l) => l.status === S.leaveFilter);
  const defStart = nextWorkday(addDays(todayStr(), 14));
  const defEnd = nextWorkday(addDays(defStart, 1));
  const form = isAdmin() ? `
    <section class="panel"><h2>Ajukan cuti <small>atas nama karyawan</small></h2>
      <form id="lform" class="form">
        <label class="field full"><span>Karyawan</span><select id="l-for">${activePeople().map((x) => `<option value="${x.id}">${esc(x.name)} · ${esc(x.title)}</option>`).join('')}</select></label>
        <div class="field full"><span>Divisi</span><div id="l-div" class="mono" style="padding:8px 0"></div></div>
        <label class="field"><span>Jenis</span><select id="l-type">${Object.keys(LEAVE_LABEL).map((k) => `<option value="${k}">${LEAVE_LABEL[k]}</option>`).join('')}</select></label>
        <div class="field"><span>Sisa cuti tahunan</span><div id="l-sisa"></div></div>
        <label class="field"><span>Mulai</span><input type="date" id="l-start" value="${defStart}"></label>
        <label class="field"><span>Selesai</span><input type="date" id="l-end" value="${defEnd}"></label>
        <label class="field full"><span>Alasan</span><textarea id="l-reason" rows="2" maxlength="200" placeholder="Contoh: acara keluarga"></textarea></label>
        <div class="full" id="l-status"></div>
        <div class="full"><button class="btn primary" type="button" id="l-submit" data-action="submit-leave">Kirim pengajuan</button></div>
      </form>
    </section>` : `
    <section class="panel"><h2>Pengajuan cuti</h2><p class="muted">Pengajuan cuti dibuat oleh Admin HR atas nama karyawan. Kamu menyetujui atau menolaknya di daftar sebelah.</p></section>`;
  return `
  <div><h1>Cuti dan izin</h1><p class="lead">Admin HR mengajukan, Manager HR menyetujui. Satu divisi hanya boleh satu orang cuti bersamaan.</p></div>
  <div class="grid2 leave-layout">
    ${form}
    <section class="panel"><h2>Pengajuan <small>${list.length} data</small></h2>
      <div class="filters" style="margin-bottom:8px"><select id="lf" aria-label="Filter status"><option value="all">Semua status</option>${Object.keys(STATUS_LABEL).map((k) => `<option value="${k}"${S.leaveFilter === k ? ' selected' : ''}>${STATUS_LABEL[k]}</option>`).join('')}</select></div>
      ${list.length ? list.map((l) => leaveRow(l, true)).join('') : '<div class="empty">Tidak ada pengajuan.</div>'}
    </section>
  </div>
  <section class="panel"><h2>Sisa cuti tahunan seluruh karyawan</h2>
    <div class="bal">${activePeople().map((p) => { const r = remaining(p.id, c, null, false); return `<div class="item2"><div class="nm"><span>${esc(p.name)} <span class="muted">· ${esc(p.div)}</span></span><span class="mono">${r}/${p.quota}</span></div><div class="track" style="height:8px;border-radius:4px;background:var(--surface2);overflow:hidden"><span style="display:block;height:100%;width:${p.quota ? Math.max(0, (r / p.quota) * 100).toFixed(1) : 0}%;background:var(--accent)"></span></div></div>`; }).join('')}</div>
  </section>`;
};

/* ---------- Rekrutmen ---------- */
const RC = HRRecruit;
const jobOf = (id) => S.rec.jobs.find((j) => j.id === id);
const candOf = (id) => S.rec.candidates.find((c) => c.id === id);
const candEvals = (id) => S.rec.evaluations.filter((e) => e.candidateId === id);
const hiredN = (jobId) => S.rec.candidates.filter((c) => c.jobId === jobId && c.stage === 'hired').length;
const daysSince = (s) => Math.max(0, dnum(todayStr()) - dnum(s));
const STAGE_PILL = (s) => `<span class="pill st-${s}">${RC.STAGE_LABEL[s]}</span>`;
// Pewawancara yang tercatat di jadwal interview kandidat ini, dan yang belum dinilai pada tahap sekarang.
const interviewersOf = (c) => [...new Set(S.events.filter((e) => e.type === 'interview' && e.candidateId === c.id).flatMap((e) => e.people))];
const unevaluated = (c) => interviewersOf(c).filter((id) => !candEvals(c.id).some((e) => e.interviewerId === id && e.stage === c.stage));
const needsEval = (c) => RC.INTERVIEW_STAGES.includes(c.stage) && unevaluated(c).length > 0;
const awaitingMe = (c) => (S.me.role === 'hr_manager' ? c.stage === 'offer' : needsEval(c));
// Siapa yang memegang tahap ini: Admin HR sampai Penawaran, Manager HR untuk keputusan penawaran.
const canDriveStage = (c) => (S.me.role === 'admin' && c.stage !== 'offer') || (S.me.role === 'hr_manager' && c.stage === 'offer');
const recruitBadge = () => S.rec.candidates.filter(awaitingMe).length;

function cardHtml(c) {
  const job = jobOf(c.jobId);
  const ev = candEvals(c.id);
  const mine = awaitingMe(c);
  const meta = RC.isFinal(c.stage) ? '' : `${daysSince(c.stageChangedOn)} hari di tahap ini`;
  const score = ev.length ? ` · skor ${RC.avgScore(ev).toFixed(1)}` : '';
  return `<button class="kcard${mine ? ' mine' : ''}" data-action="cand" data-id="${c.id}">
    <b>${esc(c.name)}</b><small>${esc(job ? job.title : '-')}</small><small>${meta}${score}</small>
    ${mine ? `<span class="pill st-offer" style="margin-top:6px">${S.me.role === 'hr_manager' ? 'Perlu keputusanmu' : 'Perlu penilaian'}</span>` : ''}</button>`;
}

V.recruit = () => {
  const all = true;
  const role = S.me.role;
  const cands = S.rec.candidates.filter((c) => S.recJob === 'all' || String(c.jobId) === S.recJob);
  const active = S.rec.candidates.filter((c) => !RC.isFinal(c.stage));
  const openJobs = S.rec.jobs.filter((j) => j.status === 'open');
  const avgDays = active.length ? active.reduce((a, c) => a + daysSince(c.appliedOn), 0) / active.length : 0;
  const offers = S.rec.candidates.filter((c) => c.stage === 'offer').length;
  const tiles = all ? `
  <section class="tiles" aria-label="Ringkasan rekrutmen">
    <div class="tile"><div class="lbl">Lowongan terbuka</div><div class="val">${openJobs.length}</div><div class="sub">${openJobs.reduce((a, j) => a + j.openings - hiredN(j.id), 0)} posisi masih dicari</div></div>
    <div class="tile"><div class="lbl">Kandidat aktif</div><div class="val">${active.length}</div><div class="sub">${S.rec.candidates.filter((c) => c.stage === 'hired').length} diterima · ${S.rec.candidates.filter((c) => c.stage === 'rejected').length} ditolak</div></div>
    <div class="tile"><div class="lbl">Menunggu keputusan penawaran</div><div class="val">${offers}</div><div class="sub">${role === 'hr_manager' ? 'diputuskan oleh kamu' : 'diputuskan Manager HR'}</div></div>
    <div class="tile"><div class="lbl">Rata-rata lama proses</div><div class="val">${avgDays.toLocaleString('id-ID', { maximumFractionDigits: 1 })}</div><div class="sub">hari sejak melamar (kandidat aktif)</div></div>
  </section>` : '';
  const filter = all ? `<div class="filters"><select id="rjob" aria-label="Filter lowongan"><option value="all">Semua lowongan</option>${S.rec.jobs.map((j) => `<option value="${j.id}"${S.recJob === String(j.id) ? ' selected' : ''}>${esc(j.title)}</option>`).join('')}</select></div>` : '';
  const board = RC.STAGES.map((st) => {
    const list = cands.filter((c) => c.stage === st);
    return `<div class="kcol"><h3><span>${RC.STAGE_LABEL[st]}</span><span class="mono">${list.length}</span></h3>${list.map(cardHtml).join('') || '<div class="kempty">Kosong</div>'}</div>`;
  }).join('');
  const rejected = cands.filter((c) => c.stage === 'rejected');
  const jobsPanel = all ? `
  <section class="panel"><h2>Lowongan <small>${S.rec.jobs.length} posisi</small></h2>
    <div class="tablewrap"><table><thead><tr><th>Posisi</th><th>Divisi</th><th>Terisi</th><th>Kandidat aktif</th><th>Status</th></tr></thead><tbody>
    ${S.rec.jobs.map((j) => `<tr><td><div class="ttl">${esc(j.title)}</div></td><td>${esc(j.division)}</td><td class="mono">${hiredN(j.id)}/${j.openings}</td><td class="mono">${active.filter((c) => c.jobId === j.id).length}</td><td><span class="pill ${j.status === 'open' ? 'approved' : 'rejected'}">${j.status === 'open' ? 'Terbuka' : 'Ditutup'}</span></td></tr>`).join('')}
    </tbody></table></div></section>` : '';
  return `
  <div class="row"><div><h1>Rekrutmen</h1><p class="lead">${all ? 'Alur kandidat dari melamar sampai diterima. Klik kartu untuk detail, penilaian, atau memindahkan tahap.' : ''}</p></div>
    ${role === 'admin' ? '<div class="acts"><button class="btn" data-action="new-job">+ Lowongan</button><button class="btn primary" data-action="new-cand">+ Kandidat</button></div>' : ''}</div>
  ${tiles}${filter}
  ${cands.length ? `<div class="boardwrap"><div class="board">${board}</div></div>` : '<div class="panel empty">Belum ada kandidat.</div>'}
  ${all && rejected.length ? `<details class="panel"><summary>Kandidat ditolak (${rejected.length})</summary>${rejected.map((c) => `<div class="item2"><div class="nm"><button class="linkbtn" data-action="cand" data-id="${c.id}">${esc(c.name)}</button><span class="muted">${esc((jobOf(c.jobId) || {}).title || '')}</span></div><div class="muted" style="font-size:13px">${esc(c.rejectReason)}</div></div>`).join('')}</details>` : ''}
  ${jobsPanel}`;
};

function modalStatus(lines, kind = 'bad') {
  const box = $('#m-status');
  if (!box) return;
  box.innerHTML = lines.length ? `<div class="status ${kind}"><ul style="margin:0">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : '';
}

function openCandidate(id) {
  const c = candOf(id);
  if (!c) return;
  S.candId = id;
  const all = true;
  const job = jobOf(c.jobId);
  const ev = candEvals(id);
  const next = RC.nextStage(c.stage);
  const evHtml = ev.length ? ev.map((e) => `<div class="item2"><div class="nm"><span><b>${esc(pname(ctx(), e.interviewerId))}</b> <span class="muted">· ${RC.STAGE_LABEL[e.stage]}${e.recordedBy ? ` · dicatat ${esc(first(pname(ctx(), e.recordedBy)))}` : ''}</span></span><span class="mono">${e.score}/5 · ${e.recommend === 'lanjut' ? 'lanjut' : 'tidak lanjut'}</span></div>${e.note ? `<div class="muted" style="font-size:13px">${esc(e.note)}</div>` : ''}</div>`).join('') : '<div class="empty">Belum ada penilaian.</div>';
  let actions = '';
  if (RC.isFinal(c.stage)) {
    actions = c.stage === 'rejected' && c.rejectReason ? `<div class="status bad">Alasan penolakan: ${esc(c.rejectReason)}</div>` : '<div class="status ok">Kandidat sudah diterima.</div>';
  } else if (all) {
    if (canDriveStage(c)) {
      const errs = RC.checkMove(S.me, c, next, { job, evaluations: ev, hiredCount: hiredN(c.jobId), reason: '' });
      const label = next === 'hired' ? 'Setujui penawaran (Diterima)' : `Pindahkan ke ${RC.STAGE_LABEL[next]}`;
      actions = `<div class="acts"><button class="btn primary" data-action="cmove" data-id="${id}" data-to="${next}"${errs.length ? ' disabled' : ''}>${label}</button></div>
        ${errs.length ? `<div class="status warn" style="margin-top:8px"><ul style="margin:0">${errs.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
        <div class="field" style="margin-top:12px"><span>Tolak kandidat</span><input id="c-reason" maxlength="200" placeholder="Alasan penolakan (wajib)"></div>
        <button class="btn bad sm" data-action="creject" data-id="${id}" style="margin-top:6px">Tolak</button>`;
    } else if (c.stage === 'offer') {
      actions = '<div class="status warn">Menunggu keputusan Manager HR.</div>';
    } else {
      actions = '<div class="status warn">Tahap ini dikelola oleh Admin HR.</div>';
    }
    if (S.me.role === 'admin' && RC.INTERVIEW_STAGES.includes(c.stage)) {
      actions += `<div style="margin-top:12px"><button class="btn" data-action="cschedule" data-id="${id}">Jadwalkan interview</button></div>`;
    }
  }
  const pendingIds = unevaluated(c);
  const evalForm = isAdmin() && RC.INTERVIEW_STAGES.includes(c.stage) ? (pendingIds.length ? `
    <section style="margin-top:16px"><h2 style="font-size:15px">Isi penilaian <small class="muted">${RC.STAGE_LABEL[c.stage]}</small></h2>
      <div class="form" style="margin-top:8px">
        <label class="field full"><span>Atas nama pewawancara</span><select id="e-who">${pendingIds.map((i) => { const p = person(ctx(), i); return `<option value="${i}">${esc(p ? p.name + ' · ' + p.title : '?')}</option>`; }).join('')}</select></label>
        <label class="field"><span>Skor (1 sampai 5)</span><select id="e-score">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}"${n === 4 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span>Rekomendasi</span><select id="e-rec"><option value="lanjut">Lanjut</option><option value="tidak">Tidak lanjut</option></select></label>
        <label class="field full"><span>Catatan</span><textarea id="e-note" rows="2" maxlength="300" placeholder="Kekuatan dan hal yang perlu diperhatikan"></textarea></label>
        <div class="full"><button class="btn primary" data-action="ceval" data-id="${id}">Simpan penilaian</button></div>
      </div></section>` : `<div class="status warn" style="margin-top:16px">${interviewersOf(c).length ? 'Semua pewawancara sudah dinilai pada tahap ini.' : 'Belum ada jadwal interview untuk kandidat ini. Jadwalkan dulu supaya pewawancaranya tercatat.'}</div>`) : '';
  $('#modal').innerHTML = `
    <div class="row"><div><h1 id="mtitle" style="font-size:19px">${esc(c.name)}</h1><div class="muted" style="font-size:13.5px">${esc(job ? job.title : '-')} · ${esc(job ? job.division : '')}</div></div><button class="btn sm" data-action="close" aria-label="Tutup">Tutup</button></div>
    <div style="margin:12px 0">${STAGE_PILL(c.stage)} <span class="muted" style="font-size:13px">melamar ${esc(fmtShort(c.appliedOn))}${` · ${esc(c.email)} · ${esc(c.source)}`}</span></div>
    <section><h2 style="font-size:15px">Penilaian interview</h2>${evHtml}</section>
    ${evalForm}
    <section style="margin-top:16px">${actions}</section>
    <div id="m-status" style="margin-top:10px"></div>`;
  $('#overlay').hidden = false;
}

function openJobForm() {
  $('#modal').innerHTML = `
    <div class="row"><h1 id="mtitle" style="font-size:19px">Tambah lowongan</h1><button class="btn sm" data-action="close" aria-label="Tutup">Tutup</button></div>
    <div class="form" style="margin-top:12px">
      <label class="field full"><span>Nama posisi</span><input id="j-title" maxlength="80" placeholder="Contoh: Data Analyst"></label>
      <label class="field"><span>Divisi</span><select id="j-div">${DIVS.map((d) => `<option>${d}</option>`).join('')}</select></label>
      <label class="field"><span>Jumlah dicari</span><input id="j-n" type="number" min="1" max="50" value="1"></label>
      <div class="full" id="m-status"></div>
      <div class="full acts"><button class="btn primary" data-action="save-job">Simpan</button><button class="btn" data-action="close">Batal</button></div>
    </div>`;
  $('#overlay').hidden = false;
}

function openCandForm() {
  const open = S.rec.jobs.filter((j) => j.status === 'open');
  $('#modal').innerHTML = `
    <div class="row"><h1 id="mtitle" style="font-size:19px">Tambah kandidat</h1><button class="btn sm" data-action="close" aria-label="Tutup">Tutup</button></div>
    <div class="form" style="margin-top:12px">
      <label class="field full"><span>Lowongan</span><select id="k-job">${open.map((j) => `<option value="${j.id}">${esc(j.title)} (${esc(j.division)})</option>`).join('')}</select></label>
      <label class="field"><span>Nama</span><input id="k-name" maxlength="100" placeholder="Nama kandidat (fiktif)"></label>
      <label class="field"><span>Email</span><input id="k-email" type="email" maxlength="120" placeholder="nama@mail.example"></label>
      <label class="field"><span>Sumber</span><select id="k-src">${['LinkedIn', 'Referral', 'Situs perusahaan', 'Job fair', 'Lainnya'].map((s) => `<option>${s}</option>`).join('')}</select></label>
      <div class="full" id="m-status"></div>
      <div class="full acts"><button class="btn primary" data-action="save-cand"${open.length ? '' : ' disabled'}>Simpan</button><button class="btn" data-action="close">Batal</button></div>
    </div>`;
  $('#overlay').hidden = false;
}

/** Menjalankan aksi rekrutmen, lalu memuat ulang data dan membuka lagi kartu kandidat dengan data terbaru. */
async function recruitAction(fn, candId, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
  } catch (err) {
    if (err.status === 401) return;
    await reload(false);
    if (candId) openCandidate(candId);
    modalStatus(errorLines(err));
    return;
  }
  try { await reload(); } catch { return; }
  if (candId && candOf(candId)) openCandidate(candId); else closeModal();
}

/* ---------- Karyawan ---------- */
V.employees = () => {
  const c = ctx();
  const q = S.empQ.trim().toLowerCase();
  let rows = S.people.filter((p) => (S.empInactive || p.active) && (!q || `${p.name} ${p.title} ${p.div}`.toLowerCase().includes(q)));
  const body = rows.map((p) => `<tr><td><div class="ttl">${esc(p.name)}</div></td><td>${esc(p.title)}</td><td>${esc(p.div)}</td>
    <td class="mono">${remaining(p.id, c, null, false)}/${p.quota}</td>
    <td>${p.role ? `<span class="pill t-company">${ROLE_LABEL(p)}</span>` : '<span class="muted">Tanpa akun</span>'}</td>
    <td><span class="pill ${p.active ? 'approved' : 'rejected'}">${p.active ? 'Aktif' : 'Nonaktif'}</span></td>
    <td>${isAdmin() ? `<div class="acts"><button class="btn sm" data-action="edit-emp" data-id="${p.id}">Ubah</button></div>` : ''}</td></tr>`).join('');
  return `
  <div class="row"><div><h1>Karyawan</h1><p class="lead">Data karyawan satu tempat. Semua form (jadwal, cuti, penilaian) memilih nama dari daftar ini.</p></div>
    ${isAdmin() ? '<button class="btn primary" data-action="new-emp">+ Tambah karyawan</button>' : ''}</div>
  <div class="filters">
    <input id="eq" type="search" placeholder="Cari nama, jabatan, divisi" value="${esc(S.empQ)}" aria-label="Cari karyawan">
    <label class="chk" style="align-items:center"><input type="checkbox" id="einactive"${S.empInactive ? ' checked' : ''}><span>Tampilkan yang nonaktif</span></label>
  </div>
  <div class="tablewrap"><table><thead><tr><th>Nama</th><th>Jabatan</th><th>Divisi</th><th>Sisa cuti</th><th>Akun login</th><th>Status</th><th></th></tr></thead>
    <tbody>${body || '<tr><td colspan="7" class="empty" style="padding:16px">Tidak ada karyawan yang cocok.</td></tr>'}</tbody></table></div>`;
};

function openEmployee(id) {
  const p = id ? S.people.find((x) => x.id === id) : { name: '', div: 'HR', title: '', quota: 12, usedBefore: 0, active: true, role: null };
  S.editEmp = id;
  $('#modal').innerHTML = `
    <div class="row"><h1 id="mtitle" style="font-size:19px">${id ? 'Ubah karyawan' : 'Tambah karyawan'}</h1><button class="btn sm" data-action="close" aria-label="Tutup">Tutup</button></div>
    <div class="form" style="margin-top:12px">
      <label class="field full"><span>Nama</span><input id="m-name" maxlength="80" value="${esc(p.name)}" placeholder="Nama lengkap (fiktif)"></label>
      <label class="field"><span>Divisi</span><select id="m-div">${DIVS.map((d) => `<option${p.div === d ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
      <label class="field"><span>Jabatan</span><input id="m-title" maxlength="80" value="${esc(p.title)}" placeholder="Contoh: Data Analyst"></label>
      <label class="field"><span>Jatah cuti tahunan (hari)</span><input id="m-quota" type="number" min="0" max="30" value="${p.quota}"></label>
      <label class="field"><span>Cuti terpakai sebelumnya</span><input id="m-used" type="number" min="0" max="30" value="${p.usedBefore}"></label>
      ${id ? `<label class="chk full"><input type="checkbox" id="m-active"${p.active ? ' checked' : ''}${p.role ? ' disabled' : ''}><span>Karyawan aktif${p.role ? ' (punya akun login, tidak bisa dinonaktifkan)' : ' (nonaktif = tidak muncul di pilihan form, riwayat tetap ada)'}</span></label>` : ''}
      <div class="full" id="m-status"></div>
      <div class="full acts"><button class="btn primary" data-action="save-emp">Simpan</button><button class="btn" data-action="close">Batal</button></div>
    </div>`;
  $('#overlay').hidden = false;
}

/* ---------- Render ---------- */
const TABS = [['dashboard', 'Dashboard'], ['schedule', 'Jadwal'], ['leave', 'Cuti'], ['recruit', 'Rekrutmen'], ['employees', 'Karyawan']];
function render() {
  const pend = S.leaves.filter((l) => l.status === 'pending' && canApprove(l)).length;
  $('#tabs').innerHTML = TABS.map(([k, n]) => `<button class="tab" role="tab" aria-selected="${S.tab === k}" data-action="tab" data-tab="${k}">${n}${k === 'leave' && pend ? `<span class="n">${pend}</span>` : ''}${k === 'recruit' && recruitBadge() ? `<span class="n">${recruitBadge()}</span>` : ''}</button>`).join('');
  $('#view').innerHTML = V[S.tab]();
  if (S.tab === 'leave') updateLeavePreview();
}

/* ---------- Form cuti ---------- */
const leaveTarget = () => ($('#l-for') ? Number($('#l-for').value) : null);
function leaveBalanceHtml(uid) {
  const c = ctx();
  const p = person(c, uid);
  if (!p) return '';
  const sisa = remaining(uid, c, null, false);
  const pending = remaining(uid, c, null, true);
  return `<div class="mono" style="padding:8px 0;font-size:18px;font-weight:600">${sisa} <span class="muted" style="font-size:13px;font-family:var(--font-body)">dari ${p.quota} hari${pending !== sisa ? ` · ${sisa - pending} hari menunggu` : ''}</span></div>`;
}
const readLeave = () => ({ employeeId: leaveTarget(), type: $('#l-type').value, start: $('#l-start').value, end: $('#l-end').value });
function statusBox(errors, warnings, okText) {
  let html = '';
  if (errors.length) html += `<div class="status bad"><b>Tidak bisa diajukan</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
  else html += `<div class="status ok">${okText}</div>`;
  if (warnings.length) html += `<div class="status warn" style="margin-top:8px"><ul style="margin:0">${warnings.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
  return html;
}
function updateLeavePreview() {
  if (!$('#l-type')) return;
  const uid = leaveTarget();
  const p = person(ctx(), uid);
  $('#l-sisa').innerHTML = leaveBalanceHtml(uid);
  $('#l-div').textContent = p ? `${p.div} · ${p.title}` : '-';
  const r = checkLeave(readLeave(), ctx());
  $('#l-status').innerHTML = statusBox(r.errors, r.warnings, `Aman diajukan: <span class="mono">${r.days}</span> hari kerja, tanpa bentrok tim.`);
  $('#l-submit').disabled = r.errors.length > 0;
}
async function submitLeave() {
  const l = readLeave();
  if (checkLeave(l, ctx()).errors.length) return;
  $('#l-submit').disabled = true;
  try {
    await api('POST', '/api/leaves', { ...l, reason: $('#l-reason').value });
    toast(`Pengajuan atas nama ${first(pname(ctx(), l.employeeId))} terkirim, menunggu Manager HR.`);
    await reload();
  } catch (err) {
    if (err.status === 401) return;
    await reload(false);
    $('#l-status').innerHTML = statusBox(errorLines(err), [], '');
    $('#l-submit').disabled = false;
  }
}

/* ---------- Modal jadwal ---------- */
const empLabel = (p) => `${p.name} · ${p.title} (${p.div})`;
function openEvent(id, date, pre) {
  S.editId = id;
  const e = id ? S.events.find((x) => x.id === id) : { type: 'interview', title: '', candidate: '', candidateId: null, date: date || nextWorkday(), start: '09:00', end: '10:00', room: S.rooms[0].id, people: [], ownerId: null, attendees: 10, allHands: false, ...(pre || {}) };
  const candOpts = S.rec.candidates.filter((c) => !RC.isFinal(c.stage) || c.id === e.candidateId);
  const pickable = S.people.filter((p) => p.active || e.people.includes(p.id) || p.id === e.ownerId);
  const checks = DIVS.map((dv) => { const g = pickable.filter((p) => p.div === dv); return g.length ? `<fieldset class="pgroup"><legend>${dv}</legend>${g.map((p) => `<label class="chk"><input type="checkbox" name="p" value="${p.id}"${e.people.includes(p.id) ? ' checked' : ''}><span>${esc(p.name)}<small>${esc(p.title)}</small></span></label>`).join('')}</fieldset>` : ''; }).join('');
  $('#modal').innerHTML = `
    <div class="row"><h1 id="mtitle" style="font-size:19px">${id ? 'Ubah jadwal' : 'Tambah jadwal'}</h1><button class="btn sm" data-action="close" aria-label="Tutup">Tutup</button></div>
    <form id="eform" class="form">
      <label class="field"><span>Jenis</span><select id="f-type">${['interview', 'training', 'company'].map((k) => `<option value="${k}"${e.type === k ? ' selected' : ''}>${TYPE_LABEL[k]}</option>`).join('')}</select></label>
      <label class="field"><span>Ruang</span><select id="f-room">${S.rooms.map((r) => `<option value="${r.id}"${e.room === r.id ? ' selected' : ''}>${esc(r.name)} (maks. ${r.cap})</option>`).join('')}</select></label>
      <label class="field full"><span>Judul</span><input id="f-title" maxlength="120" value="${esc(e.title)}" placeholder="Contoh: Interview Data Analyst"></label>
      <label class="field full" id="f-cand-wrap"><span>Kandidat (dari menu Rekrutmen)</span>
        <select id="f-candid"><option value="">Pilih kandidat</option>${candOpts.map((c) => `<option value="${c.id}"${e.candidateId === c.id ? ' selected' : ''}>${esc(c.name)} · ${esc((jobOf(c.jobId) || {}).title || '')} (${RC.STAGE_LABEL[c.stage]})</option>`).join('')}</select></label>
      <label class="field full" id="f-owner-wrap"><span>Penanggung jawab</span>
        <select id="f-owner"><option value="">Pilih karyawan</option>${pickable.map((p) => `<option value="${p.id}"${e.ownerId === p.id ? ' selected' : ''}>${esc(empLabel(p))}</option>`).join('')}</select></label>
      <label class="field" id="f-att-wrap"><span>Jumlah peserta</span><input type="number" id="f-att" min="1" max="500" value="${e.attendees || 10}"></label>
      <label class="chk" id="f-all-wrap" style="align-self:end"><input type="checkbox" id="f-all"${e.allHands ? ' checked' : ''}><span>Seluruh karyawan diundang</span></label>
      <label class="field"><span>Tanggal</span><input type="date" id="f-date" value="${e.date}"></label>
      <div class="form" style="grid-template-columns:1fr 1fr;gap:12px">
        <label class="field"><span>Mulai</span><input type="time" id="f-start" value="${e.start}"></label>
        <label class="field"><span>Selesai</span><input type="time" id="f-end" value="${e.end}"></label>
      </div>
      <fieldset class="field full" id="f-people-wrap" style="border:0;padding:0;margin:0"><legend>Pewawancara (nama dan jabatan)</legend><div class="plist">${checks}</div></fieldset>
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
  const d = {
    type, title: $('#f-title').value.trim(),
    candidateId: type === 'interview' && $('#f-candid').value ? Number($('#f-candid').value) : null,
    date: $('#f-date').value, start: $('#f-start').value, end: $('#f-end').value, room: $('#f-room').value, allHands: all,
  };
  if (type === 'interview') {
    d.people = [...document.querySelectorAll('#eform input[name="p"]:checked')].map((i) => +i.value);
    d.attendees = d.people.length + 1;
    const c = d.candidateId ? candOf(d.candidateId) : null;
    d.candidate = c ? c.name : '';
  } else {
    d.ownerId = $('#f-owner').value ? Number($('#f-owner').value) : null;
    d.people = d.ownerId ? [d.ownerId] : [];
    d.attendees = all ? undefined : parseInt($('#f-att').value, 10);
  }
  return d;
}
function eventStatusHtml(issues, d) {
  if (issues.length) return `<div class="status bad"><b>${issues.length} bentrok atau masalah</b><ul>${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
  return '<div class="status ok">Tidak ada bentrok. Jadwal siap disimpan.</div>';
}
function eventMissing(d) {
  if (!d.title) return 'Isi judul.';
  if (d.type === 'interview' && !d.candidateId) return 'Pilih kandidat.';
  if (d.type === 'interview' && !d.people.length) return 'Pilih minimal satu pewawancara.';
  if (d.type !== 'interview' && !d.ownerId) return 'Pilih penanggung jawab.';
  return '';
}
function syncEventForm() {
  if (!$('#eform')) return; // modal yang terbuka bukan form jadwal
  const cid = $('#f-candid').value;
  if (cid && !$('#f-title').value.trim()) {
    const c = candOf(Number(cid));
    if (c) $('#f-title').value = `Interview ${(jobOf(c.jobId) || {}).title || ''}`.trim();
  }
  const d = readEvent();
  const iv = d.type === 'interview';
  $('#f-cand-wrap').hidden = !iv;
  $('#f-people-wrap').hidden = !iv;
  $('#f-owner-wrap').hidden = iv;
  $('#f-att-wrap').hidden = iv || d.allHands;
  $('#f-all-wrap').hidden = d.type !== 'company';
  const issues = checkEvent(d, ctx(), S.editId).map((i) => i.msg);
  const missing = eventMissing(d);
  $('#f-status').innerHTML = issues.length || !missing ? eventStatusHtml(issues, d) : `<div class="status warn">${esc(missing)}</div>`;
  $('#f-save').disabled = issues.length > 0 || !!missing;
}
function closeModal() { $('#overlay').hidden = true; S.editId = null; }
async function saveEvent() {
  const d = readEvent();
  if (checkEvent(d, ctx(), S.editId).length || eventMissing(d)) return;
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
  const [d, rec] = await Promise.all([api('GET', '/api/bootstrap'), api('GET', '/api/recruit')]);
  S.me = d.me; S.people = d.people; S.rooms = d.rooms; S.events = d.events; S.leaves = d.leaves; S.rec = rec;
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
  $('#demo-list').innerHTML = S.demo.accounts.map((a) => `<button type="button" class="demo-btn" data-action="demo" data-email="${esc(a.email)}"><span><b>${esc(ROLE_LABEL({ role: a.role, div: a.div }))}</b><br><small>${esc(ROLE_HINT[a.role] || '')}</small></span><small>${esc(a.name)}</small></button>`).join('');
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
  else if (a === 'jview') { S.jview = b.dataset.v; render(); }
  else if (a === 'new-emp') { if (isAdmin()) openEmployee(null); }
  else if (a === 'edit-emp') { if (isAdmin()) openEmployee(id); }
  else if (a === 'save-emp') {
    const body = { name: $('#m-name').value, div: $('#m-div').value, title: $('#m-title').value, quota: parseInt($('#m-quota').value, 10), usedBefore: parseInt($('#m-used').value, 10) };
    if (S.editEmp) body.active = $('#m-active') ? $('#m-active').checked : true;
    try {
      await api(S.editEmp ? 'PUT' : 'POST', S.editEmp ? `/api/employees/${S.editEmp}` : '/api/employees', body);
      toast('Data karyawan disimpan.');
      closeModal();
      await reload();
    } catch (err) { if (err.status !== 401) modalStatus(errorLines(err)); }
  }
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
  else if (a === 'cand') openCandidate(id);
  else if (a === 'new-job') { if (S.me.role === 'admin') openJobForm(); }
  else if (a === 'new-cand') { if (S.me.role === 'admin') openCandForm(); }
  else if (a === 'save-job') {
    const body = { title: $('#j-title').value, division: $('#j-div').value, openings: Number($('#j-n').value) };
    try { await api('POST', '/api/recruit/jobs', body); toast('Lowongan ditambahkan.'); await reload(); closeModal(); } catch (err) { if (err.status !== 401) modalStatus(errorLines(err)); }
  }
  else if (a === 'save-cand') {
    const body = { jobId: Number($('#k-job').value), name: $('#k-name').value, email: $('#k-email').value, source: $('#k-src').value };
    try { const r = await api('POST', '/api/recruit/candidates', body); toast('Kandidat ditambahkan.'); await reload(); openCandidate(r.candidate.id); } catch (err) { if (err.status !== 401) modalStatus(errorLines(err)); }
  }
  else if (a === 'cmove') recruitAction(() => api('POST', `/api/recruit/candidates/${id}/move`, { to: b.dataset.to }), id, b.dataset.to === 'hired' ? 'Penawaran disetujui, kandidat diterima.' : 'Tahap kandidat diperbarui.');
  else if (a === 'creject') recruitAction(() => api('POST', `/api/recruit/candidates/${id}/move`, { to: 'rejected', reason: $('#c-reason').value }), id, 'Kandidat ditolak.');
  else if (a === 'ceval') recruitAction(() => api('POST', `/api/recruit/candidates/${id}/evaluations`, { interviewerId: Number($('#e-who').value), score: Number($('#e-score').value), recommend: $('#e-rec').value, note: $('#e-note').value }), id, 'Penilaian tersimpan.');
  else if (a === 'cschedule') {
    const c = candOf(id);
    closeModal();
    openEvent(null, null, { type: 'interview', candidateId: id, candidate: c.name, title: `Interview ${(jobOf(c.jobId) || {}).title || ''}`.trim() });
  }
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
  } else if (id === 'eq') {
    S.empQ = ev.target.value;
    const pos = ev.target.selectionStart;
    render();
    const i = $('#eq');
    i.focus();
    i.setSelectionRange(pos, pos);
  } else if (id === 'l-start' || id === 'l-end' || id === 'l-type' || id === 'l-for') updateLeavePreview();
});
$('#view').addEventListener('change', (ev) => {
  const id = ev.target.id;
  if (id === 'ltype') { S.listType = ev.target.value; render(); }
  else if (id === 'lpast') { S.listPast = ev.target.checked; render(); }
  else if (id === 'einactive') { S.empInactive = ev.target.checked; render(); }
  else if (id === 'lf') { S.leaveFilter = ev.target.value; render(); }
  else if (id === 'rjob') { S.recJob = ev.target.value; render(); }
  else if (id === 'l-start' || id === 'l-end' || id === 'l-type' || id === 'l-for') updateLeavePreview();
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
