const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('../config');

function shouldHandle(msg) {
  if (msg.isStatus) return false;
  if (typeof msg.body !== 'string' || !msg.body.trim()) return false;

  if (config.allowedSenders.length === 0) {
    // Safest default: only respond in the "Message yourself" chat, identified
    // by its msg.to value. Neither comparing from===to nor resolving the
    // chat/contact via the library works reliably here - WhatsApp's newer
    // @lid id scheme trips up both (see WHATSAPP_SELF_CHAT_ID in .env.example
    // for how to find this value for your own account).
    if (!config.selfChatId) {
      console.warn(
        'WHATSAPP_SELF_CHAT_ID is not set - ignoring all messages. See .env.example.'
      );
      return false;
    }
    return msg.fromMe && msg.to === config.selfChatId;
  }
  return !msg.fromMe && config.allowedSenders.includes(msg.from);
}

// Wires whatsapp-web.js to `onMessage(text, senderId) -> Promise<replyText>`.
function createWhatsappClient(onMessage) {
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
  });

  // Sending a reply in the self-chat triggers another message_create event;
  // track our own outgoing message IDs so we don't reply to ourselves forever.
  const sentByBot = new Set();

  client.on('qr', (qr) => {
    console.log('Scan this QR code with WhatsApp (Settings -> Linked Devices -> Link a device):');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => console.log('WhatsApp client ready.'));
  client.on('auth_failure', (msg) => console.error('WhatsApp auth failure:', msg));
  client.on('disconnected', (reason) => console.warn('WhatsApp disconnected:', reason));

  client.on('message_create', async (msg) => {
    console.log('EVENT FIRED:', { fromMe: msg.fromMe, from: msg.from, to: msg.to, body: msg.body });

    if (sentByBot.has(msg.id._serialized)) {
      sentByBot.delete(msg.id._serialized);
      return;
    }

    const handled = shouldHandle(msg);
    console.log('shouldHandle result:', handled);
    if (!handled) return;

    try {
      const reply = await onMessage(msg.body, msg.from);
      const sent = await msg.reply(reply);
      if (sent && sent.id && sent.id._serialized) {
        sentByBot.add(sent.id._serialized);
      }
    } catch (err) {
      console.error('Error handling WhatsApp message:', err);
      try {
        const sent = await msg.reply('Sorry, something went wrong handling that.');
        sentByBot.add(sent.id._serialized);
      } catch (_) {
        // best effort
      }
    }
  });

  client.initialize();
  return client;
}

module.exports = { createWhatsappClient };