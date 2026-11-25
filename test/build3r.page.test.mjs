// Page test (jsdom). Run from a folder with jsdom installed: npm i jsdom@24, then node <this file>.
import { JSDOM } from "jsdom";
import fs from "fs";
import assert from "assert/strict";
const html = fs.readFileSync("/home/claude/repo/site/conn3ct_header_v57.html", "utf8");
const js = html.split("<script>")[1].split("</script>")[0];
const dom = new JSDOM(`<div class="c-view-bar"><button id="view-all"></button><button id="view-mine"></button></div><div id="wallet-pill"><span id="wallet-addr"></span><button id="disconnect-btn"></button></div><input id="search-input"><div id="c-grid"></div><div id="c-lb"><img id="lb-img"><div id="lb-data"></div></div><div id="results-count"></div>`, { runScripts: "outside-only", url: "https://thr33som3s.com/conn3ct" });
const w = dom.window, d = w.document; w.HTMLElement.prototype.scrollIntoView = () => {};
w.ethers = { providers: {}, Contract: function () {} };
w.eval(js + `;window.__t = { openLightbox, closeLightbox, renderGrid, filtersNow: () => filters, openBuild3r, openEvent, renderCard, getFilteredTokens, openPicker, refreshPlayerUi, addPlayerUi, onSearch,
  st: () => ({ pickMode, b3, evPlay }), bk: (k) => byKey.get(k),
  set: (o) => { if ('walletAddr' in o) walletAddr = o.walletAddr; if ('session' in o) session = o.session; if ('api' in o) api = o.api; if ('getJSON' in o) getJSON = o.getJSON; if ('provider' in o) provider = o.provider; if ('catalog' in o) { catalog = o.catalog; byKey = new Map(catalog.map(t => [t.key, t])); catalogLoaded = true; } } };`);
