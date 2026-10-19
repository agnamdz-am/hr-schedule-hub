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
  if (!allHands) {
    if (!Array.isArray(b.people) || b.people.length === 0) errors.push('Pilih minimal satu peserta.');
    else {
      people = [...new Set(b.people.map(Number))];
      if (people.some((id) => !Number.isInteger(id) || !ctx.people.some((p) => p.id === id))) {
        errors.push('Ada peserta yang tidak dikenal.');
      }
    }
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
      candidate: b.type === 'interview' ? cleanText(b.candidate, 100) : '',
    },
  };
}

function parseLeaveInput(body) {
  const errors = [];
  const b = body && typeof body === 'object' ? body : {};
  if (!LEAVE_TYPES.includes(b.type)) errors.push('Jenis cuti tidak valid.');
  if (!isDate(b.start) || !isDate(b.end)) errors.push('Tanggal tidak valid (format YYYY-MM-DD).');
  if (errors.length) return { errors };
  return { value: { type: b.type, start: b.start, end: b.end, reason: cleanText(b.reason, 200) || '-' } };
}

module.exports = { isDate, isTime, parseEventInput, parseLeaveInput };
