// Tool definitions passed to Claude. Keep this list small and specific -
// it's easier to add a new tool later than to debug an overly broad one.

const { DIVISION_NAMES } = require('./divisions');

module.exports = [
  {
    name: 'lookup_contact',
    description:
      'Search the Contacts sheet by (partial, case-insensitive) name and return matches with phone/email/notes.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full or partial contact name to search for' },
      },
      required: ['name'],
    },
  },
  {
    name: 'upsert_contact',
    description:
      'Create a new contact or update an existing one (matched by exact name). Only provided fields are changed.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Contact name (used to find an existing contact)' },
        phone: { type: 'string' },
        email: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'lookup_inventory',
    description:
      'Search the Inventory sheet by (partial, case-insensitive) item name and return matches with quantity/unit/notes.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Full or partial item name to search for' },
      },
      required: ['item'],
    },
  },
  {
    name: 'update_inventory',
    description:
      'Adjust or set the quantity of an inventory item (matched by exact item name). Creates the item if it does not exist. ' +
      'Use quantityChange for a relative adjustment (e.g. +20 or -5), or setQuantity to set an absolute value.',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Exact item name' },
        quantityChange: {
          type: 'number',
          description: 'Amount to add to (or, if negative, subtract from) the current quantity',
        },
        setQuantity: {
          type: 'number',
          description: 'Absolute quantity to set, overriding quantityChange if both are given',
        },
        unit: { type: 'string', description: 'Unit of measure, e.g. "units", "kg"' },
        notes: { type: 'string' },
      },
      required: ['item'],
    },
  },
  {
    name: 'add_order',
    description: 'Add a new row to the Orders sheet. OrderID and Date are assigned automatically.',
    input_schema: {
      type: 'object',
      properties: {
        customer: { type: 'string' },
        item: { type: 'string' },
        quantity: { type: 'number' },
        status: {
          type: 'string',
          description: 'Order status, e.g. "pending", "shipped", "delivered". Defaults to "pending".',
        },
        notes: { type: 'string' },
      },
      required: ['customer', 'item', 'quantity'],
    },
  },
  {
    name: 'list_orders',
    description: 'List orders from the Orders sheet, optionally filtered by status and/or customer.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        customer: { type: 'string' },
        limit: { type: 'number', description: 'Max rows to return, default 20' },
      },
    },
  },
  {
    name: 'list_calendar_events',
    description:
      'List events on the Google Calendar within a time range. Omit timeMin/timeMax to default to upcoming events from now.',
    input_schema: {
      type: 'object',
      properties: {
        timeMin: { type: 'string', description: 'ISO 8601 datetime, inclusive lower bound' },
        timeMax: { type: 'string', description: 'ISO 8601 datetime, exclusive upper bound' },
        maxResults: { type: 'number', description: 'Max events to return, default 20' },
        query: { type: 'string', description: 'Free-text search over event fields' },
      },
    },
  },
  {
    name: 'create_calendar_event',
    description:
      'Create a new event on the Google Calendar. Resolve relative dates/times (e.g. "next Tuesday at 3pm") to absolute ISO 8601 datetimes yourself before calling this.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Event title' },
        start: {
          type: 'string',
          description: 'ISO 8601 datetime (e.g. 2026-08-25T15:00:00) or date-only (YYYY-MM-DD) for an all-day event',
        },
        end: {
          type: 'string',
          description: 'ISO 8601 datetime or date-only string. Defaults to one hour after start if omitted.',
        },
        description: { type: 'string' },
        location: { type: 'string' },
        division: {
          type: 'string',
          enum: DIVISION_NAMES,
          description:
            'Which division this event belongs to (Hebrew name). Sets a distinct calendar color per division. ' +
            'Defaults to "צוות" (team-wide) if omitted.',
        },
      },
      required: ['summary', 'start'],
    },
  },
  {
    name: 'update_calendar_event',
    description:
      'Update fields of an existing calendar event. Look up the eventId first with list_calendar_events. Only provided fields are changed.',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string' },
        summary: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601 datetime or date-only string' },
        end: { type: 'string', description: 'ISO 8601 datetime or date-only string' },
        description: { type: 'string' },
        location: { type: 'string' },
        division: {
          type: 'string',
          enum: DIVISION_NAMES,
          description:
            'Which division this event belongs to (Hebrew name). Sets a distinct calendar color per division.',
        },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'delete_calendar_event',
    description:
      'Delete a calendar event. Look up the eventId first with list_calendar_events, and confirm with the user before deleting.',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'suggest_meeting_times',
    description:
      'Find free time slots for a meeting of a given length and return them ranked best-first. ' +
      'Checks busy time across the user\'s calendars and only suggests slots within working hours. ' +
      'Ranking prefers sooner days, lighter days, slots with a buffer around other meetings, and avoids lunch. ' +
      'Use this whenever the user asks when they are free/available or to find a time for something.',
    input_schema: {
      type: 'object',
      properties: {
        durationMinutes: { type: 'number', description: 'Meeting length in minutes, e.g. 30' },
        timeMin: {
          type: 'string',
          description: 'ISO 8601 datetime to start searching from. Defaults to now.',
        },
        timeMax: {
          type: 'string',
          description:
            'ISO 8601 datetime to stop searching at. Defaults to 7 days after timeMin. ' +
            'Narrow timeMin/timeMax when the user names a specific day or range (e.g. "tomorrow", "next week").',
        },
        preferredTimeOfDay: {
          type: 'string',
          enum: ['morning', 'afternoon', 'evening'],
          description: 'Boost slots in this part of the day, if the user expressed a preference',
        },
        workdayStart: {
          type: 'string',
          description: 'Override start of working hours, "HH:MM" local time (default from config, 09:00)',
        },
        workdayEnd: {
          type: 'string',
          description: 'Override end of working hours, "HH:MM" local time (default from config, 18:00)',
        },
        maxSuggestions: { type: 'number', description: 'How many slots to return, default 5' },
      },
      required: ['durationMinutes'],
    },
  },
];
