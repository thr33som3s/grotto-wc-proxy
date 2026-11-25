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
test("check: the default rules give the same answers as the f13 rules", () => {
  const { config } = E.cleanEvent(f13cfg);
  const held = new Set(["univ3rs3:93009"]), live = new Map([["univ3rs3:70069", 5]]);
  assert.deepEqual(E.checkEntry(config, E.cleanPayload({ hold: [{ key: "univ3rs3:93009", qty: 1 }], burn: [{ key: "univ3rs3:70069", qty: 5 }] }), held, live, new Map([["univ3rs3:93009", 3]])), []);
  assert.match(E.checkEntry(config, E.cleanPayload({ hold: [{ key: "univ3rs3:34235", qty: 1 }] }), held, live)[0], /snapshot/);
  assert.match(E.checkEntry(config, E.cleanPayload({ burn: [{ key: "univ3rs3:70069", qty: 6 }] }), held, live)[0], /hold only 5/);
  assert.match(E.checkEntry(config, E.cleanPayload({}), held, live)[0], /at least one/);
  const p = E.cleanPayload({ hold: [{ key: "univ3rs3:93009", qty: 1 }, { key: "gen2:1019", qty: 1 }], burn: [{ key: "univ3rs3:70069", qty: 3 }, { key: "bulk:9", qty: 2 }] });
  // one claim per unique token held, as on Friday the 13th: the default holder rule allows at most 1 per token
  assert.deepEqual(E.entryClaims(config, p), { claims: F.f13Claims({ holds: p.hold.map((x) => x.key), burns: p.burn }), entries: 0 });
  const six = E.cleanPayload({ hold: [{ key: "univ3rs3:93009", qty: 6 }] });
  assert.match(E.checkEntry(config, six, held, live, new Map([["univ3rs3:93009", 6]]))[0], /at most 1 claims/, "holding 6 still allows only 1 claim by default");
});

// thr33s's rules: N → M claims or entries, per token or as a group, caps on what goes in and what comes out.
const rulesCfg = (rules, roles = {}) => E.cleanEvent({ id: "rules-x", tokens: [
  { key: "univ3rs3:1", role: "burn" }, { key: "univ3rs3:2", role: "burn" }, { key: "univ3rs3:3", role: "burn" },
  { key: "univ3rs3:4", role: "vault" }, { key: "univ3rs3:5", role: "hold" }, { key: "univ3rs3:6", role: "hold" },
  { key: "thr33zi3s:7", role: "cite" }, { key: "thr33zi3s:8", role: "cite" }], rules, roles }).config;
