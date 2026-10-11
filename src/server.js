const express = require('express');
const config = require('./config');
const { createWhatsappClient } = require('./whatsapp/client');
const { handleMessage } = require('./agent/claude');
const excelTools = require('./tools/excelTools');

async function main() {
  if (!config.anthropicApiKey) {
    console.error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.');
    process.exit(78); // config error: tells the supervisor not to restart
  }

  await excelTools.ensureWorkbook();

  const app = express();
  app.use(express.json());

  // Lets you exercise the agent without WhatsApp while developing:
  //   curl -X POST localhost:3000/debug/message -H 'Content-Type: application/json' \
  //     -d '{"text":"what is on my calendar this week?"}'
  app.post('/debug/message', async (req, res) => {
    const { text, sender } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text (string) is required' });
    }
    try {
      const reply = await handleMessage(text, sender || 'debug');
      res.json({ reply });
    } catch (err) {
      console.error('Error in /debug/message:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(config.port, () => console.log(`Server listening on port ${config.port}`));

  createWhatsappClient((text, senderId) => handleMessage(text, senderId));
}

// Stray errors from the WhatsApp browser (common right after the computer wakes
// up) shouldn't take the whole agent down - the WhatsApp watchdog reconnects.
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
