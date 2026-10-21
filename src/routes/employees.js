const express = require('express');
const { requireRole } = require('../middleware/auth');
const { getPeople } = require('../db');
const { parseEmployeeInput } = require('../validate');

/** Data karyawan (master). Hanya Admin HR yang boleh mengubah. */
function employeeRoutes(db) {
  const router = express.Router();
  const one = (id) => getPeople(db).find((p) => p.id === id);

  router.get('/', (req, res) => res.json({ people: getPeople(db) }));

  router.post('/', requireRole('admin'), (req, res) => {
    const parsed = parseEmployeeInput(req.body);
    if (parsed.errors) return res.status(400).json({ error: parsed.errors[0], errors: parsed.errors });
    const v = parsed.value;
    const info = db
      .prepare('INSERT INTO employees (name, division, title, quota, used_before, active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(v.name, v.div, v.title, v.quota, v.usedBefore);
    res.status(201).json({ person: one(Number(info.lastInsertRowid)) });
  });

  router.put('/:id', requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const cur = one(id);
    if (!cur) return res.status(404).json({ error: 'Karyawan tidak ditemukan.' });
    const parsed = parseEmployeeInput({ usedBefore: cur.usedBefore, ...req.body });
    if (parsed.errors) return res.status(400).json({ error: parsed.errors[0], errors: parsed.errors });
    const active = req.body && req.body.active === false ? 0 : 1;
    if (!active && cur.role) return res.status(409).json({ error: 'Karyawan yang punya akun login tidak bisa dinonaktifkan.' });
    const v = parsed.value;
    db.prepare('UPDATE employees SET name = ?, division = ?, title = ?, quota = ?, used_before = ?, active = ? WHERE id = ?')
      .run(v.name, v.div, v.title, v.quota, v.usedBefore, active, id);
    res.json({ person: one(id) });
  });

  return router;
}

module.exports = employeeRoutes;
