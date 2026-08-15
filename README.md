# WhatsApp AI Agent — Backend

Node.js + Express backend that connects WhatsApp (via `whatsapp-web.js`) to
the Claude API (tool use), letting you manage an Excel workbook and your
Google Calendar over chat.

```
WhatsApp message → Express server → Claude agent (tool use) → Excel / Calendar tools → reply
```

## 1. Install

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `ANTHROPIC_API_KEY` — from the Anthropic Console.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — create an OAuth2 **Desktop app**
  credential in Google Cloud Console with the Calendar API enabled.
- Leave `ALLOWED_SENDERS` empty to only respond to messages you send yourself
  in WhatsApp's "Message yourself" chat (safest default). Otherwise list full
  WhatsApp JIDs (e.g. `972501234567@c.us`) separated by commas.

## 2. Link Google Calendar (one-time)

```bash
node src/tools/googleAuth.js
```

Open the printed URL, approve access, and paste the code back into the
terminal. This saves a refresh token to `data/google-token.json` — keep it
private, it's already in `.gitignore`.

## 3. Run the server

```bash
npm start
```

On first run it prints a QR code — scan it from WhatsApp on your phone under
**Settings → Linked Devices → Link a device**. After that it stays linked.

The Excel workbook (`data/workbook.xlsx` by default) is created
automatically on first run with `Contacts`, `Inventory`, and `Orders` sheets.

## 4. Try it

Message yourself on WhatsApp:
- "What's John's phone number?"
- "Add 20 units of blue widgets to inventory"
- "Book a dentist appointment next Tuesday at 3pm"
- "What's on my calendar tomorrow?"

Or test without WhatsApp while developing:

```bash
curl -X POST localhost:3000/debug/message \
  -H 'Content-Type: application/json' \
  -d '{"text":"what is on my calendar this week?"}'
```

## Project layout

```
src/
  server.js              Express entry point, wires WhatsApp <-> agent
  config.js              Env var loading
  whatsapp/client.js      whatsapp-web.js wrapper (QR login, message filter)
  agent/claude.js         Claude tool-use loop, per-sender conversation memory
  agent/toolSchemas.js    Tool definitions passed to Claude
  tools/excelTools.js     Contacts / Inventory / Orders sheet read+write
  tools/calendarTools.js  Google Calendar list/create/update/delete
  tools/googleAuth.js     One-time OAuth2 setup script
  tools/index.js          Maps tool names -> handler functions
data/
  workbook.xlsx           Your Excel "database" (auto-created)
  google-token.json       OAuth refresh token (auto-created, keep private)
```

## Notes

- `whatsapp-web.js` is unofficial and best for personal, low-volume use.
  Twilio's WhatsApp API is the official managed alternative if that matters
  to you.
- Single-user, so Excel file locking isn't a concern — but back up
  `data/workbook.xlsx` periodically since it doubles as your database.
- Conversation memory is in-process and per WhatsApp sender; it resets on
  server restart. That's intentional for a lightweight personal assistant —
  swap in a persistent store if you need longer memory.
- To add a new capability, add a handler in `tools/`, register it in
  `tools/index.js`, and describe it in `agent/toolSchemas.js`. Keep the tool
  set small and specific — it's easier to expand than to debug a bloated one.
