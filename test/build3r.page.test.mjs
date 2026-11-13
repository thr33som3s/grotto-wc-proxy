// Page test (jsdom). Run from a folder with jsdom installed: npm i jsdom@24, then node <this file>.
import { JSDOM } from "jsdom";
import fs from "fs";
import assert from "assert/strict";
const html = fs.readFileSync("/home/claude/repo/site/conn3ct_header_v52.html", "utf8");
const js = html.split("<script>")[1].split("</script>")[0];
const dom = new JSDOM(`<div class="c-view-bar"><button id="view-all"></button><button id="view-mine"></button></div><div id="wallet-pill"><span id="wallet-addr"></span><button id="disconnect-btn"></button></div><input id="search-input"><div id="c-grid"></div><div id="results-count"></div>`, { runScripts: "outside-only", url: "https://thr33som3s.com/conn3ct" });
const w = dom.window, d = w.document; w.HTMLElement.prototype.scrollIntoView = () => {};
w.ethers = { providers: {}, Contract: function () {} };
w.eval(js + `;window.__t = { openBuild3r, openEvent, renderCard, getFilteredTokens, openPicker, refreshPlayerUi, addPlayerUi, onSearch,
  st: () => ({ pickMode, b3, evPlay }), bk: (k) => byKey.get(k),
  set: (o) => { if ('walletAddr' in o) walletAddr = o.walletAddr; if ('session' in o) session = o.session; if ('api' in o) api = o.api; if ('getJSON' in o) getJSON = o.getJSON; if ('provider' in o) provider = o.provider; if ('catalog' in o) { catalog = o.catalog; byKey = new Map(catalog.map(t => [t.key, t])); catalogLoaded = true; } } };`);
const T = w.__t;
const tok = (key, name, traits = {}) => ({ key, coll: key.split(':')[0], tokenId: key.split(':')[1], name, img: 'https://x/' + key + '.png', traits, editions: { minted: 5, burned: 0, circulating: 5, holders: 2 }, collection: key.split(':')[0], _words: [name, ...Object.values(traits)].join(' | ').toLowerCase() });
T.set({ catalog: [tok('univ3rs3:93009', 'Stan Thomas Hold'), tok('univ3rs3:34235', 'Stan Johnson'), tok('gen2:1019', 'thr33zi3s #1019', { 'face/mouth': 'STAN THOMAS' }),
  tok('univ3rs3:70069', 'Stan G3lt'), tok('bulk:9', 'Black and White Silhouette "Shayna Twitchell"'), tok('univ3rs3:1010', 'Old Grandma'), tok('thr33zi3s:9', 'thr33zi3s #0009')] });
T.set({ getJSON: async () => ({ events: [] }) });
T.addPlayerUi();
const ARTIST = '0xfe917312344b4ed3283c5e142868cd3eaa782933';
// non-artist: no build3r button
T.set({ walletAddr: '0xabc', session: { wallet: '0xabc', profile: { username: 'x' } } }); T.refreshPlayerUi();
assert.equal(d.getElementById('view-build3r'), null);
// artist
const saved = [];
T.set({ walletAddr: ARTIST, session: { wallet: ARTIST, profile: { username: 'thr33som3s' } },
  api: async (path, o) => { if (path.startsWith('/commit?phase=events')) return { events: [] }; if (o && o.method === 'POST') { saved.push(o.body); return { config: o.body.config }; } throw new Error(path); } });
