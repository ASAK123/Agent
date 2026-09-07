const config = require('../config');

// Holds the whatsapp-web.js Client once it's created in server.js, so tools
// (which don't otherwise have a reference to it) can send proactive messages
// - e.g. event reminders - rather than only replying to incoming messages.
let clientRef = null;

function setClient(client) {
  clientRef = client;
}

// Turns a Contacts-sheet phone number (any local/international format) into
// the plain digit string whatsapp-web.js expects for lookups, defaulting a
// leading "0" (local format) to WHATSAPP_COUNTRY_CODE.
function normalizeDigits(phone) {
  let digits = String(phone || '').replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = config.whatsappCountryCode + digits.slice(1);
  return digits;
}

async function sendWhatsappMessage(phone, text) {
  if (!clientRef) throw new Error('WhatsApp client is not ready yet.');
  const digits = normalizeDigits(phone);
  if (!digits) throw new Error(`Invalid phone number: ${phone}`);

  const numberId = await clientRef.getNumberId(digits);
  if (!numberId) throw new Error(`${phone} is not registered on WhatsApp`);

  return clientRef.sendMessage(numberId._serialized, text);
}

module.exports = { setClient, sendWhatsappMessage };
