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

  // Sending a reply in the self-chat triggers another message_create event for
  // that very reply. We can't dedupe by the sent message's id: that id is only
  // known AFTER `msg.reply()` resolves, but the event for it can fire before
  // that await completes, so an id-based check can miss it and loop forever.
  // Instead, remember the reply's text BEFORE sending it.
  const pendingReplyBodies = new Set();
  function rememberOwnReply(body) {
    pendingReplyBodies.add(body);
    setTimeout(() => pendingReplyBodies.delete(body), 30000); // safety net
  }

  client.on('qr', (qr) => {
    console.log('Scan this QR code with WhatsApp (Settings -> Linked Devices -> Link a device):');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => console.log('WhatsApp client ready.'));
  client.on('auth_failure', (msg) => console.error('WhatsApp auth failure:', msg));
  client.on('disconnected', (reason) => console.warn('WhatsApp disconnected:', reason));

  client.on('message_create', async (msg) => {
    console.log('EVENT FIRED:', { fromMe: msg.fromMe, from: msg.from, to: msg.to, body: msg.body });

    if (msg.fromMe && pendingReplyBodies.has(msg.body)) {
      pendingReplyBodies.delete(msg.body);
      return;
    }

    const handled = shouldHandle(msg);
    console.log('shouldHandle result:', handled);
    if (!handled) return;

    try {
      const reply = await onMessage(msg.body, msg.from);
      rememberOwnReply(reply);
      await msg.reply(reply);
    } catch (err) {
      console.error('Error handling WhatsApp message:', err);
      try {
        const fallback = 'Sorry, something went wrong handling that.';
        rememberOwnReply(fallback);
        await msg.reply(fallback);
      } catch (_) {
        // best effort
      }
    }
  });

  client.initialize();
  return client;
}

module.exports = { createWhatsappClient };