const app = require('./app');
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
  // Helpful runtime information to avoid confusion when there are multiple copies
  console.log(`Running from: ${__dirname}`);
  console.log(`BUNNY configured: ${!!process.env.BUNNY_API_KEY} ; OPENAI configured: ${!!process.env.OPENAI_API_KEY}`);
});