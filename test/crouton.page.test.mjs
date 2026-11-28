// Page test (jsdom): crouton's case on Black Friday - L3ftov3rs. He held 3 of the "Hundred" ORANGE insert #H1
// (univ3rs3 #317016, one claim per edition held, no cap) at the snapshot; the window must show them right away.
import { JSDOM } from "jsdom";
import fs from "fs";
import assert from "assert/strict";
const E = await import(new URL("../api/_lib/events.js", import.meta.url));
const html = fs.readFileSync(new URL("../site/conn3ct_header_v60.html", import.meta.url), "utf8");
const js = html.split("<script>")[1].split("</script>")[0];
const dom = new JSDOM(`<div class="c-view-bar"><button id="view-all"></button><button id="view-mine"></button></div><div id="wallet-pill"><span id="wallet-addr"></span></div><input id="search-input"><div id="c-grid"></div><div id="results-count"></div>`, { runScripts: "outside-only", url: "https://thr33som3s.com/conn3ct" });
const w = dom.window, d = w.document; w.HTMLElement.prototype.scrollIntoView = () => {};
w.ethers = { providers: {}, Contract: function () {} };
w.eval(js + `;window.__t = { openEvent, st: () => ({ evPlay }), set: (o) => { if ('walletAddr' in o) walletAddr = o.walletAddr; if ('session' in o) session = o.session; if ('api' in o) api = o.api; } };`);
const T = w.__t;
const cfg = E.cleanEvent(JSON.parse(fs.readFileSync(new URL("./fixtures_black_friday_l3ftov3rs.json", import.meta.url), "utf8")), 0).config;
const rules = Object.fromEntries(["hold", "burn", "vault", "cite"].map((r) => [r, E.ruleBuckets(cfg, r).map((b) => ({ scope: b.scope, keys: b.keys, label: b.label || null, n: b.n, m: b.m, unit: b.unit, maxIn: b.maxIn, maxOut: b.maxOut, text: E.ruleText(b) }))]));
const info = { id: cfg.id, name: cfg.name, intro: cfg.intro, roles: cfg.roles, rules, pay: { ...cfg.pay },
  window: { open: true, closed: false, closes: cfg.window.closes, snapshotAt: cfg.snapshot.at, holdCount: "snapshot", snapshotReady: true },
  tokens: Object.fromEntries(["hold", "burn", "vault", "cite"].map((r) => [r, E.roleKeys(cfg, r).map((k) => ({ key: k, name: k === "univ3rs3:317016" ? '1989 "Hundred" - ORANGE Insert #H1' : k }))])),
  held: ["univ3rs3:317016"], heldCounts: { "univ3rs3:317016": 3 }, balances: {}, entry: null };
T.set({ walletAddr: "0x973d285299e2ee2305f9898c9d0f2740f1d139a9", session: { wallet: "0x973d285299e2ee2305f9898c9d0f2740f1d139a9", profile: { username: "crouton" } }, api: async () => info });
await T.openEvent(cfg.id);
const mb = () => d.getElementById("c3-modal-body").innerHTML;
assert.match(mb(), /qualifying pieces you held at the snapshot: 1/);
assert.match(mb(), /1989 "Hundred" - ORANGE Insert #H1/); assert.match(mb(), /you held 3 at the snapshot/); assert.match(mb(), /1 → 1 claim(?! ·)/);
const plus = () => d.querySelector('[data-evstep="hold|univ3rs3:317016|1"]').onclick();
plus(); plus(); plus(); plus();
assert.equal(d.querySelector('[data-evqty="hold|univ3rs3:317016"]').value, "3", "all 3 held, no more");
assert.equal(d.getElementById("c3-evtotal").textContent, "claims: 3 · entries on the wheel: 0", "one claim per edition held, no cap");
console.log("client tests (crouton, v60): all passed");
process.exit(0);