const T = w.__t;
const tok = (key, name, traits = {}) => ({ key, coll: key.split(':')[0], tokenId: key.split(':')[1], name, img: 'https://x/' + key + '.png', traits, editions: { minted: 5, burned: 0, circulating: 5, holders: 2 }, collection: key.split(':')[0], _words: [name, ...Object.values(traits)].join(' | ').toLowerCase() });
// real catalog rows (names and traits from the metadata sheets): every result of "stan" and "shayna", plus two others
const FX = JSON.parse(fs.readFileSync(new URL('./fixtures_stan_shayna.json', import.meta.url)));
const HIDDEN = new Set(['image_ipfs', 'updated', 's', 'last updated']);
const COLORS = new Set(['red','blue','white','yellow','green','black','lt blue','orange','gold','dk blue','lt green','saffron','maroon','light blue','dark blue','light green']);
T.set({ catalog: FX.map(f => ({ ...tok(f.key, f.name), traits: f.traits, _words: [f.name, ...Object.entries(f.traits).filter(([k]) => !COLORS.has(k) && !HIDDEN.has(k)).flatMap(([, v]) => [].concat(v))].join(' | ').toLowerCase() })) });
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
// search the universe: "stan" returns 22 cards (Don Stanhouse, Leroy Stanton, a Stanford birthplace...); click the 15 that belong
d.getElementById('c3-b3add').onclick();
assert.equal(T.st().pickMode, 'build');
d.getElementById('search-input').value = 'stan'; T.onSearch();
assert.equal(T.getFilteredTokens().length, 22);
assert.ok(T.getFilteredTokens().some(t => t.key === 'univ3rs3:4018'), 'Stanford, CA birthplace matches');
assert.doesNotMatch(d.getElementById('c3-pickbar').textContent, /add all/);
assert.match(T.renderCard(T.bk('univ3rs3:93009')), /click to add/);
const STAN = ['univ3rs3:93009','univ3rs3:34235','univ3rs3:3009','gen2:1019','gen2:1042','gen2:1080','gen2:1082','gen2:1092','gen2:1094','gen2:1098','gen3:2003','gen3:2065','gen3:2087','univ3rs3:70071','bulk:319027'];
STAN.forEach(k => T.openPicker(T.bk(k)));
assert.equal(T.st().b3.tokens.length, 15);
T.openPicker(T.bk('univ3rs3:4010')); T.openPicker(T.bk('univ3rs3:4010'));   // a mis-click on Don Stanhouse, undone
assert.equal(T.st().b3.tokens.length, 15);
assert.match(T.renderCard(T.bk('univ3rs3:93009')), /added ✓/);
assert.match(T.renderCard(T.bk('univ3rs3:4018')), /click to add/);
// details while building: open the expansion from the card's details button, add from inside it, close, nothing lost
T.set({ getJSON: async () => ({}) });
const grid = d.getElementById('c-grid');
grid.innerHTML = T.renderCard(T.bk('univ3rs3:4018'));
const detBtn = grid.querySelector('[data-details]');
assert.ok(detBtn, 'details button on cards while building');
T.openLightbox(grid.querySelector('[data-clickable]'));
assert.ok(d.getElementById('c-lb').classList.contains('open'));
let lb = d.getElementById('lb-data').innerHTML;
assert.match(lb, /Pretty Interesting Boyfriend/); assert.match(lb, /not in this 3v3nt/); assert.match(lb, /Stanford, CA/);
// a trait click inside the expansion doesn't navigate away while building
d.querySelector('#lb-data [data-trait-key]').dispatchEvent(new w.Event('click', { bubbles: true }));
assert.equal(Object.keys(T.filtersNow()).length, 0); assert.equal(d.getElementById('search-input').value, 'stan');
d.querySelector('[data-lbadd]').dispatchEvent(new w.Event('click', { bubbles: true }));
assert.equal(T.st().b3.tokens.length, 16); assert.match(d.getElementById('lb-data').innerHTML, /in this 3v3nt/);
d.querySelector('[data-lbadd]').dispatchEvent(new w.Event('click', { bubbles: true }));   // and out again
assert.equal(T.st().b3.tokens.length, 15); assert.match(d.getElementById('lb-data').innerHTML, /not in this 3v3nt/);
T.closeLightbox();
assert.equal(d.getElementById('c-lb').classList.contains('open'), false);
assert.equal(T.st().pickMode, 'build'); assert.equal(d.getElementById('search-input').value, 'stan'); assert.equal(T.getFilteredTokens().length, 22);
assert.match(T.renderCard(T.bk('univ3rs3:93009')), /added ✓/);
d.getElementById('search-input').value = 'shayna'; T.onSearch();
assert.equal(T.getFilteredTokens().length, 17);
const SHAYNA = ['univ3rs3:70069','univ3rs3:317004','univ3rs3:317006','univ3rs3:317010','univ3rs3:317011','bulk:9','bulk:319030'];
SHAYNA.forEach(k => T.openPicker(T.bk(k)));
d.getElementById('search-input').value = ''; T.onSearch();
T.openPicker(T.bk('thr33zi3s:9'));   // a cite token, for the cite page
assert.equal(T.st().b3.tokens.length, 23);
// back to the 3v3nt; assign on the role pages
d.getElementById('c3-viewcart').onclick();
assert.equal(T.st().pickMode, null);
assert.match(d.getElementById('c3-modal-body').innerHTML, /tokens in this 3v3nt: 23/);
d.querySelector('[data-b3role="unassigned"]').onclick();
assert.ok(d.getElementById('c3-modal').classList.contains('c3-wide'));
assert.equal(d.querySelectorAll('[data-b3move]').length, 23);
assert.match(d.getElementById('c3-b3selcount').textContent, /0 of 23 selected/);
// select several cards by clicking them, then assign them at once
const pick = (k) => d.querySelector(`[data-b3sel="${k}"]`).onclick();
[...SHAYNA, 'univ3rs3:70071', 'bulk:319027'].forEach(pick);
assert.match(d.getElementById('c3-b3selcount').textContent, /9 of 23 selected/);
pick('bulk:9'); pick('bulk:9');   // click twice: unselected, selected again
assert.ok(d.querySelector('[data-b3sel="bulk:9"]').classList.contains('c3-sel'));
assert.match(d.querySelector('[data-b3sel="bulk:9"]').innerHTML, /selected ✓/);
d.getElementById('c3-b3all').value = 'burn'; d.getElementById('c3-b3allgo').onclick();
assert.equal(d.querySelectorAll('[data-b3move]').length, 14, '9 burns assigned, 14 left');
assert.match(d.getElementById('c3-b3selcount').textContent, /0 of 14 selected/);
// assigning with nothing selected says so and changes nothing
d.getElementById('c3-b3allgo').onclick();
assert.match(d.getElementById('c3-msg').textContent, /select some cards first/); assert.equal(d.querySelectorAll('[data-b3move]').length, 14);
// the single-card dropdown still works, and clicking it doesn't select the card
const mv = (k, r) => { const s = d.querySelector(`[data-b3move="${k}"]`); s.value = r; s.onchange(); };
mv('thr33zi3s:9', 'cite');
// select all, then assign the rest to holder
d.getElementById('c3-b3selall').onclick();
assert.match(d.getElementById('c3-b3selcount').textContent, /13 of 13 selected/);
d.getElementById('c3-b3all').value = 'hold'; d.getElementById('c3-b3allgo').onclick();
assert.equal(d.querySelectorAll('[data-b3move]').length, 0);
d.getElementById('c3-b3back').onclick();
assert.equal(d.getElementById('c3-modal').classList.contains('c3-wide'), false);
// the result matches the hand-built f13 lists exactly
const roleOf = (r) => T.st().b3.tokens.filter(t => t.role === r).map(t => t.key).sort();
const F13_HOLD = ['univ3rs3:93009','univ3rs3:34235','univ3rs3:3009','gen2:1019','gen2:1042','gen2:1080','gen2:1082','gen2:1092','gen2:1094','gen2:1098','gen3:2003','gen3:2065','gen3:2087'];
const F13_BURN = ['univ3rs3:70069','univ3rs3:70071','univ3rs3:317004','univ3rs3:317006','univ3rs3:317010','univ3rs3:317011','bulk:9','bulk:319027','bulk:319030'];
assert.equal(JSON.stringify(roleOf('hold')), JSON.stringify([...F13_HOLD].sort()));
assert.equal(JSON.stringify(roleOf('burn')), JSON.stringify([...F13_BURN].sort()));
assert.equal(JSON.stringify(roleOf('cite')), '["thr33zi3s:9"]');
// ── rules on the role pages ──
d.querySelector('[data-b3role="hold"]').onclick();
let mb = () => d.getElementById('c3-modal-body').innerHTML;
assert.match(mb(), /the collector must hold it/); assert.match(mb(), /default rule/);
assert.equal(d.getElementById('c3-b3d-maxout').value, '1', 'holder default: at most 1 claim per token');
assert.match(mb(), /default: 1 → 1 claim · at most 1 claims/);
d.getElementById('c3-b3count').value = 'snapshot';
d.getElementById('c3-b3back').onclick();
// burn: the seven Shayna pieces as one group (3 → 2 claims, at most 6 burned), the MM006 on its own (1 → 5 entries)
d.querySelector('[data-b3role="burn"]').onclick();
const selc = (k) => d.querySelector(`[data-b3sel="${k}"]`).onclick();
d.getElementById('c3-b3rulego').onclick();
assert.match(d.getElementById('c3-msg').textContent, /select some cards first/);
SHAYNA.forEach(selc);
d.getElementById('c3-b3rulego').onclick();
assert.equal(d.getElementById('c3-b3rulepanel').hidden, false);
d.getElementById('c3-b3scope').value = 'group'; d.getElementById('c3-b3scope').onchange();
assert.equal(d.getElementById('c3-b3labelwrap').hidden, false);
d.getElementById('c3-b3s-n').value = '3'; d.getElementById('c3-b3s-m').value = '2'; d.getElementById('c3-b3s-unit').value = 'claims';
d.getElementById('c3-b3s-maxin').value = '6'; d.getElementById('c3-b3s-maxout').value = '';
d.getElementById('c3-b3ruleapply').onclick();
assert.match(d.querySelector('[data-b3sel="bulk:9"]').innerHTML, /group A: 3 → 2 claims · at most 6 in/);
assert.match(d.querySelector('[data-b3sel="univ3rs3:70071"]').innerHTML, /default: 1 → 1 claim/);
selc('univ3rs3:70071');
d.getElementById('c3-b3rulego').onclick();
d.getElementById('c3-b3scope').value = 'token'; d.getElementById('c3-b3scope').onchange();
d.getElementById('c3-b3s-n').value = '1'; d.getElementById('c3-b3s-m').value = '5'; d.getElementById('c3-b3s-unit').value = 'entries';
d.getElementById('c3-b3ruleapply').onclick();
assert.match(d.querySelector('[data-b3sel="univ3rs3:70071"]').innerHTML, /1 → 5 entries/);
// one Shayna piece back to the default: it leaves the group
selc('bulk:319030'); d.getElementById('c3-b3unrule').onclick();
assert.match(d.querySelector('[data-b3sel="bulk:319030"]').innerHTML, /default: 1 → 1 claim/);
assert.equal(T.st().b3.rules.find(r => r.scope === 'group').keys.length, 6);
d.getElementById('c3-b3back').onclick();
// cite: per token, a card is cited once, so its "cited" field is hidden; the default here gives 1 entry
d.querySelector('[data-b3role="cite"]').onclick();
assert.equal(d.getElementById('c3-b3d-nwrap').hidden, true);
d.getElementById('c3-b3d-unit').value = 'entries';
d.getElementById('c3-b3back').onclick();
d.getElementById('c3-b3intro').value = 'para one\n\npara two';
let picked = 0; const op = d.getElementById('c3-b3open'); op.showPicker = () => { picked++; }; op.dispatchEvent(new w.Event('click'));
assert.equal(picked, 1, 'clicking opens brings up the calendar');
d.getElementById('c3-b3open').value = '2026-11-13T11:00'; d.getElementById('c3-b3close').value = '2026-11-14T02:59';
assert.doesNotMatch(mb(), /c3-b3snapat/, 'no separate snapshot field');
assert.match(mb(), /publish at least 30 minutes before it opens/);
await d.getElementById('c3-b3pub').onclick();
const cfg = saved.at(-1).config;
assert.equal(saved.at(-1).phase, 'build3r'); assert.equal(cfg.status, 'published'); assert.equal(JSON.stringify(cfg.intro), '["para one","para two"]');
assert.equal(cfg.roles.hold.count, 'snapshot'); assert.equal(cfg.roles.cite.unit, 'entries'); assert.equal(cfg.roles.burn.m, 1);
assert.equal(JSON.stringify(cfg.rules.map(r => [r.role, r.scope, r.keys.length, r.n, r.m, r.unit, r.maxIn, r.maxOut, r.label || null])),
  JSON.stringify([['burn', 'group', 6, 3, 2, 'claims', 6, null, 'group A'], ['burn', 'token', 1, 1, 5, 'entries', null, null, null]]));
