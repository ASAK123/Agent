const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('../config');

// How often the watchdog ticks. If a tick arrives much later than scheduled,
// the computer was asleep (timers don't run during sleep).
const TICK_MS = 15 * 1000;
const SLEEP_GAP_MS = 60 * 1000;
// How often to ask WhatsApp Web whether it's still connected once ready.
const STATE_CHECK_MS = 60 * 1000;
const STATE_CHECK_TIMEOUT_MS = 20 * 1000;
// Consecutive failed state checks before we reconnect.
const MAX_STATE_STRIKES = 2;
// Give up on a startup that never reaches "ready" (unless waiting for a QR scan).
const STARTUP_TIMEOUT_MS = 3 * 60 * 1000;
const DESTROY_TIMEOUT_MS = 20 * 1000;
const RESTART_DELAY_MS = 5 * 1000;
// If reconnecting keeps failing, exit and let the supervisor start a fresh
// process (see src/supervisor.js).
const MAX_FAILED_RESTARTS = 3;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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
// The underlying client is rebuilt automatically after sleep, disconnects, or
// a browser that stops responding, so the process can run unattended.
function createWhatsappClient(onMessage) {
  let client = null;
  let ready = false;
  let waitingForQr = false;
  let startedAt = 0;
  let restarting = false;
  let failedRestarts = 0;
  let stateStrikes = 0;
  let lastStateCheck = 0;
  let lastTick = Date.now();

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

  function build() {
    const c = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] },
    });
    client = c;
    ready = false;
    waitingForQr = false;
    stateStrikes = 0;
    startedAt = Date.now();

    // Ignore events from a client we've already replaced.
    const current = (fn) => (...args) => {
      if (c === client) return fn(...args);
    };

    c.on('qr', current((qr) => {
      waitingForQr = true;
      console.log('Scan this QR code with WhatsApp (Settings -> Linked Devices -> Link a device):');
      qrcode.generate(qr, { small: true });
    }));

    c.on('authenticated', current(() => {
      waitingForQr = false;
      startedAt = Date.now();
    }));

    c.on('ready', current(() => {
      ready = true;
      failedRestarts = 0;
      lastStateCheck = Date.now();
      console.log('WhatsApp client ready.');
    }));

    c.on('auth_failure', current((msg) => console.error('WhatsApp auth failure:', msg)));
    c.on('change_state', current((state) => console.log('WhatsApp state:', state)));
    c.on('disconnected', current((reason) => restart(`disconnected: ${reason}`)));

    c.on('message_create', current(async (msg) => {
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
    }));

    c.initialize().catch(current((err) => restart(`initialize failed: ${err.message}`)));
  }

  async function restart(reason) {
    if (restarting) return;
    restarting = true;
    console.warn(`[${new Date().toISOString()}] Reconnecting WhatsApp (${reason})...`);

    if (!ready) failedRestarts += 1;
    if (failedRestarts > MAX_FAILED_RESTARTS) {
      console.error('WhatsApp keeps failing to reconnect - exiting so the supervisor restarts the app.');
      process.exit(1);
    }

    const old = client;
    client = null;
    ready = false;
    try {
      await withTimeout(old.destroy(), DESTROY_TIMEOUT_MS, 'client.destroy()');
    } catch (err) {
      console.warn('Could not close the old WhatsApp browser cleanly:', err.message);
    }

    setTimeout(() => {
      restarting = false;
      build();
    }, RESTART_DELAY_MS);
  }

  async function checkState() {
    lastStateCheck = Date.now();
    let state;
    try {
      state = await withTimeout(client.getState(), STATE_CHECK_TIMEOUT_MS, 'getState()');
    } catch (err) {
      state = `error: ${err.message}`;
    }
    if (state === 'CONNECTED') {
      stateStrikes = 0;
      return;
    }
    stateStrikes += 1;
    console.warn(`WhatsApp health check failed (${stateStrikes}/${MAX_STATE_STRIKES}): ${state}`);
    if (stateStrikes >= MAX_STATE_STRIKES) restart(`unhealthy state: ${state}`);
  }

  setInterval(() => {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;

    if (restarting || !client) return;

    if (gap > TICK_MS + SLEEP_GAP_MS) {
      restart(`computer was asleep for ~${Math.round(gap / 60000)} min`);
      return;
    }
    if (ready && now - lastStateCheck >= STATE_CHECK_MS) {
      checkState();
      return;
    }
    if (!ready && !waitingForQr && now - startedAt > STARTUP_TIMEOUT_MS) {
      restart('startup took too long');
    }
  }, TICK_MS);

  build();
}

module.exports = { createWhatsappClient };
