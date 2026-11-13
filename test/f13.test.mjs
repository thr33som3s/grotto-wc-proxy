import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";

process.env.STORE_URL = "https://store.test/exec"; process.env.STORE_SECRET = "s"; process.env.GOOGLE_API_KEY = "k";
const W = ethers.Wallet.createRandom(); const ADDR = W.address.toLowerCase();
const OTHER = "0x" + "1".repeat(40);
const BURN = "0x3d373231a0a60bb6203fd1a91e3f058100c2244d";
const sheets = {
  "snapshot-f13": [["collection","token_id","wallet","balance"], ["univ3rs3","93009",ADDR,"3"], ["gen2","1019",ADDR,"1"], ["univ3rs3","1010",ADDR,"1"], ["univ3rs3","34235",OTHER,"1"]],
  holdings: [["c","i","w","b"], ["univ3rs3","70069",ADDR,"5"], ["bulk","9",ADDR,"2"], ["univ3rs3","34235",ADDR,"1"]],
  transfers: [["chain","coll","x","id","from","to","amount","type","block","time","tx"]],
};
let stored = {}; let session = null;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://store.test")) {
    const b = JSON.parse(opts.body);
    if (b.action === "get_commitment") return resp({ commitment: stored[b.phase + b.wallet] || null });
    if (b.action === "get_profile") return resp({ profile: { username: "tester", wallet: b.wallet } });
    if (b.action === "put_commitment") { stored[b.phase + b.wallet] = { payload: b.payload, submitted_at: "2026-11-13T17:00:00Z" }; return resp({ ok: true, submitted_at: "2026-11-13T17:00:00Z" }); }
    if (b.action === "get_session") return resp({ session });
    return resp({});
  }
  const m = u.match(/values\/([^?]+)/);
  if (m) { const name = decodeURIComponent(m[1]).split("!")[0].replace(/'/g, "");
    if (sheets[name]) return resp({ values: sheets[name] });
    return resp({ values: [["token_id","card_name"]] }); }
  if (u.includes("fields=sheets.properties.title")) return resp({ sheets: [{ properties: { title: "t" } }] });
  throw new Error("unexpected fetch " + u);
};
const resp = (j) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) });

const lib = await import("../api/_lib/f13.js");
const sess = await import("../api/_lib/session.js");

