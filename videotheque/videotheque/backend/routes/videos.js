const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_LIBRARY_ID = process.env.BUNNY_LIBRARY_ID;

const localVideosPath = path.join(__dirname, '../data/videos.json');

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

module.exports = router;