const express = require('express');
const router = express.Router();
// db handles persistent storage
const crypto = require('crypto');

const db = require('../db');
const ADMIN_KEY = process.env.ADMIN_API_KEY || 'dev_admin_key_change_me';

function requireAdmin(req, res, next) {
  const key = req.header('x-admin-key') || req.query.adminKey || req.body.adminKey;
  if (!key || key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function generateCode(prefix = '', length = 10) {
  const raw = crypto.randomBytes(Math.ceil(length / 2)).toString('hex').toUpperCase();
  const code = (prefix ? `${prefix}-` : '') + raw.slice(0, length);
  return code;
}

// GET /admin/codes  - list codes
router.get('/admin/codes', requireAdmin, (req, res) => {
  try {
    const codes = db.getCodes();
    return res.json(codes);
  } catch (err) {
    console.error('read codes list failed', err?.message || err);
    return res.status(500).json({ error: 'server error' });
  }
});

// POST /admin/codes - create single or multiple codes
// body: { count?: number, prefix?: string, length?: number }
router.post('/admin/codes', requireAdmin, (req, res) => {
  const { count = 1, prefix = '', length = 10 } = req.body || {};
  const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), 1000);

  const created = [];
  for (let i = 0; i < n; i++) {
    const c = generateCode(prefix, Math.max(6, Math.min(length, 32)));
    const entry = { code: c, activatedAt: null, meta: null };
    created.push(entry);
  }

  try {
    db.createCodes(created);
  } catch (err) {
    console.error('failed to persist codes', err?.message || err);
    return res.status(500).json({ error: 'failed to save codes' });
  }

  res.json({ created });
});

// GET /admin/codes/export - CSV export
router.get('/admin/codes/export', requireAdmin, (req, res) => {
  try {
    const codes = db.getCodes();
    const csv = codes.map((c) => `${c.code},${c.activatedAt || ''}`).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="codes.csv"');
    res.send('code,activatedAt\n' + csv);
  } catch (err) {
    console.error('failed export', err?.message || err);
    return res.status(500).send('server error');
  }
});

module.exports = router;