const live = new Map([["univ3rs3:1", 20], ["univ3rs3:2", 20], ["univ3rs3:3", 20], ["univ3rs3:4", 20]]);
const chk = (cfg, pay, heldN = new Map()) => E.checkEntry(cfg, E.cleanPayload(pay), new Set(heldN.keys()), live, heldN);
const res = (cfg, pay, heldN = new Map()) => E.entryClaims(cfg, E.cleanPayload(pay), heldN);
test("rules: per token, burn only in multiples of N; 3 → 2 claims", () => {
  const cfg = rulesCfg([{ role: "burn", scope: "token", keys: ["univ3rs3:1"], n: 3, m: 2, unit: "claims" }]);
  assert.match(chk(cfg, { burn: [{ key: "univ3rs3:1", qty: 4 }] })[0], /univ3rs3:1: burn in multiples of 3/);
  assert.deepEqual(chk(cfg, { burn: [{ key: "univ3rs3:1", qty: 6 }] }), []);
  assert.deepEqual(res(cfg, { burn: [{ key: "univ3rs3:1", qty: 6 }, { key: "univ3rs3:2", qty: 1 }] }), { claims: 5, entries: 0 }, "6 at 3→2 = 4, plus 1 at the default 1→1");
});
test("rules: 1 → 5, and entries on the wheel counted apart from claims", () => {
  const cfg = rulesCfg([{ role: "burn", scope: "token", keys: ["univ3rs3:1"], n: 1, m: 5, unit: "claims" }, { role: "burn", scope: "token", keys: ["univ3rs3:2"], n: 1, m: 1, unit: "entries" }]);
  assert.deepEqual(res(cfg, { burn: [{ key: "univ3rs3:1", qty: 2 }, { key: "univ3rs3:2", qty: 5 }] }), { claims: 10, entries: 5 });
});
test("rules: a rule given to several tokens per token makes one rule each", () => {
  const cfg = rulesCfg([{ role: "burn", scope: "token", keys: ["univ3rs3:1", "univ3rs3:2"], n: 2, m: 1, unit: "claims", maxIn: 4 }]);
  assert.deepEqual(chk(cfg, { burn: [{ key: "univ3rs3:1", qty: 4 }, { key: "univ3rs3:2", qty: 4 }] }), [], "a cap of 4 each");
  assert.match(chk(cfg, { burn: [{ key: "univ3rs3:1", qty: 6 }] })[0], /at most 4/);
});
test("rules: as a group, burns add up across the group; multiples, caps in and out apply to the total", () => {
  const cfg = rulesCfg([{ role: "burn", scope: "group", keys: ["univ3rs3:1", "univ3rs3:2"], n: 3, m: 2, unit: "claims", maxIn: 6, maxOut: 4 }]);
  assert.equal(cfg.rules[0].label, "group A");
  assert.deepEqual(chk(cfg, { burn: [{ key: "univ3rs3:1", qty: 1 }, { key: "univ3rs3:2", qty: 2 }] }), [], "any mix totaling 3");
  assert.deepEqual(res(cfg, { burn: [{ key: "univ3rs3:1", qty: 1 }, { key: "univ3rs3:2", qty: 2 }] }), { claims: 2, entries: 0 });
  assert.match(chk(cfg, { burn: [{ key: "univ3rs3:1", qty: 1 }, { key: "univ3rs3:2", qty: 1 }] })[0], /group A: burn in multiples of 3/);
  assert.match(chk(cfg, { burn: [{ key: "univ3rs3:1", qty: 6 }, { key: "univ3rs3:2", qty: 3 }] }).join(" "), /group A: burn at most 6/);
  const capOut = rulesCfg([{ role: "burn", scope: "group", keys: ["univ3rs3:1", "univ3rs3:2"], n: 1, m: 2, unit: "entries", maxOut: 5 }]);
  assert.match(chk(capOut, { burn: [{ key: "univ3rs3:1", qty: 3 }] })[0], /at most 5 entries/);
  assert.deepEqual(chk(capOut, { burn: [{ key: "univ3rs3:1", qty: 2 }] }), []);
});
test("rules: a token is in one rule only; a one-token group is a token rule", () => {
  const cfg = rulesCfg([{ role: "burn", scope: "group", keys: ["univ3rs3:1", "univ3rs3:2"], n: 2, m: 1 }, { role: "burn", scope: "token", keys: ["univ3rs3:2", "univ3rs3:3"], n: 5, m: 1 },
    { role: "burn", scope: "group", keys: ["univ3rs3:4"], n: 2, m: 1 }, { role: "burn", scope: "group", keys: ["univ3rs3:3"], n: 3, m: 1 }]);
  assert.deepEqual(cfg.rules.map((r) => [r.scope, r.keys]), [["group", ["univ3rs3:1", "univ3rs3:2"]], ["token", ["univ3rs3:3"]]], "#2 already grouped; #4 is a vault token");
});
test("rules: vault works the same way, and shares the balance with burn", () => {
  const cfg = rulesCfg([{ role: "vault", scope: "token", keys: ["univ3rs3:4"], n: 2, m: 3, unit: "entries" }]);
  assert.deepEqual(res(cfg, { vault: [{ key: "univ3rs3:4", qty: 4 }] }), { claims: 0, entries: 6 });
  assert.match(chk(cfg, { vault: [{ key: "univ3rs3:4", qty: 3 }] })[0], /send to 3vault in multiples of 2/);
});
test("rules: holder claims are chosen, from 0 up to what was held, like burn and vault", () => {
  const cfg = rulesCfg([{ role: "hold", scope: "token", keys: ["univ3rs3:5"], n: 3, m: 2, unit: "claims", maxOut: null }]);
  const h7 = new Map([["univ3rs3:5", 7]]);
  assert.deepEqual(chk(cfg, { hold: [{ key: "univ3rs3:5", qty: 3 }] }, h7), [], "held 7, claims with 3");
  assert.deepEqual(res(cfg, { hold: [{ key: "univ3rs3:5", qty: 3 }] }), { claims: 2, entries: 0 });
  assert.deepEqual(res(cfg, { hold: [{ key: "univ3rs3:5", qty: 6 }] }), { claims: 4, entries: 0 });
  assert.match(chk(cfg, { hold: [{ key: "univ3rs3:5", qty: 4 }] }, h7)[0], /hold in multiples of 3/);
  assert.match(chk(cfg, { hold: [{ key: "univ3rs3:5", qty: 9 }] }, h7)[0], /held only 7 of univ3rs3:5/);
  assert.deepEqual(E.cleanPayload({ hold: [{ key: "univ3rs3:5", qty: 0 }] }).hold, [], "0 means not claimed");
  const capped = rulesCfg([{ role: "hold", scope: "token", keys: ["univ3rs3:5"], n: 1, m: 1, unit: "entries", maxIn: 5, maxOut: null }]);
  assert.match(chk(capped, { hold: [{ key: "univ3rs3:5", qty: 6 }] }, new Map([["univ3rs3:5", 9]]))[0], /hold at most 5/);
  const grp = rulesCfg([{ role: "hold", scope: "group", keys: ["univ3rs3:5", "univ3rs3:6"], n: 2, m: 1, unit: "claims", maxOut: 2 }]);
  const hg = new Map([["univ3rs3:5", 3], ["univ3rs3:6", 4]]);
  assert.deepEqual(chk(grp, { hold: [{ key: "univ3rs3:5", qty: 1 }, { key: "univ3rs3:6", qty: 3 }] }, hg), [], "1 + 3 = 4 together → 2");
  assert.deepEqual(res(grp, { hold: [{ key: "univ3rs3:5", qty: 1 }, { key: "univ3rs3:6", qty: 3 }] }), { claims: 2, entries: 0 });
  assert.match(chk(grp, { hold: [{ key: "univ3rs3:5", qty: 3 }, { key: "univ3rs3:6", qty: 3 }] }, hg)[0], /group A: hold at most 2 claims/);
});
test("rules: cite is one per card; a cite group can ask for N cards together", () => {
  const cfg = rulesCfg([{ role: "cite", scope: "token", keys: ["thr33zi3s:7"], n: 4, m: 3, unit: "entries" }]);
  assert.equal(cfg.rules[0].n, 1, "a card is cited once");
  assert.deepEqual(res(cfg, { cite: ["thr33zi3s:7"] }), { claims: 0, entries: 3 });
  const grp = rulesCfg([{ role: "cite", scope: "group", keys: ["thr33zi3s:7", "thr33zi3s:8"], n: 2, m: 1, unit: "claims" }]);
  assert.match(chk(grp, { cite: ["thr33zi3s:7"] })[0], /group A: cite in multiples of 2/);
  assert.deepEqual(res(grp, { cite: ["thr33zi3s:7", "thr33zi3s:8"] }), { claims: 1, entries: 0 });
});
test("rules: a role's default can be changed, and tokens without a rule follow it", () => {
  const cfg = rulesCfg([], { burn: { n: 2, m: 1, unit: "entries", maxIn: 4 } });
  assert.deepEqual(res(cfg, { burn: [{ key: "univ3rs3:3", qty: 4 }] }), { claims: 0, entries: 2 });
  assert.match(chk(cfg, { burn: [{ key: "univ3rs3:3", qty: 3 }] })[0], /multiples of 2/);
});
test("rules: arrivals pay only what has fully arrived", () => {
  const cfg = rulesCfg([{ role: "burn", scope: "group", keys: ["univ3rs3:1", "univ3rs3:2"], n: 3, m: 2, unit: "claims" }]);
  const p = E.cleanPayload({ burn: [{ key: "univ3rs3:1", qty: 3 }, { key: "univ3rs3:2", qty: 3 }] });
  assert.deepEqual(E.confirmedClaims(cfg, p, { "univ3rs3:1>333burn": { sent: 3 }, "univ3rs3:2>333burn": { sent: 1 } }),
    { arrived: { "univ3rs3:1>333burn": 3, "univ3rs3:2>333burn": 1 }, claims: 2, entries: 0, pending: 2, pendingEntries: 0 });
});
test("rules: the signed message spells out each rule and the totals", () => {
  const cfg = { ...rulesCfg([{ role: "burn", scope: "group", keys: ["univ3rs3:1", "univ3rs3:2"], n: 3, m: 2, unit: "claims" }]), name: "x" };
  const msg = E.entryMessage(cfg, "0xabc", E.cleanPayload({ burn: [{ key: "univ3rs3:1", qty: 1 }, { key: "univ3rs3:2", qty: 2 }] }), { "univ3rs3:1": "One", "univ3rs3:2": "Two" }, "t");
  assert.match(msg, /to burn at 333burn: group A \(One, Two\) x3 \[3 → 2 claims\] → 2 claims/);
  assert.match(msg, /2 claims, 0 entries on the wheel/);
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
  const r = await call("POST", {}, { phase: "event", id: "friday-13-x3", hold: [{ key: "univ3rs3:93009", qty: 1 }] }, ADDR);
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
  const entry = { phase: "event", id: "friday-13-x3", hold: [{ key: "univ3rs3:93009", qty: 1 }, { key: "gen2:1019", qty: 1 }], burn: [{ key: "univ3rs3:70069", qty: 3 }, { key: "bulk:9", qty: 2 }] };
  const prep = await call("POST", {}, entry, ADDR);
  assert.equal(prep.code, 200); assert.equal(prep.j.claims, 7); assert.equal(prep.j.entries, 0); assert.match(prep.j.message, /Friday the 13th x3/);
  const ok = await call("POST", {}, { ...entry, issuedAt: prep.j.issuedAt, signature: await W.signMessage(prep.j.message) }, ADDR);
  assert.equal(ok.code, 201);
  assert.equal((await call("POST", {}, entry, ADDR)).code, 409);
  sheets.transfers.push(["ethereum","univ3rs3","","70069",ADDR,BURN,"5","transfer","1","2026-11-13T17:30:00Z","0xa"]);
  sheets.transfers.push(["base","bulk","","9",ADDR,BURN,"1","transfer","1","2026-11-13T17:40:00Z","0xb"]);
  (await import("../api/_lib/ledger.js")).resetLedgerMemo();
  const after = await call("GET", { phase: "event", id: "friday-13-x3" }, null, ADDR);
  assert.equal(after.j.confirmed.claims, 6); assert.equal(after.j.confirmed.pending, 1); assert.equal(after.j.confirmed.entries, 0);
});
