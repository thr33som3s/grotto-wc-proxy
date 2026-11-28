// Runs the private store script (store/private_store_main.gs + store/events_addition.gs) as Apps Script would.
import fs from "fs"; import vm from "vm"; import assert from "assert/strict";
function Sheet() { this.v = []; }
Sheet.prototype.appendRow = function (r) { this.v.push(r.map(String)); };
Sheet.prototype.setFrozenRows = function () {};
Sheet.prototype.getDataRange = function () { const v = this.v; return { getValues: () => v.map((r) => r.slice()) }; };
Sheet.prototype.getRange = function (a, c) { const self = this;
  if (typeof a === "string") return { setNumberFormat() { return this; } };
  return { setValues: (vals) => vals.forEach((row, i) => { self.v[a - 1 + i] = self.v[a - 1 + i] || []; row.forEach((x, j) => { self.v[a - 1 + i][c - 1 + j] = String(x); }); }) }; };
function Book() { this.s = {}; }
Book.prototype.getSheetByName = function (n) { return this.s[n] || null; };
Book.prototype.insertSheet = function (n) { return (this.s[n] = new Sheet()); };
Book.prototype.getName = function () { return "x"; };
const store = new Book(), ledger = new Book();
const ctx = { console, JSON, Date, String, Object, Array, Number, Math,
  SpreadsheetApp: { getActiveSpreadsheet: () => store, openById: () => ledger },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => "s" }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../store/private_store_main.gs", import.meta.url), "utf8") + "\n" + fs.readFileSync(new URL("../store/events_addition.gs", import.meta.url), "utf8"), ctx);
const post = (b) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ secret: "s", ...b }) } }).text);
const put = (wallet, pay, payCap) => post({ action: "put_commitment", phase: "event:p", wallet, payload: { pay }, ...(payCap !== undefined ? { payCap } : {}) });
assert.equal(put("0x1", 3, 5).ok, true);
assert.deepEqual(put("0x2", 3, 5), { ok: false, error: "pay sold out", left: 2 });
assert.equal(put("0x2", 2, 5).ok, true);
assert.deepEqual(put("0x3", 1, 5), { ok: false, error: "pay sold out", left: 0 });
assert.equal(put("0x3", 0, 5).ok, true, "an entry paying for nothing is never refused by the cap");
assert.equal(put("0x1", 1, 5).error, "already submitted", "still one entry per wallet");
assert.equal(post({ action: "put_commitment", phase: "event:other", wallet: "0x9", payload: { pay: 9 }, payCap: 9 }).ok, true, "each 3v3nt counts its own");
assert.equal(put("0x4", 7).ok, true, "no cap sent: no total limit");
assert.equal(post({ action: "list_events" }).ok, true, "events addition still dispatched");
console.log("private store script: all passed");
