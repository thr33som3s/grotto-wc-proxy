import { JSDOM } from "jsdom";
import fs from "fs";
import assert from "assert/strict";
const html = fs.readFileSync("/home/claude/repo/site/conn3ct_header_v51.html", "utf8");
const js = html.split("<script>")[1].split("</script>")[0];
const dom = new JSDOM(`<div class="c-view-bar"></div><div id="wallet-pill"><span id="wallet-addr"></span><button id="disconnect-btn"></button></div>`, { runScripts: "outside-only", url: "https://thr33som3s.com/conn3ct" });
const w = dom.window;
w.ethers = { providers: {}, Contract: function () {} };
w.eval(js + `;window.__t = { openF13, f13Entry, f13Status, addPlayerUi, set: (o) => { if ('walletAddr' in o) walletAddr = o.walletAddr; if ('session' in o) session = o.session; if ('api' in o) api = o.api; if ('provider' in o) provider = o.provider; } };`);
const T = w.__t;
T.addPlayerUi();
assert.ok(w.document.getElementById('view-f13'), 'button added');
const calls = [];
const info = {
  window: { open: true, closed: false, closes: "2026-11-14T07:59:59Z", snapshotAt: "2026-11-13T16:30:22Z", testMode: false },
  hold: [{ key: "univ3rs3:93009", name: "Hold A", image: "" }, { key: "gen2:1019", name: "thr33zi3s #1019", image: "" }],
  burn: [{ key: "univ3rs3:70069", name: "Burn A", image: "" }, { key: "bulk:9", name: "Shayna", image: "" }, { key: "bulk:319027", name: "Burn C", image: "" }],
  snapshotHolds: ["univ3rs3:93009", "gen2:1019"], burnable: { "univ3rs3:70069": 5, "bulk:9": 2 }, entry: null,
};
T.set({ walletAddr: "0xabc", session: { profile: { username: "t" } }, api: async (path, o) => { calls.push([path, o]); if (path.startsWith('/commit?')) return info; return { issuedAt: "x", message: "m", claims: 5 }; }, provider: { getSigner: () => ({ signMessage: async () => "0xsig" }) } });
await T.openF13();
const d = w.document;
assert.equal(d.querySelectorAll('[data-f13hold]').length, 2);
assert.equal(d.querySelectorAll('[data-f13burn]').length, 2, 'only burnables held');
assert.equal(d.getElementById('c3-f13total').textContent, 'claims: 2');
const b = d.querySelector('[data-f13burn="univ3rs3:70069"]'); b.value = "3"; b.dispatchEvent(new w.Event('input'));
assert.equal(d.getElementById('c3-f13total').textContent, 'claims: 5');
d.querySelector('[data-f13hold="gen2:1019"]').checked = false; d.querySelector('[data-f13hold="gen2:1019"]').dispatchEvent(new w.Event('input'));
assert.equal(d.getElementById('c3-f13total').textContent, 'claims: 4');
d.querySelector('[data-f13hold="gen2:1019"]').checked = true;
// over the max is clamped to the balance
const s9 = d.querySelector('[data-f13burn="bulk:9"]'); s9.value = "9";
await d.getElementById('c3-review').onclick();
const post = calls.find(c => c[0] === '/commit' && c[1].method === 'POST');
assert.equal(JSON.stringify(post[1].body), JSON.stringify({ phase: 'f13', holds: ["univ3rs3:93009", "gen2:1019"], burns: [{ key: "univ3rs3:70069", qty: 3 }, { key: "bulk:9", qty: 2 }] }));
assert.match(d.body.innerHTML, /sign and submit/);
// after entry: burns checklist with steps for eth and base, no 3l3ction pledge
info.entry = { payload: post[1].body, submitted_at: "2026-11-13T17:00:00Z" };
info.sent = { "univ3rs3:70069>333burn": 3 }; info.confirmed = { holdClaims: 2, burnClaims: 3, burned: { "univ3rs3:70069": 3, "bulk:9": 0 }, claims: 5 };
await T.openF13();
const h = d.getElementById('c3-modal-body').innerHTML;
assert.match(h, /claims: 5 \(up to 7 once every burn arrives\)/);
assert.match(h, /confirmed ✓/); assert.match(h, /step 1 of 1/); assert.match(h, /righting that wrong/); assert.match(h, /Friday the 13th x3/); assert.match(h, /2 pieces on base to 333burn/);
assert.doesNotMatch(h, /SACRED ACT/);
// closed
info.window.open = false; info.window.closed = true;
await T.openF13();
assert.match(d.getElementById('c3-modal-body').innerHTML, /has closed/);
// no entry and closed
info.entry = null; await T.openF13();
assert.match(d.getElementById('c3-modal-body').innerHTML, /has closed/);
console.log("client tests: all passed");
process.exit(0);
