// Vercel serverless entrypoint — wraps the existing Express app with serverless-http
try {
  const serverless = require('serverless-http');
  const app = require('../app');

  module.exports = serverless(app);
} catch (err) {
  // If serverless-http isn't installed yet, show a helpful error when Vercel attempts to import
  console.error('serverless wrapper init failed. Do you have serverless-http installed?', err);
  throw err;
}
