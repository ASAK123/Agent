const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const config = require('../config');

const SHEETS = {
  CONTACTS: { name: 'Contacts', headers: ['Name', 'Phone', 'Email', 'Notes'] },
  INVENTORY: { name: 'Inventory', headers: ['Item', 'Quantity', 'Unit', 'Notes'] },
  ORDERS: {
    name: 'Orders',
    headers: ['OrderID', 'Date', 'Customer', 'Item', 'Quantity', 'Status', 'Notes'],
  },
};

// Serializes read-modify-write cycles so concurrent tool calls in the same
// process can't clobber each other's changes to the workbook file.
let lockChain = Promise.resolve();
function withLock(fn) {
  const run = lockChain.then(fn, fn);
  lockChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function ensureWorkbook() {
  const filePath = config.excelFilePath;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) return;

  const workbook = new ExcelJS.Workbook();
  for (const sheet of Object.values(SHEETS)) {
    const ws = workbook.addWorksheet(sheet.name);
    ws.addRow(sheet.headers);
    ws.getRow(1).font = { bold: true };
  }
  await workbook.xlsx.writeFile(filePath);
}

async function loadWorkbook() {
  await ensureWorkbook();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(config.excelFilePath);
  return workbook;
}

async function saveWorkbook(workbook) {
  await workbook.xlsx.writeFile(config.excelFilePath);
}

function getSheet(workbook, sheetDef) {
  const ws = workbook.getWorksheet(sheetDef.name);
  if (!ws) throw new Error(`Sheet "${sheetDef.name}" not found in workbook`);
  return ws;
}

function headerIndex(sheet, headers) {
  const headerRow = sheet.getRow(1).values; // 1-indexed, values[0] is undefined
  const index = {};
  for (const header of headers) {
    const col = headerRow.findIndex((v) => v === header);
    if (col === -1) throw new Error(`Column "${header}" not found in sheet "${sheet.name}"`);
    index[header] = col;
  }
  return index;
}

function rowsAsObjects(sheet, headers) {
  const idx = headerIndex(sheet, headers);
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values;
    if (values.every((v) => v === null || v === undefined)) return;
    const obj = { _rowNumber: rowNumber };
    for (const header of headers) obj[header] = values[idx[header]] ?? null;
    rows.push(obj);
  });
  return rows;
}

function normalize(str) {
  return String(str || '').trim().toLowerCase();
}

// ---- Contacts ----

async function lookupContact({ name }) {
  const workbook = await loadWorkbook();
  const sheet = getSheet(workbook, SHEETS.CONTACTS);
  const rows = rowsAsObjects(sheet, SHEETS.CONTACTS.headers);
  const needle = normalize(name);
  return rows
    .filter((r) => normalize(r.Name).includes(needle))
    .map((r) => ({ name: r.Name, phone: r.Phone, email: r.Email, notes: r.Notes }));
}

async function upsertContact({ name, phone, email, notes }) {
  return withLock(async () => {
    const workbook = await loadWorkbook();
    const sheet = getSheet(workbook, SHEETS.CONTACTS);
    const idx = headerIndex(sheet, SHEETS.CONTACTS.headers);
    const needle = normalize(name);

    let targetRow = null;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1 || targetRow) return;
      if (normalize(row.values[idx.Name]) === needle) targetRow = row;
    });

    if (!targetRow) {
      targetRow = sheet.addRow([]);
    }
    targetRow.getCell(idx.Name).value = name;
    if (phone !== undefined) targetRow.getCell(idx.Phone).value = phone;
    if (email !== undefined) targetRow.getCell(idx.Email).value = email;
    if (notes !== undefined) targetRow.getCell(idx.Notes).value = notes;
    targetRow.commit();

    await saveWorkbook(workbook);
    return {
      name: targetRow.getCell(idx.Name).value,
      phone: targetRow.getCell(idx.Phone).value,
      email: targetRow.getCell(idx.Email).value,
      notes: targetRow.getCell(idx.Notes).value,
    };
  });
}

// ---- Inventory ----

