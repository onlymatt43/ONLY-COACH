const express = require('express');
// persistence handled by ../db
const db = require('../db');
const router = express.Router();

const codesFilePath = path.join(__dirname, '../data/codes.json');

// POST /validate — validate code, set activatedAt on first use and check 1 hour validity
router.post('/validate', (req, res) => {
	const { code } = req.body || {};
	if (!code) return res.status(400).json({ valid: false, message: 'Code manquant.' });

	const entry = db.findCode(code);
	if (!entry) return res.json({ valid: false });

	const now = Date.now();
	// if never activated, activate now
	if (!entry.activatedAt) {
		// activate using DB
		try {
			db.activateCode(code, now);
		} catch (e) {
			console.warn('failed to persist activatedAt in DB:', e?.message || e);
		}
		return res.json({ valid: true });
	}

	const oneHour = 60 * 60 * 1000;
	const isValid = now - entry.activatedAt <= oneHour;
	return res.json({ valid: isValid });
});

module.exports = router;