const fs = require('fs');
const { google } = require('googleapis');
const config = require('../config');

let cachedClient = null;

function getAuthClient() {
  if (cachedClient) return cachedClient;

  if (!config.googleClientId || !config.googleClientSecret) {
    throw new Error(
      'Google Calendar is not configured: set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env'
    );
  }
  if (!fs.existsSync(config.googleTokenPath)) {
    throw new Error(
      'Google Calendar is not linked yet. Run `node src/tools/googleAuth.js` once to link it.'
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );
  const tokens = JSON.parse(fs.readFileSync(config.googleTokenPath, 'utf8'));
  oauth2Client.setCredentials(tokens);

  oauth2Client.on('tokens', (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    fs.writeFileSync(config.googleTokenPath, JSON.stringify(merged, null, 2));
  });

  cachedClient = oauth2Client;
  return cachedClient;
}

function getCalendar() {
  return google.calendar({ version: 'v3', auth: getAuthClient() });
}

function toEventTime(dateTime) {
  if (!dateTime) return undefined;
  // Date-only strings ("2026-08-20") become Google all-day events.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTime)) return { date: dateTime };
  return { dateTime, timeZone: config.timezone };
}

async function listEvents({ timeMin, timeMax, maxResults, query } = {}) {
  const calendar = getCalendar();
  const res = await calendar.events.list({
    calendarId: config.googleCalendarId,
    timeMin: timeMin || new Date().toISOString(),
    timeMax,
    maxResults: maxResults && maxResults > 0 ? maxResults : 20,
    singleEvents: true,
    orderBy: 'startTime',
    q: query,
  });
  return (res.data.items || []).map((e) => ({
    eventId: e.id,
    summary: e.summary,
    description: e.description,
    location: e.location,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
  }));
}

async function createEvent({ summary, start, end, description, location }) {
  const calendar = getCalendar();
  let endTime = end;
  if (!endTime && start && /^\d{4}-\d{2}-\d{2}T/.test(start)) {
    endTime = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
  }

  const res = await calendar.events.insert({
    calendarId: config.googleCalendarId,
    requestBody: {
      summary,
      description,
      location,
      start: toEventTime(start),
      end: toEventTime(endTime || start),
    },
  });

  const e = res.data;
  return {
    eventId: e.id,
    summary: e.summary,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
  };
}

async function updateEvent({ eventId, summary, start, end, description, location }) {
  const calendar = getCalendar();
  const requestBody = {};
  if (summary !== undefined) requestBody.summary = summary;
  if (description !== undefined) requestBody.description = description;
  if (location !== undefined) requestBody.location = location;
  if (start !== undefined) requestBody.start = toEventTime(start);
  if (end !== undefined) requestBody.end = toEventTime(end);

  const res = await calendar.events.patch({
    calendarId: config.googleCalendarId,
    eventId,
    requestBody,
  });

  const e = res.data;
  return {
    eventId: e.id,
    summary: e.summary,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
  };
}

async function deleteEvent({ eventId }) {
  const calendar = getCalendar();
  await calendar.events.delete({ calendarId: config.googleCalendarId, eventId });
  return { eventId, deleted: true };
}

module.exports = { listEvents, createEvent, updateEvent, deleteEvent };
