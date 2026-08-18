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

function systemPrompt() {
  const now = new Date();
  return [
    'You are a personal assistant reachable over WhatsApp. You can look up and update data in an ',
    'Excel workbook (Contacts, Inventory, Orders) and manage a Google Calendar, using the tools ',
    'available to you. Always use a tool for these actions rather than guessing or making up data.',
    '',
    `Current date/time: ${now.toISOString()} (timezone: ${config.timezone}). Resolve relative dates `,
    'like "tomorrow" or "next Tuesday" against this before calling calendar tools.',
    '',
    'Reply in short, plain, WhatsApp-appropriate language - no markdown headers or bullet-heavy ',
    'formatting. Confirm what you did or found. If a request is ambiguous (e.g. which contact, which ',
    'event), ask a brief clarifying question instead of guessing. Before deleting a calendar event, ',
    'confirm the details with the user first.',
    '',
    `Every calendar event belongs to one of these divisions: ${DIVISION_NAMES.join(', ')}. Always ask `,
    'which division an event belongs to if it is not stated, and pass it as the "division" field when ',
    'creating or updating events - this sets a distinct calendar color per division.',
  ].join('\n');
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
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const messages = turns.flat();
    const response = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 1024,
      system: systemPrompt(),
      tools: toolSchemas,
      messages,
    });

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
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
    turn.push({ role: 'user', content: toolResults });
  }

  while (turns.length > MAX_TURNS_PER_SENDER) turns.shift();

  return finalText || "Sorry, I couldn't finish that - could you rephrase or try again?";
}

module.exports = { handleMessage };
