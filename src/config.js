require('dotenv').config();

function parseList(raw) {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-5',

  allowedSenders: parseList(process.env.ALLOWED_SENDERS),
  selfChatId: process.env.WHATSAPP_SELF_CHAT_ID || '',

  excelFilePath: process.env.EXCEL_FILE_PATH || './data/workbook.xlsx',

  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback',
  googleTokenPath: process.env.GOOGLE_TOKEN_PATH || './data/google-token.json',
  googleCalendarId:
    process.env.GOOGLE_CALENDAR_ID ||
    '4d72237704a77a11e4de6e3bf3250ad4b10ad26f22f34e29d8c98c5f17e74f5a@group.calendar.google.com',

  timezone: process.env.TIMEZONE || 'UTC',

  // Used by suggest_meeting_times. Busy time is read from every calendar listed in
  // AVAILABILITY_CALENDAR_IDS (defaults to the managed calendar plus your primary one).
  availabilityCalendarIds: parseList(process.env.AVAILABILITY_CALENDAR_IDS),
  workdayStart: process.env.WORKDAY_START || '09:00',
  workdayEnd: process.env.WORKDAY_END || '18:00',
  // 0 = Sunday ... 6 = Saturday. Default is an Israeli work week (Sun-Thu).
  workDays: parseList(process.env.WORK_DAYS || '0,1,2,3,4').map(Number),

  port: parseInt(process.env.PORT, 10) || 3000,
};

if (!config.availabilityCalendarIds.length) {
  config.availabilityCalendarIds = [config.googleCalendarId, 'primary'];
}

module.exports = config;