assert.equal(cfg.snapshot.tab, 'snapshot-friday-the-13th-x3'); assert.equal(Date.parse(cfg.window.opens) - Date.parse(cfg.snapshot.at), 10 * 60000, 'snapshot 10 minutes before opening');
assert.match(mb(), /requested for .*10 minutes before it opens; taken on the ledger's first run after that/);
assert.match(mb(), /published/);

// ── the player side, run from that config through the server's own rule code ──
const E = await import(new URL('../api/_lib/events.js', import.meta.url));
const scfg = E.cleanEvent(JSON.parse(JSON.stringify(cfg))).config;
const rulesFor = Object.fromEntries(['hold', 'burn', 'vault', 'cite'].map(r => [r, E.ruleBuckets(scfg, r).map(b => ({ scope: b.scope, keys: b.keys, label: b.label || null, n: b.n, m: b.m, unit: b.unit, maxIn: b.maxIn, maxOut: b.maxOut, text: E.ruleText(b) }))]));
const nameOf = (k) => (FX.find(f => f.key === k) || { name: k }).name;
const info = { id: cfg.id, name: cfg.name, intro: ['para one'], roles: scfg.roles, rules: rulesFor,
  window: { open: true, closed: false, closes: '2026-11-14T07:59:59Z', snapshotAt: '2026-11-13T16:30:22Z', holdCount: 'snapshot' },
  tokens: Object.fromEntries(['hold', 'burn', 'vault', 'cite'].map(r => [r, E.roleKeys(scfg, r).map(k => ({ key: k, name: nameOf(k) }))])),
  held: ['gen2:1019'], heldCounts: { 'gen2:1019': 2 }, balances: { 'univ3rs3:70069': 4, 'univ3rs3:317004': 2, 'univ3rs3:70071': 3 }, entry: null };
const posts = [];
T.set({ walletAddr: '0xabc', session: { wallet: '0xabc', profile: { username: 'p' } }, provider: { getSigner: () => ({ signMessage: async () => '0xsig' }) },
  api: async (path, o) => { if (path.startsWith('/commit?phase=event&')) return info; posts.push(o.body);
    const ent = E.entryClaims(scfg, E.cleanPayload(o.body), new Map([['gen2:1019', 2]])); return { issuedAt: 'x', message: 'm', ...ent }; } });
T.refreshPlayerUi(); assert.equal(d.getElementById('view-build3r'), null);
info.window.snapshotReady = false;
await T.openEvent(cfg.id);
assert.match(mb(), /holder claims open once the snapshot is in/);
info.window.snapshotReady = true;
await T.openEvent(cfg.id);
let h = mb();
assert.match(h, /para one/); assert.match(h, /0 of 1 claimed/); assert.match(h, /choose cards to cite/); assert.match(h, /you hold 4/);
assert.match(h, /group A: 3 → 2 claims · at most 6 in/); assert.match(h, /any mix of these counts together/);
assert.match(h, /1 → 5 entries/);
assert.doesNotMatch(h, /SBW009/, 'only pieces the wallet holds');
d.getElementById('c3-evhold').onclick();
assert.equal(JSON.stringify(T.getFilteredTokens().map(t => t.key)), '["gen2:1019"]');
T.openPicker(T.bk('univ3rs3:93009')); T.openPicker(T.bk('gen2:1019'));
assert.equal(JSON.stringify([...T.st().evPlay.hold]), '["gen2:1019"]');
d.getElementById('c3-viewcart').onclick();
assert.match(mb(), /thr33zi3s #1019 · 2 held/); assert.match(mb(), /1 → 1 claim · at most 1 claims/);
d.getElementById('c3-evcite').onclick();
assert.equal(JSON.stringify(T.getFilteredTokens().map(t => t.key)), '["thr33zi3s:9"]', 'cite: any card in the cite role, not owned');
T.openPicker(T.bk('thr33zi3s:9'));
d.getElementById('c3-viewcart').onclick();
const step = (k, n) => d.querySelector(`[data-evstep="burn|${k}|${n}"]`).onclick();
step('univ3rs3:70069', 1); step('univ3rs3:70069', 1); step('univ3rs3:317004', 1); step('univ3rs3:317004', 1);
assert.match(d.getElementById('c3-evtotal').textContent, /group A: burn in multiples of 3 \(now 4\)/);
step('univ3rs3:317004', -1);
step('univ3rs3:70071', 1);
assert.equal(d.querySelector('[data-evqty="burn|univ3rs3:70071"]').value, '1');
assert.equal(d.getElementById('c3-evtotal').textContent, 'claims: 3 · entries on the wheel: 6', '1 held (default) + 2 from group A; 5 from MM006 + 1 cite');
await d.getElementById('c3-review').onclick();
assert.equal(JSON.stringify(posts[0]), JSON.stringify({ phase: 'event', id: cfg.id, hold: ['gen2:1019'], cite: ['thr33zi3s:9'], burn: [{ key: 'univ3rs3:70069', qty: 2 }, { key: 'univ3rs3:317004', qty: 1 }, { key: 'univ3rs3:70071', qty: 1 }], vault: [] }));
assert.match(mb(), /claims: 3 · entries on the wheel: 6/);
await d.getElementById('c3-submit').onclick();
assert.equal(posts[1].signature, '0xsig');
info.entry = { payload: posts[0] }; info.sent = { 'univ3rs3:70069>333burn': 2, 'univ3rs3:70071>333burn': 1 };
info.confirmed = { arrived: {}, claims: 1, entries: 6, pending: 2, pendingEntries: 0 };
await T.openEvent(cfg.id);
h = mb();
assert.match(h, /claims: 1 \(up to 3 once everything sent arrives\) · entries on the wheel: 6/); assert.match(h, /cited/);
console.log("client tests (v57 build3r rules + generic 3v3nts): all passed");
process.exit(0);
