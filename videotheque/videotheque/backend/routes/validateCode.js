const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const codesFilePath = path.join(__dirname, '../data/codes.json');

// POST /validate — validate code, set activatedAt on first use and check 1 hour validity
router.post('/validate', (req, res) => {
	const { code } = req.body || {};
	if (!code) return res.status(400).json({ valid: false, message: 'Code manquant.' });

	let codes = [];
	try {
		if (!fs.existsSync(codesFilePath)) return res.json({ valid: false });
		codes = JSON.parse(fs.readFileSync(codesFilePath, 'utf-8'));
	} catch (err) {
		console.error('Error reading codes.json:', err?.message || err);
		return res.status(500).json({ valid: false, message: 'Erreur serveur.' });
	}

	const entry = codes.find((c) => c.code === code);
	if (!entry) return res.json({ valid: false });

	const now = Date.now();
	// if never activated, activate now
	if (!entry.activatedAt) {
		entry.activatedAt = now;
		try {
			fs.writeFileSync(codesFilePath, JSON.stringify(codes, null, 2));
		} catch (writeErr) {
			console.warn('Failed to persist activation timestamp:', writeErr?.message || writeErr);
		}
		return res.json({ valid: true });
	}

	const oneHour = 60 * 60 * 1000;
	const isValid = now - entry.activatedAt <= oneHour;
	return res.json({ valid: isValid });
});

module.exports = router;