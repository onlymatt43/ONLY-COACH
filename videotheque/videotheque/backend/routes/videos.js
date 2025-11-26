const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_LIBRARY_ID = process.env.BUNNY_LIBRARY_ID;

const localVideosPath = path.join(__dirname, '../data/videos.json');
const codesPath = path.join(__dirname, '../data/codes.json');
const jwt = require('jsonwebtoken');
const VIDEO_TOKEN_SECRET = process.env.VIDEO_TOKEN_SECRET || process.env.SESSION_SECRET || 'dev_secret_change_me';

// GET /videos — prefer Bunny API when BUNNY env vars exist. Otherwise read local videos.json.
router.get('/videos', async (req, res) => {
  // if Bunny env vars present, try calling Bunny API
  if (BUNNY_API_KEY && BUNNY_LIBRARY_ID) {
    try {
      const response = await axios.get(
        `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`,
        { headers: { AccessKey: BUNNY_API_KEY } }
      );

      const videos = (response.data.items || []).map((video) => ({
        id: video.guid,
        title: video.title,
        category: video.category || 'Autres',
        previewUrl: `https://iframe.mediadelivery.net/embed/${video.guid}`,
        fullUrl: `https://iframe.mediadelivery.net/embed/${video.guid}`,
      }));

      return res.json(videos);
    } catch (err) {
      console.error('Bunny API failed, falling back to local videos.json —', err?.message || err);
      // fall through to local file
    }
  }

  // fallback to local file
  try {
    if (!fs.existsSync(localVideosPath)) return res.status(404).json({ error: 'No videos available.' });
    const raw = fs.readFileSync(localVideosPath, 'utf-8');
    const videos = JSON.parse(raw);
    return res.json(videos);
  } catch (fileErr) {
    console.error('Failed to load local videos.json:', fileErr?.message || fileErr);
    return res.status(500).json({ error: 'Unable to load videos.' });
  }
});

// POST /videos/:id/access — require a `code` in body, ensure it is valid/active,
// issue a short-lived (1h) JWT token linking to the requested video id.
router.post('/videos/:id/access', (req, res) => {
  const { id } = req.params;
  const { code } = req.body || {};

  if (!code) return res.status(401).json({ error: 'Missing code' });

  // read codes and validate/activate
  let codes = [];
  try {
    if (!fs.existsSync(codesPath)) return res.status(403).json({ error: 'No codes configured' });
    codes = JSON.parse(fs.readFileSync(codesPath, 'utf-8'));
  } catch (err) {
    console.error('Error reading codes.json for access:', err?.message || err);
    return res.status(500).json({ error: 'Server error' });
  }

  const entry = codes.find((c) => c.code === code);
  if (!entry) return res.status(403).json({ error: 'Invalid code' });

  const now = Date.now();
  if (!entry.activatedAt) {
    entry.activatedAt = now;
    try {
      fs.writeFileSync(codesPath, JSON.stringify(codes, null, 2));
    } catch (writeErr) {
      console.warn('Failed to persist activation timestamp on access:', writeErr?.message || writeErr);
    }
  }

  const oneHour = 60 * 60 * 1000;
  if (now - entry.activatedAt > oneHour) return res.status(403).json({ error: 'Code expired' });

  // issue JWT for video access
  const token = jwt.sign({ videoId: id }, VIDEO_TOKEN_SECRET, { expiresIn: '1h' });

  const accessUrl = `/api/videos/stream/${id}?token=${token}`;
  res.json({ accessUrl, expiresIn: 3600 });
});

// GET /videos/stream/:id — validates token and redirects to Bunny or local video URL
router.get('/videos/stream/:id', (req, res) => {
  const { id } = req.params;
  const token = req.query.token;
  if (!token) return res.status(401).send('Missing token');

  try {
    const payload = jwt.verify(token, VIDEO_TOKEN_SECRET);
    if (payload.videoId !== id) return res.status(403).send('Token does not match video id');

    // determine target URL based on BUNNY or local
    if (BUNNY_LIBRARY_ID && BUNNY_API_KEY) {
      const bunnyUrl = `https://iframe.mediadelivery.net/embed/${id}`;
      return res.redirect(bunnyUrl);
    }

    // fallback to local videos.json
    try {
      const raw = fs.readFileSync(localVideosPath, 'utf-8');
      const videos = JSON.parse(raw);
      const video = videos.find((v) => v.id === id);
      if (!video) return res.status(404).send('Video not found');
      return res.redirect(video.fullUrl || video.previewUrl);
    } catch (e) {
      console.error('Failed to load local videos for stream redirect:', e?.message || e);
      return res.status(500).send('Failed to load video');
    }
  } catch (err) {
    console.warn('Invalid or expired token', err?.message || err);
    return res.status(401).send('Invalid or expired token');
  }
});

module.exports = router;