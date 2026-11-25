// Page test (jsdom). Run from a folder with jsdom installed: npm i jsdom@24, then node <this file>.
import { JSDOM } from "jsdom";
import fs from "fs";
import assert from "assert/strict";
const html = fs.readFileSync("/home/claude/repo/site/conn3ct_header_v58.html", "utf8");
const js = html.split("<script>")[1].split("</script>")[0];
const dom = new JSDOM(`<div class="c-view-bar"><button id="view-all"></button><button id="view-mine"></button></div><div id="wallet-pill"><span id="wallet-addr"></span><button id="disconnect-btn"></button></div><div id="c-grid"></div><div id="results-count"></div>`, { runScripts: "outside-only", url: "https://thr33som3s.com/conn3ct" });
const w = dom.window; w.HTMLElement.prototype.scrollIntoView = () => {};
w.ethers = { providers: {}, Contract: function () {} };
w.eval(js + `;window.__t = { openF13, addPlayerUi, renderCard, getFilteredTokens, openPicker, st: () => ({ pickMode, f13 }), bk: (k) => byKey.get(k), resetF13: () => { f13 = null; }, set: (o) => { if ('walletAddr' in o) walletAddr = o.walletAddr; if ('session' in o) session = o.session; if ('api' in o) api = o.api; if ('provider' in o) provider = o.provider; if ('catalog' in o) { catalog = o.catalog; byKey = new Map(catalog.map(t => [t.key, t])); catalogLoaded = true; } } };`);
const T = w.__t, d = w.document;
T.addPlayerUi();
const tok = (key, name) => ({ key, coll: key.split(':')[0], tokenId: key.split(':')[1], name, img: 'https://x/' + key + '.png', traits: {}, editions: { minted: 5, burned: 0, circulating: 5, holders: 2 }, collection: key.split(':')[0], _words: name.toLowerCase() });
T.set({ catalog: [tok('univ3rs3:93009', 'Hold A'), tok('gen2:1019', 'thr33zi3s #1019'), tok('univ3rs3:70069', 'Burn A'), tok('bulk:9', 'Shayna'), tok('univ3rs3:1010', 'Other')] });
const calls = [];
const info = {
  window: { open: true, closed: false, closes: "2026-11-14T07:59:59Z", snapshotAt: "2026-11-13T16:30:22Z", testMode: false },
  hold: [{ key: "univ3rs3:93009", name: "Hold A", image: "" }, { key: "gen2:1019", name: "thr33zi3s #1019", image: "" }],
  burn: [{ key: "univ3rs3:70069", name: "Burn A", image: "" }, { key: "bulk:9", name: "Shayna", image: "" }, { key: "bulk:319027", name: "Burn C", image: "" }],
  snapshotHolds: ["univ3rs3:93009", "gen2:1019"], burnable: { "univ3rs3:70069": 5, "bulk:9": 2 }, entry: null,
};
T.set({ walletAddr: "0xabc", session: { profile: { username: "t" } }, api: async (path, o) => { calls.push([path, o]); if (path.startsWith('/commit?')) return info; return { issuedAt: "x", message: "m", claims: 6 }; }, provider: { getSigner: () => ({ signMessage: async () => "0xsig" }) } });
await T.openF13();
let h = d.getElementById('c3-modal-body').innerHTML;
assert.match(h, /righting that wrong/); assert.match(h, /you held 2 qualifying stan pieces/); assert.match(h, /claim your stan pieces/);
// into the grid
d.getElementById('c3-f13pick').onclick();
assert.equal(T.st().pickMode, 'f13');
assert.deepEqual(T.getFilteredTokens().map(t => t.key).sort(), ['gen2:1019', 'univ3rs3:93009'], 'grid shows only snapshot pieces');
assert.match(T.renderCard(T.bk('univ3rs3:93009')), /click to claim/);
T.openPicker(T.bk('univ3rs3:93009'));
assert.match(T.renderCard(T.bk('univ3rs3:93009')), /claimed ✓/);
assert.match(T.renderCard(T.bk('univ3rs3:93009')), /c3-picked/);
assert.match(d.getElementById('c3-pickbar').textContent, /1 of 2 claimed/);
T.openPicker(T.bk('univ3rs3:1010'));   // not a snapshot piece: ignored
assert.equal(T.st().f13.claimed.size, 1);
// back to the window for burns
d.getElementById('c3-viewcart').onclick();
assert.equal(T.st().pickMode, null);
h = d.getElementById('c3-modal-body').innerHTML;
assert.match(h, /tokens you can burn \(1 claim per edition burned\)/);
assert.match(h, /stan pieces claimed: 1 of 2/);
assert.match(h, /c3-f13card/); assert.match(h, /you hold 5/);
assert.equal(d.getElementById('c3-f13total').textContent, 'claims: 1');
d.querySelector('[data-f13plus="univ3rs3:70069"]').onclick(); d.querySelector('[data-f13plus="univ3rs3:70069"]').onclick();
const x9 = d.querySelector('[data-f13burn="bulk:9"]'); x9.value = '9'; x9.dispatchEvent(new w.Event('input'));
assert.equal(d.getElementById('c3-f13total').textContent, 'claims: 5');
assert.equal(x9.value, '9'); // clamped in the payload, not the box
await d.getElementById('c3-review').onclick();
const post = calls.find(c => c[0] === '/commit' && c[1].method === 'POST');
assert.equal(JSON.stringify(post[1].body), JSON.stringify({ phase: 'f13', holds: ['univ3rs3:93009'], burns: [{ key: 'univ3rs3:70069', qty: 2 }, { key: 'bulk:9', qty: 2 }] }));
// go back keeps choices; claim more returns to grid
d.getElementById('c3-back').onclick();
assert.equal(d.getElementById('c3-f13total').textContent, 'claims: 5');
d.getElementById('c3-f13back').onclick(); assert.equal(T.st().pickMode, 'f13');
T.openPicker(T.bk('gen2:1019')); d.getElementById('c3-viewcart').onclick();
assert.match(d.getElementById('c3-modal-body').innerHTML, /stan pieces claimed: 2 of 2/);
// no snapshot holds: straight to burns with the notice
const info2 = { ...info, snapshotHolds: [] }; T.set({ api: async () => info2 }); T.resetF13();
await T.openF13();
h = d.getElementById('c3-modal-body').innerHTML;
assert.match(h, /held none of the qualifying stan pieces/); assert.match(h, /1 claim per edition burned/); assert.doesNotMatch(h, /stan pieces claimed/);
// after the entry: claims summary and the burns checklist, no 3l3ction pledge; then closed
const info3 = { ...info, entry: { payload: { holds: ['univ3rs3:93009', 'gen2:1019'], burns: [{ key: 'univ3rs3:70069', qty: 3 }, { key: 'bulk:9', qty: 2 }] }, submitted_at: "2026-11-13T17:00:00Z" },
  sent: { "univ3rs3:70069>333burn": 3 }, confirmed: { holdClaims: 2, burnClaims: 3, burned: { "univ3rs3:70069": 3, "bulk:9": 0 }, claims: 5 } };
T.set({ api: async () => info3 });
await T.openF13();
h = d.getElementById('c3-modal-body').innerHTML;
assert.match(h, /claims: 5 \(up to 7 once every burn arrives\)/); assert.match(h, /confirmed ✓/); assert.match(h, /2 pieces on base to 333burn/); assert.doesNotMatch(h, /SACRED ACT/);
info3.window = { ...info3.window, open: false, closed: true };
await T.openF13();
assert.match(d.getElementById('c3-modal-body').innerHTML, /has closed/);
console.log("client tests (v51 grid flow): all passed");
process.exit(0);
