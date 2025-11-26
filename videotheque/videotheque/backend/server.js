const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = 3001;

// 🟢 IMPORT ROUTES
const validateCode = require('./routes/validateCode');
const chat = require('./routes/chat');
const videos = require('./routes/videos');

// 🟢 MIDDLEWARE
app.use(cors());
app.use(bodyParser.json());

// 🟢 USE ROUTES
app.use('/api', validateCode);
app.use('/api', chat);
app.use('/api', videos);

app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
  // Helpful runtime information to avoid confusion when there are multiple copies
  console.log(`Running from: ${__dirname}`);
  console.log(`BUNNY configured: ${!!process.env.BUNNY_API_KEY} ; OPENAI configured: ${!!process.env.OPENAI_API_KEY}`);
});