T.refreshPlayerUi();
assert.ok(d.getElementById('view-build3r'), 'build3r button for thr33s');
await T.openBuild3r();
d.getElementById('c3-b3name').value = 'Friday the 13th x3'; d.getElementById('c3-b3name').dispatchEvent(new w.Event('input'));
assert.equal(d.getElementById('c3-b3id').value, 'friday-the-13th-x3');
d.getElementById('c3-b3new').onclick();
assert.match(d.getElementById('c3-modal-body').innerHTML, /build3r: Friday the 13th x3/);
d.getElementById('c3-b3intro').value = 'para one\n\npara two';
// search the universe: "stan", add all results, then drop Stan Johnson by clicking it
d.getElementById('c3-b3add').onclick();
assert.equal(T.st().pickMode, 'build');
d.getElementById('search-input').value = 'stan'; T.onSearch();
const res = T.getFilteredTokens().map(t => t.key).sort();
assert.equal(JSON.stringify(res), JSON.stringify(['gen2:1019', 'univ3rs3:34235', 'univ3rs3:70069', 'univ3rs3:93009']));
assert.match(d.getElementById('c3-pickbar').textContent, /add all 4 results/);
assert.match(T.renderCard(T.bk('univ3rs3:93009')), /click to add/);
d.getElementById('c3-b3addall').onclick();
assert.equal(T.st().b3.tokens.length, 4);
T.openPicker(T.bk('univ3rs3:34235'));   // click again: removed
assert.equal(T.st().b3.tokens.length, 3);
assert.match(T.renderCard(T.bk('univ3rs3:93009')), /added ✓/);
d.getElementById('search-input').value = 'shayna'; T.onSearch();
T.openPicker(T.bk('bulk:9'));
d.getElementById('search-input').value = ''; T.onSearch();
T.openPicker(T.bk('thr33zi3s:9'));
assert.equal(T.st().b3.tokens.length, 5);
// back to the 3v3nt; assign on the role pages
d.getElementById('c3-viewcart').onclick();
assert.equal(T.st().pickMode, null);
assert.match(d.getElementById('c3-modal-body').innerHTML, /tokens in this 3v3nt: 5/);
d.querySelector('[data-b3role="unassigned"]').onclick();
assert.ok(d.getElementById('c3-modal').classList.contains('c3-wide'));
assert.equal(d.querySelectorAll('[data-b3move]').length, 5);
const mv = (k, r) => { const s = d.querySelector(`[data-b3move="${k}"]`); s.value = r; s.onchange(); };
mv('univ3rs3:70069', 'burn'); mv('bulk:9', 'burn'); mv('thr33zi3s:9', 'cite');
d.getElementById('c3-b3all').value = 'hold'; d.getElementById('c3-b3allgo').onclick();
assert.equal(d.querySelectorAll('[data-b3move]').length, 0);
d.getElementById('c3-b3back').onclick();
assert.equal(d.getElementById('c3-modal').classList.contains('c3-wide'), false);
const roles = Object.fromEntries(['hold','burn','cite'].map(r => [r, T.st().b3.tokens.filter(t => t.role === r).map(t => t.key).sort()]));
assert.equal(JSON.stringify(roles), JSON.stringify({ hold: ['gen2:1019', 'univ3rs3:93009'], burn: ['bulk:9', 'univ3rs3:70069'], cite: ['thr33zi3s:9'] }));
d.querySelector('[data-b3role="hold"]').onclick();
assert.match(d.getElementById('c3-modal-body').innerHTML, /the collector must hold it/);
d.getElementById('c3-b3claims').value = '1'; d.getElementById('c3-b3max').value = ''; d.getElementById('c3-b3count').value = 'snapshot';
d.getElementById('c3-b3back').onclick();
d.querySelector('[data-b3role="cite"]').onclick(); d.getElementById('c3-b3claims').value = '0'; d.getElementById('c3-b3max').value = '1'; d.getElementById('c3-b3back').onclick();
d.getElementById('c3-b3intro').value = 'para one\n\npara two';
d.getElementById('c3-b3open').value = '2026-11-13T11:00'; d.getElementById('c3-b3close').value = '2026-11-14T02:59';
d.getElementById('c3-b3snaptab').value = 'snapshot-f13';
await d.getElementById('c3-b3pub').onclick();
const cfg = saved.at(-1).config;
assert.equal(saved.at(-1).phase, 'build3r'); assert.equal(cfg.status, 'published'); assert.equal(JSON.stringify(cfg.intro), '["para one","para two"]');
assert.equal(cfg.roles.cite.claims, 0); assert.equal(cfg.roles.cite.max, 1); assert.equal(cfg.roles.hold.count, 'snapshot'); assert.equal(cfg.snapshot.tab, 'snapshot-f13');
assert.ok(cfg.window.opens.endsWith('Z') && Date.parse(cfg.window.closes) > Date.parse(cfg.window.opens));
assert.match(d.getElementById('c3-modal-body').innerHTML, /published/);