async function lookupInventory({ item }) {
  const workbook = await loadWorkbook();
  const sheet = getSheet(workbook, SHEETS.INVENTORY);
  const rows = rowsAsObjects(sheet, SHEETS.INVENTORY.headers);
  const needle = normalize(item);
  return rows
    .filter((r) => normalize(r.Item).includes(needle))
    .map((r) => ({ item: r.Item, quantity: r.Quantity, unit: r.Unit, notes: r.Notes }));
}

async function updateInventory({ item, quantityChange, setQuantity, unit, notes }) {
  return withLock(async () => {
    const workbook = await loadWorkbook();
    const sheet = getSheet(workbook, SHEETS.INVENTORY);
    const idx = headerIndex(sheet, SHEETS.INVENTORY.headers);
    const needle = normalize(item);

    let targetRow = null;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1 || targetRow) return;
      if (normalize(row.values[idx.Item]) === needle) targetRow = row;
    });

    if (!targetRow) {
      targetRow = sheet.addRow([]);
      targetRow.getCell(idx.Item).value = item;
      targetRow.getCell(idx.Quantity).value = 0;
    }

    const currentQuantity = Number(targetRow.getCell(idx.Quantity).value) || 0;
    if (setQuantity !== undefined && setQuantity !== null) {
      targetRow.getCell(idx.Quantity).value = Number(setQuantity);
    } else if (quantityChange) {
      targetRow.getCell(idx.Quantity).value = currentQuantity + Number(quantityChange);
    }
    if (unit !== undefined) targetRow.getCell(idx.Unit).value = unit;
    if (notes !== undefined) targetRow.getCell(idx.Notes).value = notes;
    targetRow.commit();

    await saveWorkbook(workbook);
    return {
      item: targetRow.getCell(idx.Item).value,
      quantity: targetRow.getCell(idx.Quantity).value,
      unit: targetRow.getCell(idx.Unit).value,
      notes: targetRow.getCell(idx.Notes).value,
    };
  });
}

// ---- Orders ----

async function addOrder({ customer, item, quantity, status, notes }) {
  return withLock(async () => {
    const workbook = await loadWorkbook();
    const sheet = getSheet(workbook, SHEETS.ORDERS);
    const idx = headerIndex(sheet, SHEETS.ORDERS.headers);

    let maxId = 0;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const id = Number(row.values[idx.OrderID]);
      if (Number.isFinite(id) && id > maxId) maxId = id;
    });

    const row = sheet.addRow([]);
    const orderId = maxId + 1;
    row.getCell(idx.OrderID).value = orderId;
    row.getCell(idx.Date).value = new Date().toISOString();
    row.getCell(idx.Customer).value = customer;
    row.getCell(idx.Item).value = item;
    row.getCell(idx.Quantity).value = quantity;
    row.getCell(idx.Status).value = status || 'pending';
    row.getCell(idx.Notes).value = notes || '';
    row.commit();

    await saveWorkbook(workbook);
    return {
      orderId,
      date: row.getCell(idx.Date).value,
      customer,
      item,
      quantity,
      status: row.getCell(idx.Status).value,
      notes: row.getCell(idx.Notes).value,
    };
  });
}

async function listOrders({ status, customer, limit }) {
  const workbook = await loadWorkbook();
  const sheet = getSheet(workbook, SHEETS.ORDERS);
  let rows = rowsAsObjects(sheet, SHEETS.ORDERS.headers);

  if (status) rows = rows.filter((r) => normalize(r.Status) === normalize(status));
  if (customer) rows = rows.filter((r) => normalize(r.Customer).includes(normalize(customer)));

  rows.sort((a, b) => new Date(b.Date) - new Date(a.Date));
  const capped = rows.slice(0, limit && limit > 0 ? limit : 20);

  return capped.map((r) => ({
    orderId: r.OrderID,
    date: r.Date,
    customer: r.Customer,
    item: r.Item,
    quantity: r.Quantity,
    status: r.Status,
    notes: r.Notes,
  }));
}

module.exports = {
  ensureWorkbook,
  lookupContact,
  upsertContact,
  lookupInventory,
  updateInventory,
  addOrder,
  listOrders,
};
