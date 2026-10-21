const express = require('express');
const { requireRole } = require('../middleware/auth');
const { loadCtx, getEvents, insertEvent, updateEvent } = require('../db');
const { checkEvent } = require('../logic');
const { parseEventInput } = require('../validate');

function eventRoutes(db) {
  const router = express.Router();

  router.get('/', (req, res) => res.json({ events: getEvents(db) }));

  /** Bila jadwal ditautkan ke kandidat terdaftar, nama kandidat diambil dari data kandidat (bukan dari input klien). */
  const linkCandidate = (value) => {
    if (!value.candidateId) return null;
    const c = db.prepare('SELECT name FROM candidates WHERE id = ?').get(value.candidateId);
    if (!c) return 'Kandidat tidak ditemukan.';
    value.candidate = c.name;
    return null;
  };

  // Simpan hanya jika tidak bentrok. Pengecekan dan penulisan berjalan sinkron di satu proses
  // (node:sqlite bersifat sinkron), jadi tidak ada celah dua permintaan menyelip di antaranya.
  router.post('/', requireRole('admin'), (req, res) => {
    const ctx = loadCtx(db);
    const parsed = parseEventInput(req.body, ctx);
    if (parsed.errors) return res.status(400).json({ error: parsed.errors[0], errors: parsed.errors });
    const linkErr = linkCandidate(parsed.value);
    if (linkErr) return res.status(400).json({ error: linkErr, errors: [linkErr] });
    const conflicts = checkEvent(parsed.value, ctx, null);
    if (conflicts.length) return res.status(409).json({ error: 'Jadwal bentrok.', conflicts });
    const id = insertEvent(db, parsed.value, req.user.id);
    res.status(201).json({ event: getEvents(db).find((e) => e.id === id) });
  });

  router.put('/:id', requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const ctx = loadCtx(db);
    if (!ctx.events.some((e) => e.id === id)) return res.status(404).json({ error: 'Jadwal tidak ditemukan.' });
    const parsed = parseEventInput(req.body, ctx);
    if (parsed.errors) return res.status(400).json({ error: parsed.errors[0], errors: parsed.errors });
    const linkErr = linkCandidate(parsed.value);
    if (linkErr) return res.status(400).json({ error: linkErr, errors: [linkErr] });
    const conflicts = checkEvent(parsed.value, ctx, id);
    if (conflicts.length) return res.status(409).json({ error: 'Jadwal bentrok.', conflicts });
    updateEvent(db, id, parsed.value);
    res.json({ event: getEvents(db).find((e) => e.id === id) });
  });

  router.delete('/:id', requireRole('admin'), (req, res) => {
    const info = db.prepare('DELETE FROM events WHERE id = ?').run(Number(req.params.id));
    if (!info.changes) return res.status(404).json({ error: 'Jadwal tidak ditemukan.' });
    res.json({ ok: true });
  });

  return router;
}

module.exports = eventRoutes;
