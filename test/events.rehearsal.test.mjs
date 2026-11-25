// The build3r runtime on a preview (rehearsal mode), where nothing has been snapshotted yet.
import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
process.env.STORE_URL = "https://store.test/exec"; process.env.STORE_SECRET = "s"; process.env.GOOGLE_API_KEY = "k";
process.env.COMMIT_TEST_MODE = "1";
const ARTIST = "0xfe917312344b4ed3283c5e142868cd3eaa782933";
const W = ethers.Wallet.createRandom(); const ADDR = W.address.toLowerCase();
const sheets = {   // no "snapshots" tab and no snapshot tab: the ledger job has never taken one
  holdings: [["c","i","w","b"], ["univ3rs3","34224",ADDR,"1"], ["bulk","11",ADDR,"3"]],
  transfers: [["chain","coll","x","id","from","to","amount","type","block","time","tx"]],
};
const ev = {};
const resp = (j, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => j, text: async () => JSON.stringify(j) });
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("https://store.test")) {
    const b = JSON.parse(opts.body);
    if (b.action === "put_event") { ev[b.id] = { id: b.id, status: b.status, config: b.config }; return resp({ ok: true }); }
    if (b.action === "get_event") return resp({ event: ev[b.id] || null });
    if (b.action === "list_events") return resp({ events: Object.values(ev) });
    if (b.action === "get_commitment") return resp({ commitment: null });
    if (b.action === "get_profile") return resp({ profile: { username: "tester" } });
    return resp({});
  }
  const m = u.match(/values\/([^?]+)/);
  if (m) { const name = decodeURIComponent(m[1]).split("!")[0].replace(/'/g, "");
    if (sheets[name]) return resp({ values: sheets[name] });
    if (name.startsWith("snapshot")) return resp({ error: { message: `Unable to parse range: ${name}` } }, false);   // like Google, for a missing tab
    return resp({ values: [["token_id","card_name"]] }); }
  if (u.includes("fields=sheets.properties.title")) return resp({ sheets: [{ properties: { title: "t" } }] });
  throw new Error("unexpected fetch " + u);
};
const sess = await import("../api/_lib/session.js");
const handler = (await import("../api/commit.js")).default;
const call = (method, q, b, wallet) => new Promise((res) => handler({ method, query: q || {}, body: b || {}, headers: wallet ? { authorization: "Bearer " + sess.issueToken(wallet) } : {} },
  { setHeader() {}, status(c) { this.c = c; return this; }, json(j) { res({ code: this.c, j }); }, end() { res({ code: this.c }); } }));
const cfg = { id: "black-friday-test1", name: "black friday test1", status: "published",
  window: { opens: new Date(Date.now() + 3600e3).toISOString(), closes: new Date(Date.now() + 7200e3).toISOString() },
  tokens: [{ key: "univ3rs3:34224", role: "hold" }, { key: "bulk:11", role: "burn" }, { key: "gen2:1033", role: "vault" }], roles: { hold: { count: "snapshot" } } };
test("rehearsal: a published 3v3nt with a holder role loads before any snapshot exists", async () => {
  assert.equal((await call("POST", {}, { phase: "build3r", config: cfg }, ARTIST)).code, 200);
  const g = await call("GET", { phase: "event", id: "black-friday-test1" }, null, ADDR);
  assert.equal(g.code, 200, JSON.stringify(g.j));
  assert.equal(g.j.window.open, true); assert.equal(g.j.window.snapshotReady, true);
  assert.deepEqual(g.j.held, ["univ3rs3:34224"], "rehearsal: holder pieces come from current holdings");
  assert.deepEqual(g.j.balances, { "bulk:11": 3 });
});
