const express = require('express');
const { loadCtx, getLeaves } = require('../db');
const { checkLeave, checkApproval, canApprove } = require('../logic');
const { parseLeaveInput } = require('../validate');

/** Tanggal hari ini (YYYY-MM-DD) di zona waktu perusahaan, bukan zona waktu server. */
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

function leaveRoutes(db) {
  const router = express.Router();

  router.get('/', (req, res) => res.json({ leaves: getLeaves(db) }));

  router.post('/', (req, res) => {
    const parsed = parseLeaveInput(req.body);
    if (parsed.errors) return res.status(400).json({ error: parsed.errors[0], errors: parsed.errors });
    const ctx = { ...loadCtx(db), today: today() };
    const draft = { userId: req.user.id, ...parsed.value };
    const result = checkLeave(draft, ctx);
    if (result.errors.length) return res.status(409).json({ error: result.errors[0], errors: result.errors, warnings: result.warnings });
    const info = db
      .prepare("INSERT INTO leaves (user_id,type,start_date,end_date,reason,status) VALUES (?,?,?,?,?,'pending')")
      .run(req.user.id, draft.type, draft.start, draft.end, draft.reason);
    const leave = getLeaves(db).find((l) => l.id === Number(info.lastInsertRowid));
    res.status(201).json({ leave, warnings: result.warnings });
  });

  function decide(status) {
    return (req, res) => {
      const id = Number(req.params.id);
      const ctx = loadCtx(db);
      const leave = ctx.leaves.find((l) => l.id === id);
      if (!leave) return res.status(404).json({ error: 'Pengajuan tidak ditemukan.' });
      if (!canApprove(req.user, leave, ctx)) return res.status(403).json({ error: 'Kamu tidak berwenang memproses pengajuan ini.' });
      if (leave.status !== 'pending') return res.status(409).json({ error: 'Pengajuan ini sudah diproses.' });
      if (status === 'approved') {
        const errors = checkApproval(leave, ctx);
        if (errors.length) return res.status(409).json({ error: errors[0], errors });
      }
      const note = status === 'rejected' && typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 200) : '';
      db.prepare('UPDATE leaves SET status=?, decided_by=?, note=? WHERE id=?').run(status, req.user.id, note, id);
      res.json({ leave: getLeaves(db).find((l) => l.id === id) });
    };
  }

  router.post('/:id/approve', decide('approved'));
  router.post('/:id/reject', decide('rejected'));

  return router;
}

module.exports = leaveRoutes;
