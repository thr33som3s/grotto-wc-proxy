// Runs store/event_results.gs (as Apps Script would) against a made-up store, ledger and metadata, and checks the
// 3v3nt's tab against the server's own functions.
import fs from "fs"; import vm from "vm"; import assert from "assert/strict";
import * as E from "../api/_lib/events.js";
const A = "0x" + "a".repeat(40), B = "0x" + "b".repeat(40), C = "0x" + "c".repeat(40);
const BURN = "0x3d373231a0a60bb6203fd1a91e3f058100c2244d", VAULT = "0xe5a97ce51460114e13b632df211896c663cbae76";
const cfg = { id: "gourd-x", name: "Gourd Season x", status: "published", window: { opens: "2026-11-28T17:00:00.000Z", closes: "2026-11-29T04:59:00.000Z" },
  tokens: [{ key: "univ3rs3:317004", role: "burn" }, { key: "univ3rs3:317006", role: "burn" }, { key: "univ3rs3:70071", role: "burn" },
    { key: "gen2:1033", role: "vault" }, { key: "univ3rs3:93009", role: "hold" }, { key: "thr33zi3s:9", role: "cite" }],
  roles: { hold: { count: "snapshot", n: 1, m: 1, unit: "claims", maxIn: null, maxOut: 1 }, cite: { n: 1, m: 1, unit: "entries" } },
  rules: [{ role: "burn", scope: "group", keys: ["univ3rs3:317004", "univ3rs3:317006"], n: 3, m: 2, unit: "claims" },
    { role: "burn", scope: "token", keys: ["univ3rs3:70071"], n: 1, m: 5, unit: "entries" }] };
const draft = { ...cfg, id: "a-draft", name: "draft", status: "draft" };
const pay = { a: { hold: [{ key: "univ3rs3:93009", qty: 1 }], cite: ["thr33zi3s:9"], burn: [{ key: "univ3rs3:317004", qty: 2 }, { key: "univ3rs3:317006", qty: 1 }, { key: "univ3rs3:70071", qty: 2 }], vault: [{ key: "gen2:1033", qty: 1 }], heldCounts: { "univ3rs3:93009": 4 } },
  b: { hold: [], cite: [], burn: [{ key: "univ3rs3:317004", qty: 3 }], vault: [] } };
const T = (coll, id, from, to, amt, time, tx) => ["ethereum", coll, "x", id, from, to, String(amt), "transfer", "1", time, tx, "e"];
const books = {
  "10hplc8h_AOXz_w9VOxVc9Fg_Tp97Gqg-tNi-dpCzbaQ": {
    events: [["id", "status", "config"], ["gourd-x", "published", JSON.stringify(cfg)], ["a-draft", "draft", JSON.stringify(draft)]],
    profiles: [["wallet", "c", "u", "profile_json"], [A, "", "", JSON.stringify({ username: "crouton" })]],
    commitments: [["phase", "wallet", "submitted_at", "payload_json"], ["event:gourd-x", A, "2026-11-28T17:05:00.000Z", JSON.stringify(pay.a)],
      ["event:gourd-x", B, "2026-11-28T17:09:00.000Z", JSON.stringify(pay.b)], ["event:gourd-x-test", C, "2026-11-28T17:01:00.000Z", JSON.stringify(pay.b)]],
  },
  "1vDH6lXF_xegq8pWzGdDgHJPwnmpmoDXZoMaWj967UtM": {
    transfers: [["h"], T("univ3rs3", "317004", A, BURN, 2, "2026-11-28T17:10:00Z", "0xt1"), T("univ3rs3", "317006", A, BURN, 1, "2026-11-28T17:11:00Z", "0xt2"),
      T("univ3rs3", "70071", A, BURN, 1, "2026-11-28T17:12:00Z", "0xt3"), T("gen2", "1033", A, VAULT, 1, "2026-11-28T17:13:00Z", "0xt4"),
      T("univ3rs3", "317004", B, BURN, 3, "2026-11-28T16:00:00Z", "0xearly"), T("univ3rs3", "317004", B, A, 3, "2026-11-28T17:20:00Z", "0xnotburn")],
    state: [["chain", "b", "c", "last_run_at"], ["ethereum", "1", "", "2026-11-28T18:00:00.000Z"]],
    "snapshot-gourd-x": [["c", "i", "w", "b"], ["univ3rs3", "93009", A, "4"], ["univ3rs3", "93009", C, "1"], ["univ3rs3", "1010", C, "9"]],
  },
};
const meta = (rows) => [["token_id", "card_name"], ...rows];
for (const [id, rows] of Object.entries({ "1qnlN5EHwSn71bjMFKCu9y71DUdNnkvcVda6AA2HPi-s": [["317004", "Gourd DGSST1"], ["317006", "Gourd DGSST3"], ["70071", "MM006"], ["93009", "Stan #009A"]],
  "1fmYevh7PteIB8VD7u7MstffY8ZR6qK6BgKrgUEVVQRU": [["1033", "thr33zi3s #1033"]], "1aWO-XB7n409h2_9xoVq9f8q72kU3t7L2PsVYWPK8S9o": [["9", "thr33zi3s #0009"]] })) books[id] = { _first: meta(rows) };
