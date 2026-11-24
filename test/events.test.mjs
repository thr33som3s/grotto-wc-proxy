import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";

process.env.STORE_URL = "https://store.test/exec"; process.env.STORE_SECRET = "s"; process.env.GOOGLE_API_KEY = "k";
const ARTIST = "0xfe917312344b4ed3283c5e142868cd3eaa782933";
const W = ethers.Wallet.createRandom(); const ADDR = W.address.toLowerCase();
const BURN = "0x3d373231a0a60bb6203fd1a91e3f058100c2244d", VAULT = "0xe5a97ce51460114e13b632df211896c663cbae76";
const sheets = {
  snapshots: [["tab","at","status","taken_at","rows"], ["snapshot-friday-13-x3","2026-11-13T16:30:22.000Z","pending","",""]],
  "snapshot-friday-13-x3": [["c","i","w","b"], ["univ3rs3","93009",ADDR,"3"], ["gen2","1019",ADDR,"1"], ["univ3rs3","1010",ADDR,"1"]],
  holdings: [["c","i","w","b"], ["univ3rs3","70069",ADDR,"5"], ["bulk","9",ADDR,"2"], ["univ3rs3","34235",ADDR,"1"]],
  transfers: [["chain","coll","x","id","from","to","amount","type","block","time","tx"]],
};
const ev = {}; const commits = {};
const resp = (j) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) });
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://store.test")) {
    const b = JSON.parse(opts.body);
    if (b.action === "put_event") { ev[b.id] = { id: b.id, status: b.status, config: b.config }; return resp({ ok: true, updated_at: "now" }); }
    if (b.action === "get_event") return resp({ event: ev[b.id] || null });
    if (b.action === "list_events") return resp({ events: Object.values(ev) });
    if (b.action === "get_commitment") return resp({ commitment: commits[b.phase + b.wallet] || null });
    if (b.action === "get_profile") return resp({ profile: { username: "tester" } });
    if (b.action === "put_commitment") { commits[b.phase + b.wallet] = { payload: b.payload, submitted_at: "2026-11-13T17:00:00Z" }; return resp({ ok: true, submitted_at: "2026-11-13T17:00:00Z" }); }
    return resp({});
  }
  const m = u.match(/values\/([^?]+)/);
  if (m) { const name = decodeURIComponent(m[1]).split("!")[0].replace(/'/g, ""); return resp({ values: sheets[name] || [["token_id","card_name"]] }); }
  if (u.includes("fields=sheets.properties.title")) return resp({ sheets: [{ properties: { title: "t" } }] });
  throw new Error("unexpected fetch " + u);
};
import { mock } from "node:test";
// The clock: build3r saves happen at 11:00am EST, an hour before the 3v3nt opens (noon); play happens at 1pm EST.
mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-13T16:00:00Z") });
const E = await import("../api/_lib/events.js");
const F = await import("../api/_lib/f13.js");
const sess = await import("../api/_lib/session.js");
const handler = (await import("../api/commit.js")).default;
const call = (method, q, b, wallet) => new Promise((res) => handler({ method, query: q || {}, body: b || {}, headers: wallet ? { authorization: "Bearer " + sess.issueToken(wallet) } : {} },
  { setHeader() {}, status(c) { this.c = c; return this; }, json(j) { res({ code: this.c, j }); }, end() { res({ code: this.c }); } }));

// Friday the 13th x3, as build3r would save it: the tokens added from the grid, each assigned a role.
const f13cfg = {
  id: "friday-13-x3", name: "Friday the 13th x3", intro: "para one\n\npara two", status: "published",
  window: { opens: "2026-11-13T17:00:00Z", closes: "2026-11-14T07:59:59Z" },
  snapshot: { tab: "anything-typed-is-ignored", at: "2026-11-13T16:30:22Z" },
  tokens: [...F.F13_HOLD.map((key) => ({ key, role: "hold" })), ...F.F13_BURN.map((key) => ({ key, role: "burn" })), { key: "univ3rs3:1010", role: null }],
  roles: { hold: { count: "snapshot", claims: 1 }, burn: { claims: 1 } },
};

test("clean: f13 rebuilt in build3r matches the hand-coded lists exactly", () => {
  const { config, problems } = E.cleanEvent(f13cfg);
  assert.deepEqual(problems, []);
  assert.deepEqual(E.roleKeys(config, "hold"), F.F13_HOLD);
  assert.deepEqual(E.roleKeys(config, "burn"), F.F13_BURN);
  assert.deepEqual(config.intro, ["para one", "para two"]);
  assert.deepEqual(config.snapshot, { tab: "snapshot-friday-13-x3", at: "2026-11-13T16:50:00.000Z" }, "always 10 minutes before opens; whatever was sent is ignored");
  assert.equal(config.tokens.find((t) => t.key === "univ3rs3:1010").role, null);   // added, unassigned
});
test("clean: publishing needs a name, times, a role, and a snapshot tab for snapshot holders", () => {
  const p = E.cleanEvent({ id: "x1", status: "published", tokens: [{ key: "univ3rs3:1", role: "hold" }] }).problems.join(" | ");
  assert.match(p, /name/); assert.match(p, /opens and closes/);
  assert.match(E.cleanEvent({ id: "Bad Id" }).problems[0], /id/);
  assert.deepEqual(E.cleanEvent({ id: "draft-ok" }).problems, []);   // drafts can be incomplete
});
test("clean: published at least 30 minutes before it opens", () => {
  const base = { ...f13cfg, status: "published" };
  assert.deepEqual(E.cleanEvent(base, Date.parse("2026-11-13T16:30:00Z")).problems, []);            // exactly 30 minutes: fine
  assert.match(E.cleanEvent(base, Date.parse("2026-11-13T16:30:01Z")).problems[0], /at least 30 minutes before it opens/);
  assert.deepEqual(E.cleanEvent({ ...base, status: "draft" }, Date.parse("2026-11-13T16:59:00Z")).problems, []);   // a draft can be saved any time
});
test("check: same answers as the f13 rules for holds and burns", () => {
  const { config } = E.cleanEvent(f13cfg);
  const held = new Set(["univ3rs3:93009"]), live = new Map([["univ3rs3:70069", 5]]);
  assert.deepEqual(E.checkEntry(config, E.cleanPayload({ hold: ["univ3rs3:93009"], burn: [{ key: "univ3rs3:70069", qty: 5 }] }), held, live), []);
  assert.match(E.checkEntry(config, E.cleanPayload({ hold: ["univ3rs3:34235"] }), held, live)[0], /snapshot/);
  assert.match(E.checkEntry(config, E.cleanPayload({ burn: [{ key: "univ3rs3:70069", qty: 6 }] }), held, live)[0], /hold only 5/);
  assert.match(E.checkEntry(config, E.cleanPayload({}), held, live)[0], /at least one/);
  const p = E.cleanPayload({ hold: ["univ3rs3:93009", "gen2:1019"], burn: [{ key: "univ3rs3:70069", qty: 3 }, { key: "bulk:9", qty: 2 }] });
  assert.equal(E.entryClaims(config, p), F.f13Claims({ holds: p.hold, burns: p.burn }));
});
test("cite: any card in the cite role, owned or not; vault and burn share a balance; caps", () => {
  const { config } = E.cleanEvent({ id: "trial-x", tokens: [{ key: "thr33zi3s:9", role: "cite" }, { key: "univ3rs3:70069", role: "vault" }, { key: "univ3rs3:70071", role: "burn" }],
    roles: { cite: { claims: 0, max: 1 }, vault: { claims: 2 } } });
  const live = new Map([["univ3rs3:70069", 2]]);
  assert.deepEqual(E.checkEntry(config, E.cleanPayload({ cite: ["thr33zi3s:9"] }), new Set(), live), []);   // not held: fine
  assert.match(E.checkEntry(config, E.cleanPayload({ cite: ["thr33zi3s:1"] }), new Set(), live)[0], /can't be cited/);
  assert.match(E.checkEntry(config, E.cleanPayload({ vault: [{ key: "univ3rs3:70069", qty: 3 }] }), new Set(), live)[0], /hold only 2/);
  const p = E.cleanPayload({ cite: ["thr33zi3s:9"], vault: [{ key: "univ3rs3:70069", qty: 2 }] });
  assert.equal(E.entryClaims(config, p), 4);
  const c = E.confirmedClaims(config, p, { "univ3rs3:70069>3vault": { sent: 1 } });
  assert.deepEqual(c, { arrived: { "univ3rs3:70069>3vault": 1 }, claims: 2, pending: 2 });
});

test("handler: only thr33s can save; drafts stay hidden; published shows up", async () => {
  assert.equal((await call("POST", {}, { phase: "build3r", config: f13cfg }, ADDR)).code, 403);
  assert.equal((await call("POST", {}, { phase: "build3r", config: { ...f13cfg, status: "draft" } }, ARTIST)).code, 200);
  assert.deepEqual((await call("GET", { phase: "events" }, null)).j.events, []);
  assert.equal((await call("GET", { phase: "event", id: "friday-13-x3" }, null)).code, 404);
  assert.equal((await call("GET", { phase: "events", all: "1" }, null, ARTIST)).j.events.length, 1);
  assert.equal((await call("POST", {}, { phase: "build3r", config: f13cfg }, ARTIST)).code, 200);
  const pub = (await call("GET", { phase: "events" }, null)).j.events;
  assert.equal(pub.length, 1); assert.equal(pub[0].name, "Friday the 13th x3"); assert.equal(pub[0].window.open, false, "published an hour ahead: listed, not open yet");
});
test("handler: publishing inside the 30-minute cutoff is refused", async () => {
  mock.timers.setTime(Date.parse("2026-11-13T16:45:00Z"));
  const r = await call("POST", {}, { phase: "build3r", config: { ...f13cfg, id: "late-one" } }, ARTIST);
  assert.equal(r.code, 422); assert.match(r.j.error, /30 minutes/);
  mock.timers.setTime(Date.parse("2026-11-13T18:00:00Z"));   // from here on: during the 3v3nt
});
test("handler: until the ledger job takes the snapshot, nobody claims by holding", async () => {
  const g = await call("GET", { phase: "event", id: "friday-13-x3" }, null, ADDR);
  assert.equal(g.j.window.snapshotReady, false); assert.deepEqual(g.j.held, []);
  const r = await call("POST", {}, { phase: "event", id: "friday-13-x3", hold: ["univ3rs3:93009"] }, ADDR);
  assert.equal(r.code, 409); assert.match(r.j.error, /snapshot hasn't been taken/);
  const art = await call("GET", { phase: "events", all: "1" }, null, ARTIST);
  assert.equal(art.j.events[0].snapshotStatus.status, "pending");
  sheets.snapshots[1][2] = "taken";
  (await import("../api/_lib/ledger.js")).resetLedgerMemo();
});
test("handler: the f13 game end to end through the generic runtime", async () => {
  const g = await call("GET", { phase: "event", id: "friday-13-x3" }, null, ADDR);
  assert.deepEqual(g.j.held.sort(), ["gen2:1019", "univ3rs3:93009"]);
  assert.deepEqual(g.j.balances, { "univ3rs3:70069": 5, "bulk:9": 2 });
  assert.equal(g.j.tokens.hold.length, 13); assert.equal(g.j.tokens.burn.length, 9);
  const entry = { phase: "event", id: "friday-13-x3", hold: ["univ3rs3:93009", "gen2:1019"], burn: [{ key: "univ3rs3:70069", qty: 3 }, { key: "bulk:9", qty: 2 }] };
  const prep = await call("POST", {}, entry, ADDR);
  assert.equal(prep.code, 200); assert.equal(prep.j.claims, 7); assert.match(prep.j.message, /Friday the 13th x3/);
  const ok = await call("POST", {}, { ...entry, issuedAt: prep.j.issuedAt, signature: await W.signMessage(prep.j.message) }, ADDR);
  assert.equal(ok.code, 201);
  assert.equal((await call("POST", {}, entry, ADDR)).code, 409);
  sheets.transfers.push(["ethereum","univ3rs3","","70069",ADDR,BURN,"5","transfer","1","2026-11-13T17:30:00Z","0xa"]);
  sheets.transfers.push(["base","bulk","","9",ADDR,BURN,"1","transfer","1","2026-11-13T17:40:00Z","0xb"]);
  (await import("../api/_lib/ledger.js")).resetLedgerMemo();
  const after = await call("GET", { phase: "event", id: "friday-13-x3" }, null, ADDR);
  assert.equal(after.j.confirmed.claims, 6); assert.equal(after.j.confirmed.pending, 1);
});
