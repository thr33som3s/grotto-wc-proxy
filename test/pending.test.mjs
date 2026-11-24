// Pending mints through the proxy: catalog, holdings (a wallet's own count) and holders.
import test from "node:test";
import assert from "node:assert/strict";
process.env.GOOGLE_API_KEY = "k";
const A = "0x" + "a".repeat(40), B = "0x" + "b".repeat(40);
const sheets = {
  holdings: [["c","i","w","b"], ["univ3rs3","93009",A,"2"]],
  supply: [["c","i","m","b","c","h"], ["univ3rs3","93009","9","0","9","3"]],
  state: [["chain","last_block","last_change_at","last_run_at"], ["ethereum","1","2026-11-14T00:00:00Z","2026-11-14T00:05:00Z"]],
  pending: [["collection","token_id","wallet","owed","minted","remaining","source","since"],
    ["univ3rs3","14001",A,"5","0","5","friday the 13th x3","2026-11-14T08:00:00Z"],
    ["univ3rs3","14001",B,"23","3","20","friday the 13th x3","2026-11-14T08:00:00Z"],
    ["univ3rs3","93009",B,"1","1","0","old","2026-11-01T00:00:00Z"]],
};
const resp = (j) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) });
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  const m = u.match(/values\/'?([^'!]+)'?!/);
  if (m && sheets[m[1]]) return resp({ values: sheets[m[1]] });
  if (u.includes("fields=sheets.properties.title")) return resp({ sheets: [{ properties: { title: "t" } }] });
  if (m) return resp({ values: m[1] === "t" ? [["token_id","card_name"], ["93009","Stan Thomas"], ["14001","new stan"]] : [] });
  throw new Error("unexpected " + u);
};
const run = (h, q) => new Promise((res) => h({ query: q, method: "GET", headers: {} }, { setHeader() {}, status(c) { this.c = c; return this; }, json(j) { res({ code: this.c, j }); } }));
test("holdings: a recipient's pending pieces count as theirs, separately marked", async () => {
  const r = await run((await import("../api/holdings.js")).default, { wallet: A });
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.tokens, [{ key: "univ3rs3:93009", coll: "univ3rs3", id: "93009", balance: 2 }, { key: "univ3rs3:14001", coll: "univ3rs3", id: "14001", balance: 0, pending: 5 }]);
  assert.equal(r.j.totals.pieces, 2); assert.equal(r.j.totals.editions, 7); assert.equal(r.j.totals.pendingEditions, 5);
  const rb = await run((await import("../api/holdings.js")).default, { wallet: B });
  assert.deepEqual(rb.j.tokens, [{ key: "univ3rs3:14001", coll: "univ3rs3", id: "14001", balance: 0, pending: 20 }], "a fully minted pending row is gone");
});
test("holders: pending recipients listed with what's still owed", async () => {
  const r = await run((await import("../api/holders.js")).default, { token: "univ3rs3:14001" });
  assert.deepEqual(r.j.holders, []);
  assert.deepEqual(r.j.pending, [{ wallet: B, editions: 20 }, { wallet: A, editions: 5 }]);
});
test("catalog: the piece carries pending editions and collectors", async () => {
  const r = await run((await import("../api/catalog.js")).default, {});
  const t = r.j.tokens.find((x) => x.key === "univ3rs3:14001");
  assert.ok(t, "listed from its metadata row");
  assert.deepEqual(t.editions, { minted: 0, burned: 0, circulating: 0, holders: 0, pending: 25, pendingCollectors: 2 });
  assert.equal(r.j.tokens.find((x) => x.key === "univ3rs3:93009").editions.pending, undefined);
});