// ── the player side, run from that config ──
const info = { id: cfg.id, name: cfg.name, intro: ['para one'], roles: { hold: { count: 'snapshot', claims: 1, max: null }, burn: { claims: 1, max: null }, vault: { claims: 1, max: null }, cite: { claims: 0, max: 1 } },
  window: { open: true, closed: false, closes: '2026-11-14T07:59:59Z', snapshotAt: '2026-11-13T16:30:22Z', holdCount: 'snapshot' },
  tokens: { hold: [{ key: 'univ3rs3:93009', name: 'Stan Thomas Hold' }, { key: 'gen2:1019', name: 'thr33zi3s #1019' }], burn: [{ key: 'univ3rs3:70069', name: 'Stan G3lt' }, { key: 'bulk:9', name: 'Shayna' }], vault: [], cite: [{ key: 'thr33zi3s:9', name: 'thr33zi3s #0009' }] },
  held: ['gen2:1019'], balances: { 'univ3rs3:70069': 4 }, entry: null };
const posts = [];
T.set({ walletAddr: '0xabc', session: { wallet: '0xabc', profile: { username: 'p' } }, provider: { getSigner: () => ({ signMessage: async () => '0xsig' }) },
  api: async (path, o) => { if (path.startsWith('/commit?phase=event&')) return info; posts.push(o.body); return { issuedAt: 'x', message: 'm', claims: 3 }; } });
T.refreshPlayerUi(); assert.equal(d.getElementById('view-build3r'), null);
await T.openEvent(cfg.id);
let h = d.getElementById('c3-modal-body').innerHTML;
assert.match(h, /para one/); assert.match(h, /0 of 1 claimed/); assert.match(h, /choose cards to cite/); assert.match(h, /1 claim per edition burned/); assert.match(h, /you hold 4/);
assert.doesNotMatch(h, /Shayna/, 'only burnables held');
d.getElementById('c3-evhold').onclick();
assert.equal(JSON.stringify(T.getFilteredTokens().map(t => t.key)), '["gen2:1019"]');
T.openPicker(T.bk('univ3rs3:93009')); T.openPicker(T.bk('gen2:1019'));
assert.equal(JSON.stringify([...T.st().evPlay.hold]), '["gen2:1019"]');
d.getElementById('c3-viewcart').onclick();
d.getElementById('c3-evcite').onclick();
assert.equal(JSON.stringify(T.getFilteredTokens().map(t => t.key)), '["thr33zi3s:9"]', 'cite: any card in the cite role, not owned');
T.openPicker(T.bk('thr33zi3s:9'));
assert.match(T.renderCard(T.bk('thr33zi3s:9')), /cited ✓/);
d.getElementById('c3-viewcart').onclick();
d.querySelector('[data-evstep="burn|univ3rs3:70069|1"]').onclick(); d.querySelector('[data-evstep="burn|univ3rs3:70069|1"]').onclick();
assert.equal(d.getElementById('c3-evtotal').textContent, 'claims: 3');   // 1 hold + 0 cite + 2 burns
await d.getElementById('c3-review').onclick();
assert.equal(JSON.stringify(posts[0]), JSON.stringify({ phase: 'event', id: cfg.id, hold: ['gen2:1019'], cite: ['thr33zi3s:9'], burn: [{ key: 'univ3rs3:70069', qty: 2 }], vault: [] }));
await d.getElementById('c3-submit').onclick();
assert.equal(posts[1].signature, '0xsig');
info.entry = { payload: posts[0] }; info.sent = { 'univ3rs3:70069>333burn': 1 }; info.confirmed = { arrived: { 'univ3rs3:70069>333burn': 1 }, claims: 2, pending: 1 };
await T.openEvent(cfg.id);
h = d.getElementById('c3-modal-body').innerHTML;
assert.match(h, /claims: 2 \(up to 3 once everything sent arrives\)/); assert.match(h, /cited/); assert.match(h, /step 1 of 1/);
console.log("client tests (v52 build3r + generic 3v3nts): all passed");
process.exit(0);