test("snapshot holds only qualifying tokens for the wallet", () => {
  const rows = sheets["snapshot-f13"].slice(1).map(([c,i,w,b]) => ({ key: `${c}:${i}`, wallet: w, balance: +b }));
  assert.deepEqual(lib.snapshotHolds(rows, ADDR).sort(), ["gen2:1019","univ3rs3:93009"]);
});
test("check: holds must be at the snapshot; burns within live balance; at least one claim", () => {
  const snap = new Set(["univ3rs3:93009"]), live = new Map([["univ3rs3:70069", 5]]);
  assert.deepEqual(lib.checkF13({ holds: ["univ3rs3:93009"], burns: [{ key: "univ3rs3:70069", qty: 5 }] }, snap, live), []);
  assert.match(lib.checkF13({ holds: ["univ3rs3:34235"], burns: [] }, snap, live)[0], /snapshot/);
  assert.match(lib.checkF13({ holds: ["univ3rs3:1010"], burns: [] }, snap, live)[0], /doesn't qualify/);
  assert.match(lib.checkF13({ holds: [], burns: [{ key: "univ3rs3:70069", qty: 6 }] }, snap, live)[0], /hold only 5/);
  assert.match(lib.checkF13({ holds: [], burns: [{ key: "univ3rs3:93009", qty: 1 }] }, snap, live)[0], /isn't a burnable/);
  assert.match(lib.checkF13({ holds: [], burns: [] }, snap, live)[0], /cite a token/);
  assert.match(lib.checkF13({ holds: ["univ3rs3:93009","univ3rs3:93009"], burns: [] }, snap, live).join(" "), /twice/);
});
test("claims: one per hold regardless of editions, one per burned edition, capped at the commitment", () => {
  const p = { holds: ["univ3rs3:93009", "gen2:1019"], burns: [{ key: "univ3rs3:70069", qty: 3 }, { key: "bulk:9", qty: 2 }] };
  assert.equal(lib.f13Claims(p), 7);
  const c = lib.f13Confirmed(p, { "univ3rs3:70069>333burn": { sent: 5 }, "bulk:9>333burn": { sent: 1 } });
  assert.deepEqual(c, { holdClaims: 2, burnClaims: 4, burned: { "univ3rs3:70069": 3, "bulk:9": 1 }, claims: 6 });
});
test("window: open 11:00am EST Fri through 11:59:59pm PST", () => {
  assert.equal(lib.f13Window(Date.parse("2026-11-13T15:59:00Z")).open, false);
  assert.equal(lib.f13Window(Date.parse("2026-11-13T17:00:00Z")).open, true);
  assert.equal(lib.f13Window(Date.parse("2026-11-14T07:59:59Z")).open, true);
  assert.equal(lib.f13Window(Date.parse("2026-11-14T08:00:00Z")).open, false);
  assert.equal(lib.f13Window(Date.parse("2026-11-14T08:00:00Z")).closed, true);
});

// Handler end to end, with the clock inside the window.
const realNow = Date.now;   // handler tests run on the real clock (inside the window today); signing uses new Date()
const handler = (await import("../api/commit.js")).default;
const tok = sess.issueToken(ADDR);
function call(method, q, b, auth = true) {
  const req = { method, query: q || {}, body: b || {}, headers: auth ? { authorization: "Bearer " + tok } : {} };
  return new Promise((res) => { const r = { code: 0, h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json(j) { res({ code: this.code, j }); }, end() { res({ code: this.code }); } }; handler(req, r); });
}
test("handler: public GET lists the tokens, no personal data", async () => {
  const r = await call("GET", { phase: "f13" }, null, false);
  assert.equal(r.code, 200); assert.equal(r.j.hold.length, 13); assert.equal(r.j.burn.length, 9);
  assert.equal(r.j.snapshotHolds, undefined); assert.equal(r.j.window.open, true);
});
test("handler: signed-in GET shows snapshot holds and burnable balances", async () => {
  const r = await call("GET", { phase: "f13" });
  assert.deepEqual(r.j.snapshotHolds.sort(), ["gen2:1019", "univ3rs3:93009"]);
  assert.deepEqual(r.j.burnable, { "univ3rs3:70069": 5, "bulk:9": 2 });   // 34235 held now but not burnable
  assert.equal(r.j.entry, null);
});
test("handler: a hold bought after the snapshot is refused", async () => {
  const r = await call("POST", {}, { phase: "f13", holds: ["univ3rs3:34235"], burns: [] });
  assert.equal(r.code, 422); assert.match(r.j.error, /snapshot/);
});
test("handler: prepare, sign, store; second entry refused; burns confirm from the ledger", async () => {
  const entry = { phase: "f13", holds: ["univ3rs3:93009", "gen2:1019"], burns: [{ key: "univ3rs3:70069", qty: 3 }, { key: "bulk:9", qty: 2 }] };
  const prep = await call("POST", {}, entry);
  assert.equal(prep.code, 200); assert.equal(prep.j.claims, 7); assert.match(prep.j.message, /friday the 13th/);
  const signature = await W.signMessage(prep.j.message);
  const bad = await call("POST", {}, { ...entry, issuedAt: prep.j.issuedAt, signature: await ethers.Wallet.createRandom().signMessage(prep.j.message) });
  assert.equal(bad.code, 400);
  const ok = await call("POST", {}, { ...entry, issuedAt: prep.j.issuedAt, signature });
  assert.equal(ok.code, 201);
  const again = await call("POST", {}, entry);
  assert.equal(again.code, 409);
  // ledger: 5 of 70069 to 333burn in the window (only 3 count), 1 bulk:9 in the window, 1 bulk:9 before it opened
  sheets.transfers.push(["ethereum","univ3rs3","","70069",ADDR,BURN,"5","transfer","1","2026-11-13T17:30:00Z","0xa"]);
  sheets.transfers.push(["base","bulk","","9",ADDR,BURN,"1","transfer","1","2026-11-13T17:40:00Z","0xb"]);
  sheets.transfers.push(["base","bulk","","9",ADDR,BURN,"1","transfer","1","2026-11-13T15:00:00Z","0xc"]);
  (await import("../api/_lib/ledger.js")).resetLedgerMemo();
  const g = await call("GET", { phase: "f13" });
  assert.deepEqual(g.j.confirmed, { holdClaims: 2, burnClaims: 4, burned: { "univ3rs3:70069": 3, "bulk:9": 1 }, claims: 6 });
});
test("handler: closed after 11:59:59pm PST", async () => {
  Date.now = () => Date.parse("2026-11-14T08:00:01Z");
  const late = sess.issueToken(ADDR);
  const r = await new Promise((res) => handler({ method: "POST", query: {}, body: { phase: "f13", holds: ["univ3rs3:93009"], burns: [] }, headers: { authorization: "Bearer " + late } },
    { setHeader() {}, status(c) { this.c = c; return this; }, json(j) { res({ code: this.c, j }); } }));
  Date.now = realNow;
  assert.equal(r.code, 403);
});
