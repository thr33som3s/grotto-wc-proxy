// Page test (jsdom): pending mint on conn3ct v54.
import { JSDOM } from "jsdom";
import fs from "fs";
import assert from "assert/strict";
const html = fs.readFileSync("/home/claude/repo/site/conn3ct_header_v57.html", "utf8");
const js = html.split("<script>")[1].split("</script>")[0];
const dom = new JSDOM(`<div class="c-view-bar"><button id="view-all"></button><button id="view-mine"></button></div><div id="wallet-pill"><span id="wallet-addr"></span></div><button id="connect-btn"></button><div id="connect-hero"></div>
  <span id="stat-owned"></span><span id="stat-total"></span><span id="stat-collections"></span><input id="search-input"><div id="c-grid"></div><div id="results-count"></div><div id="c-lb"><img id="lb-img"><div id="lb-data"></div></div>`, { runScripts: "outside-only", url: "https://thr33som3s.com/conn3ct" });
const w = dom.window, d = w.document; w.HTMLElement.prototype.scrollIntoView = () => {};
w.ethers = { providers: {}, Contract: function () {} };
w.eval(js + `;window.__t = { renderCard, getFilteredTokens, setView, updateStats, openLightbox, loadHolders, onConnected, toToken, holdingsFor,
  st: () => ({ mine, minePending, mineTotals }), set: (o) => { if ('walletAddr' in o) walletAddr = o.walletAddr; if ('getJSON' in o) getJSON = o.getJSON; if ('catalog' in o) { catalog = o.catalog; byKey = new Map(catalog.map(t => [t.key, t])); catalogLoaded = true; } } };`);
const T = w.__t;
const A = "0x" + "a".repeat(40);
const raw = (key, name, editions) => ({ key, coll: "univ3rs3", id: key.split(":")[1], name, image: "https://x/" + key + ".png", traits: { card_type: "Base" }, editions });
T.set({ catalog: [
  T.toToken(raw("univ3rs3:14001", "Stan Thomas, Friday the 13th x3", { minted: 0, burned: 0, circulating: 0, holders: 0, pending: 71, pendingCollectors: 14 })),
  T.toToken(raw("univ3rs3:93009", "Stan Thomas, 1977 Monsters. Series 3 #009A", { minted: 40, burned: 0, circulating: 40, holders: 9 })),
  T.toToken(raw("univ3rs3:11011", "Pete Richert (not minted, nothing pending)", { minted: 0, burned: 0, circulating: 0, holders: 0 })),
] });
// everyone: the pending piece shows; an unminted piece with nothing pending stays hidden
assert.deepEqual(JSON.parse(JSON.stringify(T.getFilteredTokens().map(t => t.key))).sort(), ["univ3rs3:14001", "univ3rs3:93009"]);
const bk = (k) => T.getFilteredTokens().find(t => t.key === k);
let card = T.renderCard(bk("univ3rs3:14001"));
assert.match(card, /class="c3-pendmint">pending mint<\/span> 71 pending/);
assert.doesNotMatch(card, /c-owned-badge/);
// a recipient connects: holdings say 5 pending
T.set({ getJSON: async (u) => {
  if (u.startsWith('/holdings')) return { tokens: [{ key: "univ3rs3:93009", balance: 2 }, { key: "univ3rs3:14001", balance: 0, pending: 5 }], totals: { pieces: 2, editions: 7, pendingEditions: 5 } };
  if (u.startsWith('/holders')) return { holders: [], pending: [{ wallet: "0x" + "b".repeat(40), editions: 23 }, { wallet: A, editions: 5 }] };
  return {}; } });
T.set({ walletAddr: A });
await T.onConnected();
assert.equal(JSON.stringify(T.st().mine), '{"univ3rs3:93009":2}', 'pending never enters what can move');
assert.equal(JSON.stringify(T.st().minePending), '{"univ3rs3:14001":5}');
card = T.renderCard(bk("univ3rs3:14001"));
assert.match(card, /<div class="c-owned-badge">pending ×5<\/div>/); assert.match(card, /c-card owned/);
T.setView('mine');
assert.deepEqual(JSON.parse(JSON.stringify(T.getFilteredTokens().map(t => t.key))).sort(), ["univ3rs3:14001", "univ3rs3:93009"], 'my collection includes it');
T.updateStats();
assert.equal(d.getElementById('stat-owned').textContent, '2');
// details: pending lines and the pending recipients
const grid = d.getElementById('c-grid'); grid.innerHTML = T.renderCard(bk("univ3rs3:14001"));
T.openLightbox(grid.querySelector('[data-clickable]'));
const lb = d.getElementById('lb-data').innerHTML;
assert.match(lb, /5 editions pending mint to you/); assert.match(lb, /pending mint<\/div><div class="c-lb-row-val">71 to 14 collectors/);
await new Promise(r => setTimeout(r, 20));
const hold = d.getElementById('lb-holders').innerHTML;
assert.match(hold, /pending mint \(2\) · 28 editions/); assert.match(hold, /\(you\)/); assert.match(hold, /23 pending/);
console.log("client tests (v54 pending mint): all passed");
process.exit(0);