const sheetOf = (v) => ({ getDataRange: () => ({ getDisplayValues: () => v.map((r) => r.map(String)) }) });
const written = {};
const results = { getSheetByName: (n) => written[n] ? written[n].sh : null, insertSheet: (n) => { written[n] = { sh: { clearContents() {}, setFrozenRows() {}, getRange: () => ({ setNumberFormat() { return this; }, setValues: (v) => { written[n].v = v; } }) } }; return written[n].sh; } };
const ctx = { console, JSON, Date, Math, Object, Array, String, Number, Set, Map, URL,
  SpreadsheetApp: { openById: (id) => ({ getSheets: () => [sheetOf(books[id]._first)], getSheetByName: (t) => books[id] && books[id][t] ? sheetOf(books[id][t]) : null }), getActiveSpreadsheet: () => results },
  Utilities: { formatDate: (d) => new Date(d).toISOString() }, ScriptApp: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../store/event_results.gs", import.meta.url), "utf8") + "\nrefreshResults();", ctx);
const tabs = Object.keys(written);
assert.deepEqual(tabs, ["Gourd Season x (gourd-x)"], "one tab per published 3v3nt; drafts skipped");
const v = JSON.parse(JSON.stringify(written[tabs[0]].v)).map((r) => r.map(String));
const row = (first) => v.find((r) => r[0] === first);
// by collector, against the server's own arithmetic
const sentA = { "univ3rs3:317004>333burn": { sent: 2 }, "univ3rs3:317006>333burn": { sent: 1 }, "univ3rs3:70071>333burn": { sent: 1 }, "gen2:1033>3vault": { sent: 1 } };
const cA = E.confirmedClaims(E.cleanEvent(cfg, 0).config, E.cleanPayload(pay.a), sentA);
assert.deepEqual(row("crouton").slice(3, 9), [cA.claims, cA.entries, cA.pending, cA.pendingEntries, 6, 5].map(String));
assert.deepEqual(row("crouton").slice(3, 7), ["4", "6", "0", "5"], "1 held + 2 (group A) + 1 (vault); 5 (1 of 2 MM006 in) + 1 cite; 5 more entries pending");
assert.deepEqual(row(B).slice(3, 9), ["0", "0", "2", "0", "3", "0"], "a burn before the window, and a transfer elsewhere, don't count");
const collectors = v.slice(v.findIndex((r) => r[0] === "by collector") + 2, v.findIndex((r) => r[0] === "TOTAL"));
assert.deepEqual(collectors.map((r) => r[1]), [A, B], "rehearsal entries (event:gourd-x-test) never appear");
assert.deepEqual(row("TOTAL").slice(1, 9), ["2 entries", "", "4", "6", "2", "5", "9", "5"]);
// detail
const det = v.filter((r) => r[0] === "crouton" && r[2]);
assert.ok(det.some((r) => r[2] === "burn" && r[3] === "group A: Gourd DGSST1 | Gourd DGSST3" && r[4] === "3" && r[5] === "3 → 2 claims" && r[6] === "2" && r[8] === "3" && r[9] === "0xt1 0xt2"));
assert.ok(det.some((r) => r[2] === "burn" && r[3] === "MM006" && r[4] === "2" && r[5] === "1 → 5 entries" && r[6] === "10" && r[8] === "1"));
assert.ok(det.some((r) => r[2] === "cite" && r[3] === "thr33zi3s #0009" && r[7] === "entries"));
assert.ok(det.some((r) => r[2] === "holder" && r[3] === "Stan #009A" && r[4] === "1"));
// snapshot
const snapRows = v.slice(v.findIndex((r) => /^snapshot: holder pieces held/.test(r[0])) + 2);
assert.deepEqual(snapRows.map((r) => r.slice(0, 6)), [[C, C, "Stan #009A", "1", "", "no"], ["crouton", A, "Stan #009A ×4", "4", "Stan #009A ×1", "yes"]]);
console.log("3v3nt results script: all passed");
