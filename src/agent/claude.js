const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');
const toolSchemas = require('./toolSchemas');
const toolHandlers = require('../tools');
const { DIVISION_NAMES } = require('./divisions');

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const MAX_TURNS_PER_SENDER = 8; // conversation turns kept in memory, oldest dropped first
const MAX_TOOL_ITERATIONS = 6; // guards against runaway tool-call loops

// senderId -> array of turns; each turn is an array of complete messages
// (user text, assistant tool_use, user tool_result, ..., final assistant text).
// Trimming always drops whole turns so a tool_use is never separated from its tool_result.
const conversations = new Map();

function getTurns(senderId) {
  if (!conversations.has(senderId)) conversations.set(senderId, []);
  return conversations.get(senderId);
}

// Static instructions only - never changes between calls, so it's kept as its
// own cacheable block. Anything that changes per-call (the current date/time)
// is appended as a separate, uncached block in systemBlocks() below: mixing it
// into this text would bust the cache on every single message.
const SYSTEM_PROMPT_STATIC = [
  'You are a personal assistant reachable over WhatsApp. You can look up and update data in an ',
  'Excel workbook (Contacts, Inventory, Orders) and manage a Google Calendar, using the tools ',
  'available to you. Always use a tool for these actions rather than guessing or making up data.',
  '',
  'Format replies using WhatsApp\'s formatting syntax (not standard markdown - # headers and ** ',
  'do NOT render):',
  '  - *text* for bold (single asterisks) - use for names, key values, and short section labels',
  '  - _text_ for italic - use for secondary details or notes',
  '  - Use "- " for bullet lists, one item per line',
  '  - Use blank lines to separate sections instead of headers',
  '  - Keep it scannable: short lines, no walls of text',
  '',
  'Examples:',
  '  Contact lookup -> "*John Smith*\\n📞 054-123-4567\\n_Marketing dept_"',
  '  Calendar list -> "*Tomorrow\'s schedule:*\\n- 10:00 Dentist\\n- 15:00 Team sync\\n- 18:30 Gym"',
  '  Inventory update -> "✅ Added *20 units* of blue widgets\\n_New total: 145_"',
  '',
  'Use a relevant emoji at the start of a line sparingly, only where it adds quick visual meaning ',
  '(✅ confirmations, 📅 calendar, 📞 contacts, 📦 inventory) - don\'t overuse them.',
  '',
  'When the user asks when they are free or wants to find time for a meeting, call ',
  'suggest_meeting_times and reply with a numbered list in the returned rank order (best first), ',
  'each with a short reason, e.g. "*1.* Tue 13/10 10:00-10:30 _(light day)_". Then offer to book ',
  'one - if they pick a number, create the event with that slot\'s exact start/end.',
  '',
  'Confirm what you did or found. If a request is ambiguous (e.g. which contact, which event), ask ',
  'a brief clarifying question instead of guessing. Before deleting a calendar event, confirm the ',
  'details with the user first.',
].join('\n');

function systemBlocks() {
  const now = new Date();
  return [
    { type: 'text', text: SYSTEM_PROMPT_STATIC, cache_control: { type: 'ephemeral' } },
    {
      type: 'text',
      text:
        `Current date/time: ${now.toISOString()} (timezone: ${config.timezone}). Resolve relative ` +
        'dates like "tomorrow" or "next Tuesday" against this before calling calendar tools.',
    },
  ];
}

// Tool definitions are static too - mark the last one as a cache breakpoint
// (covers the whole tools array, computed once since toolSchemas never changes).
const CACHED_TOOL_SCHEMAS = toolSchemas.map((tool, i) =>
  i === toolSchemas.length - 1 ? { ...tool, cache_control: { type: 'ephemeral' } } : tool
);

// Marks the last content block of a message as a cache breakpoint, so the
// growing conversation prefix can be reused both across tool-loop iterations
// within one message and across a sender's later messages. Returns a new
// message/content array - never mutates what's stored in `turns`.
function withCacheControl(message) {
  const cacheControl = { type: 'ephemeral' };
  if (typeof message.content === 'string') {
    return { role: message.role, content: [{ type: 'text', text: message.content, cache_control: cacheControl }] };
  }
  const content = message.content.slice();
  content[content.length - 1] = { ...content[content.length - 1], cache_control: cacheControl };
  return { role: message.role, content };
}

async function runTool(name, input) {
  const handler = toolHandlers[name];
  if (!handler) return { error: `Unknown tool: ${name}` };
  try {
    return await handler(input || {});
  } catch (err) {
    return { error: err.message };
  }
}

async function handleMessage(text, senderId) {
  const turns = getTurns(senderId);
  const turn = [{ role: 'user', content: text }];
  turns.push(turn);

  let finalText = '';
  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const rawMessages = turns.flat();
      const messages = rawMessages.length
        ? [...rawMessages.slice(0, -1), withCacheControl(rawMessages[rawMessages.length - 1])]
        : rawMessages;
      const response = await client.messages.create({
        model: config.claudeModel,
        max_tokens: 1024,
        system: systemBlocks(),
        tools: CACHED_TOOL_SCHEMAS,
        messages,
      });
      console.log(
        `[usage] input=${response.usage.input_tokens} output=${response.usage.output_tokens} ` +
          `cache_write=${response.usage.cache_creation_input_tokens || 0} cache_read=${response.usage.cache_read_input_tokens || 0}`
      );

      turn.push({ role: 'assistant', content: response.content });

      if (response.stop_reason !== 'tool_use') {
        finalText = response.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        break;
      }

      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      const toolResults = [];
      for (const block of toolUseBlocks) {
        const result = await runTool(block.name, block.input);
        console.log(`[tool ${i}] ${block.name}(${JSON.stringify(block.input)}) ->`, JSON.stringify(result).slice(0, 500));
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      turn.push({ role: 'user', content: toolResults });

      if (i === MAX_TOOL_ITERATIONS - 1) {
        console.warn(`Hit MAX_TOOL_ITERATIONS (${MAX_TOOL_ITERATIONS}) without a final answer for sender ${senderId}`);
      }
    }
  } catch (err) {
    // A failure partway through (API error, network blip, ...) can leave this
    // turn ending in an assistant tool_use with no matching tool_result yet.
    // Discard the whole turn rather than let that corrupt all future requests
    // for this sender - every later call would hit the same 400 forever.
    const idx = turns.indexOf(turn);
    if (idx !== -1) turns.splice(idx, 1);
    throw err;
  }

  while (turns.length > MAX_TURNS_PER_SENDER) turns.shift();

  return finalText || "Sorry, I couldn't finish that - could you rephrase or try again?";
}

module.exports = { handleMessage };
