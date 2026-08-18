require('dotenv').config();

function parseSenders(raw) {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-5',

  allowedSenders: parseSenders(process.env.ALLOWED_SENDERS),

  excelFilePath: process.env.EXCEL_FILE_PATH || './data/workbook.xlsx',

  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback',
  googleTokenPath: process.env.GOOGLE_TOKEN_PATH || './data/google-token.json',
  googleCalendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',

  timezone: process.env.TIMEZONE || 'UTC',

  port: parseInt(process.env.PORT, 10) || 3000,
};

module.exports = config;
