const config = require('../config');
const excelTools = require('./excelTools');
const calendarTools = require('./calendarTools');
const { sendWhatsappMessage } = require('../whatsapp/sender');

function formatEventTime(start) {
  if (!start) return '';
  const date = new Date(start);
  if (isNaN(date)) return start; // date-only or already-formatted string
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: config.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function defaultReminderText(event) {
  const lines = [`📅 תזכורת: *${event.summary}*`, `🕒 ${formatEventTime(event.start)}`];
  if (event.location) lines.push(`📍 ${event.location}`);
  if (event.description) lines.push(`_${event.description}_`);
  return lines.join('\n');
}

// Sends a WhatsApp reminder about a calendar event to a list of contacts
// (matched by name against the Contacts sheet, which is where their phone
// numbers come from - not from Google Calendar attendees).
async function sendEventReminders({ eventId, recipientNames, message }) {
  if (!Array.isArray(recipientNames) || recipientNames.length === 0) {
    throw new Error('recipientNames must be a non-empty array of contact names');
  }

  const event = await calendarTools.getEvent({ eventId });
  const text = message || defaultReminderText(event);

  const results = [];
  for (const name of recipientNames) {
    const matches = await excelTools.lookupContact({ name });
    const contact = matches.find((c) => c.phone) || matches[0];

    if (!contact) {
      results.push({ name, status: 'not_found' });
      continue;
    }
    if (!contact.phone) {
      results.push({ name: contact.name, status: 'no_phone' });
      continue;
    }
    try {
      await sendWhatsappMessage(contact.phone, text);
      results.push({ name: contact.name, phone: contact.phone, status: 'sent' });
    } catch (err) {
      results.push({ name: contact.name, phone: contact.phone, status: 'failed', error: err.message });
    }
  }

  return {
    event: { eventId: event.eventId, summary: event.summary, start: event.start },
    message: text,
    results,
  };
}

module.exports = { sendEventReminders };
