const excelTools = require('./excelTools');
const calendarTools = require('./calendarTools');

// Maps tool names (as declared in agent/toolSchemas.js) to handler functions.
module.exports = {
  lookup_contact: excelTools.lookupContact,
  upsert_contact: excelTools.upsertContact,
  lookup_inventory: excelTools.lookupInventory,
  update_inventory: excelTools.updateInventory,
  add_order: excelTools.addOrder,
  list_orders: excelTools.listOrders,

  list_calendar_events: calendarTools.listEvents,
  create_calendar_event: calendarTools.createEvent,
  update_calendar_event: calendarTools.updateEvent,
  delete_calendar_event: calendarTools.deleteEvent,
};
