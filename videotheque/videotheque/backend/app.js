const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();

// IMPORT ROUTES
const validateCode = require('./routes/validateCode');
const chat = require('./routes/chat');
const videos = require('./routes/videos');

// MIDDLEWARE
app.use(cors());
app.use(bodyParser.json());

// ROUTES
app.use('/api', validateCode);
app.use('/api', chat);
app.use('/api', videos);

module.exports = app;
