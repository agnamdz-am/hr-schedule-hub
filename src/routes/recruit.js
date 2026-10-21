const express = require('express');
const { requireRole } = require('../middleware/auth');
const { inTransaction } = require('../db');
const R = require('../recruit');
const { DIVISIONS } = require('../validate');

const SOURCES = ['LinkedIn', 'Referral', 'Situs perusahaan', 'Job fair', 'Lainnya'];

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const JOB_SQL = 'SELECT id, title, division, openings, status, opened_on AS openedOn FROM jobs ORDER BY id';
const CAND_SQL = `SELECT id, job_id AS jobId, name, email, source, stage, applied_on AS appliedOn,
                         stage_changed_on AS stageChangedOn, reject_reason AS rejectReason FROM candidates ORDER BY id`;
const EVAL_SQL = `SELECT id, candidate_id AS candidateId, interviewer_id AS interviewerId, stage, score, recommend, note,
                         recorded_by AS recordedBy, created_on AS createdOn FROM evaluations ORDER BY id`;

function recruitRoutes(db) {
  const router = express.Router();

  const getJob = (id) => db.prepare(JOB_SQL.replace('ORDER BY id', 'WHERE id = ?')).get(id);
  const getCand = (id) => db.prepare(CAND_SQL.replace('ORDER BY id', 'WHERE id = ?')).get(id);
  const evalsOf = (candId) => db.prepare(EVAL_SQL.replace('ORDER BY id', 'WHERE candidate_id = ? ORDER BY id')).all(candId);
  const hiredCount = (jobId) => db.prepare("SELECT COUNT(*) AS n FROM candidates WHERE job_id = ? AND stage = 'hired'").get(jobId).n;

  router.get('/', (req, res) => {
    res.json({ jobs: db.prepare(JOB_SQL).all(), candidates: db.prepare(CAND_SQL).all(), evaluations: db.prepare(EVAL_SQL).all() });
  });

  router.post('/jobs', requireRole('admin'), (req, res) => {
    const b = req.body || {};
    const title = cleanText(b.title, 80);
    const openings = Number(b.openings);
    const errors = [];
    if (!title) errors.push('Nama posisi wajib diisi.');
    if (!DIVISIONS.includes(b.division)) errors.push('Divisi tidak valid.');
    if (!Number.isInteger(openings) || openings < 1 || openings > 50) errors.push('Jumlah kebutuhan harus 1 sampai 50.');
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    const info = db.prepare("INSERT INTO jobs (title, division, openings, status, opened_on) VALUES (?, ?, ?, 'open', ?)")
      .run(title, b.division, openings, today());
    res.status(201).json({ job: getJob(Number(info.lastInsertRowid)) });
  });

  router.post('/candidates', requireRole('admin'), (req, res) => {
    const b = req.body || {};
    const name = cleanText(b.name, 100);
    const email = cleanText(b.email, 120).toLowerCase();
    const source = SOURCES.includes(b.source) ? b.source : 'Lainnya';
    const job = Number.isInteger(b.jobId) ? getJob(b.jobId) : null;
    const errors = [];
    if (name.length < 2) errors.push('Nama kandidat wajib diisi.');
    if (!EMAIL_RE.test(email)) errors.push('Format email tidak valid.');
    if (!job) errors.push('Lowongan tidak ditemukan.');
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    if (job.status === 'closed') return res.status(409).json({ error: 'Lowongan sudah ditutup, tidak menerima pelamar baru.' });
    const dup = db.prepare('SELECT id FROM candidates WHERE job_id = ? AND email = ?').get(job.id, email);
    if (dup) return res.status(409).json({ error: 'Kandidat dengan email ini sudah melamar ke lowongan yang sama.' });
    const t = today();
    const info = db
      .prepare("INSERT INTO candidates (job_id, name, email, source, stage, applied_on, stage_changed_on) VALUES (?, ?, ?, ?, 'applied', ?, ?)")
      .run(job.id, name, email, source, t, t);
    res.status(201).json({ candidate: getCand(Number(info.lastInsertRowid)) });
  });

  // Pindah tahap. Aturan lengkapnya ada di recruit.js; di sini hanya mengumpulkan data dan menyimpan hasilnya.
  router.post('/candidates/:id/move', requireRole('admin', 'hr_manager'), (req, res) => {
    const cand = getCand(Number(req.params.id));
    if (!cand) return res.status(404).json({ error: 'Kandidat tidak ditemukan.' });
    const to = req.body && req.body.to;
    const reason = cleanText(req.body && req.body.reason, 200);
    if (![...R.STAGES, 'rejected'].includes(to)) return res.status(400).json({ error: 'Tahap tujuan tidak valid.' });
    const job = getJob(cand.jobId);
    const errors = R.checkMove(req.user, cand, to, { job, evaluations: evalsOf(cand.id), hiredCount: hiredCount(job.id), reason });
    if (errors.length) return res.status(409).json({ error: errors[0], errors });
    inTransaction(db, () => {
      db.prepare('UPDATE candidates SET stage = ?, stage_changed_on = ?, reject_reason = ? WHERE id = ?')
        .run(to, today(), to === 'rejected' ? reason : '', cand.id);
      // Kuota terpenuhi: lowongan otomatis ditutup.
      if (to === 'hired' && hiredCount(job.id) >= job.openings) db.prepare("UPDATE jobs SET status = 'closed' WHERE id = ?").run(job.id);
    });
    res.json({ candidate: getCand(cand.id), job: getJob(job.id) });
  });

  // Admin HR mengisi penilaian atas nama pewawancara yang tercatat di jadwal interview kandidat.
  router.post('/candidates/:id/evaluations', requireRole('admin'), (req, res) => {
    const cand = getCand(Number(req.params.id));
    if (!cand) return res.status(404).json({ error: 'Kandidat tidak ditemukan.' });
    const b = req.body || {};
    const input = { interviewerId: b.interviewerId, score: b.score, recommend: b.recommend, note: cleanText(b.note, 300) };
    const interviewerIds = db
      .prepare("SELECT DISTINCT p.employee_id AS id FROM events e JOIN event_participants p ON p.event_id = e.id WHERE e.candidate_id = ? AND e.type = 'interview'")
      .all(cand.id)
      .map((r) => r.id);
    const errors = R.checkEvaluation(req.user, cand, input, evalsOf(cand.id), interviewerIds);
    if (errors.length) return res.status(409).json({ error: errors[0], errors });
    db.prepare('INSERT INTO evaluations (candidate_id, interviewer_id, recorded_by, stage, score, recommend, note, created_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(cand.id, input.interviewerId, req.user.id, cand.stage, input.score, input.recommend, input.note, today());
    res.status(201).json({ evaluations: db.prepare(EVAL_SQL).all() });
  });

  return router;
}

module.exports = recruitRoutes;
