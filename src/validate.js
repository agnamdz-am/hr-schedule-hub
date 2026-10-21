/* Validasi input dari klien. Tidak ada data dari request yang dipercaya apa adanya. */

const EVENT_TYPES = ['interview', 'training', 'company'];
const LEAVE_TYPES = ['tahunan', 'sakit', 'izin'];

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const DIVISIONS = ['HR', 'IT', 'Finance', 'Marketing', 'Operations'];

const activeEmp = (ctx, id) => ctx.people.some((p) => p.id === id && p.active);

/** Mengembalikan { value } bila valid, atau { errors: [...] }. */
function parseEventInput(body, ctx) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};
  if (!EVENT_TYPES.includes(b.type)) errors.push('Jenis jadwal tidak valid.');
  const title = cleanText(b.title, 120);
  if (!title) errors.push('Judul wajib diisi.');
  if (!isDate(b.date)) errors.push('Tanggal tidak valid (format YYYY-MM-DD).');
  if (!isTime(b.start) || !isTime(b.end)) errors.push('Jam harus berformat HH:MM.');
  if (!ctx.rooms.some((r) => r.id === b.room)) errors.push('Ruang tidak ditemukan.');
  const allHands = b.type === 'company' && b.allHands === true;
  let people = [];
  let ownerId = null;
  let attendees = 1;
  if (b.type === 'interview') {
    if (!Array.isArray(b.people) || b.people.length === 0) errors.push('Pilih minimal satu pewawancara.');
    else {
      people = [...new Set(b.people.map(Number))];
      if (people.some((id) => !Number.isInteger(id) || !activeEmp(ctx, id))) errors.push('Ada pewawancara yang tidak dikenal atau sudah tidak aktif.');
    }
    attendees = people.length + 1; // pewawancara + kandidat
  } else if (EVENT_TYPES.includes(b.type)) {
    if (!Number.isInteger(b.ownerId) || !activeEmp(ctx, b.ownerId)) errors.push('Pilih penanggung jawab dari daftar karyawan.');
    else {
      ownerId = b.ownerId;
      people = [ownerId];
    }
    if (allHands) attendees = ctx.people.filter((p) => p.active).length;
    else if (!Number.isInteger(b.attendees) || b.attendees < 1 || b.attendees > 500) errors.push('Jumlah peserta harus 1 sampai 500.');
    else attendees = b.attendees;
  }
  if (errors.length) return { errors };
  return {
    value: {
      type: b.type,
      title,
      date: b.date,
      start: b.start,
      end: b.end,
      room: b.room,
      allHands,
      people,
      ownerId,
      attendees,
      candidate: b.type === 'interview' ? cleanText(b.candidate, 100) : '',
      candidateId: b.type === 'interview' && Number.isInteger(b.candidateId) ? b.candidateId : null,
    },
  };
}

function parseLeaveInput(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};
  if (!Number.isInteger(b.employeeId)) errors.push('Pilih karyawan.');
  if (!LEAVE_TYPES.includes(b.type)) errors.push('Jenis cuti tidak valid.');
  if (!isDate(b.start) || !isDate(b.end)) errors.push('Tanggal tidak valid (format YYYY-MM-DD).');
  if (errors.length) return { errors };
  return { value: { employeeId: b.employeeId, type: b.type, start: b.start, end: b.end, reason: cleanText(b.reason, 200) || '-' } };
}

/** Data karyawan untuk menambah/mengubah. */
function parseEmployeeInput(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};
  const name = cleanText(b.name, 80);
  const title = cleanText(b.title, 80);
  if (name.length < 2) errors.push('Nama karyawan wajib diisi.');
  if (!DIVISIONS.includes(b.div)) errors.push('Divisi tidak valid.');
  if (title.length < 2) errors.push('Jabatan wajib diisi.');
  const quota = b.quota === undefined ? 12 : b.quota;
  if (!Number.isInteger(quota) || quota < 0 || quota > 30) errors.push('Jatah cuti harus 0 sampai 30 hari.');
  const usedBefore = b.usedBefore === undefined ? 0 : b.usedBefore;
  if (!Number.isInteger(usedBefore) || usedBefore < 0 || usedBefore > 30) errors.push('Cuti terpakai harus 0 sampai 30 hari.');
  if (errors.length) return { errors };
  return { value: { name, div: b.div, title, quota, usedBefore } };
}

module.exports = { DIVISIONS, isDate, isTime, parseEventInput, parseLeaveInput, parseEmployeeInput };
