// friday the 13th x3: results, kept current. Apps Script bound to the "friday the 13th x3: results" sheet.
// Runs as 3s@thr33som3s.com every 5 minutes and rewrites three tabs:
//   By collector  one row per entry: held claims, burns committed and arrived at 333burn, editions, pending
//   Detail        one row per token per entry, with burn transactions
//   Snapshot      who held the qualifying pieces at the snapshot, and how much of it they've cited
// Reads: the private store (entries, claimed profiles), the ledger sheet (transfers, state, snapshot-f13) and the
// metadata sheets (piece names). Names come from claimed conn3ct profiles; any other wallet shows as the wallet.
// Setup, once: paste this file into Extensions → Apps Script, run installTrigger, approve access.
// installTrigger runs refreshResults once and sets the 5-minute timer (it never adds a second one).

const F13 = {
  storeId: "10hplc8h_AOXz_w9VOxVc9Fg_Tp97Gqg-tNi-dpCzbaQ",
  ledgerId: "1vDH6lXF_xegq8pWzGdDgHJPwnmpmoDXZoMaWj967UtM",
  metadata: {
    univ3rs3: "1qnlN5EHwSn71bjMFKCu9y71DUdNnkvcVda6AA2HPi-s",
    bulk: "1s_8-7x5Sq9vnARg1myRKWHnjqjyoj-7QXelol0l8xwQ",
    gen2: "1fmYevh7PteIB8VD7u7MstffY8ZR6qK6BgKrgUEVVQRU",
    gen3: "1i15K-52jj4wMYMRWUcYrZuwxJQcAXcFPn-ocglmkxgg",
  },
  phase: "f13",
  opens: "2026-11-13T16:00:00Z",
  closes: "2026-11-14T07:59:59Z",
  snapshotTab: "snapshot-f13",
  snapshotLabel: "Fri Nov 13, 11:30:22am EST",
  burnWallet: "0x3d373231a0a60bb6203fd1a91e3f058100c2244d",
  hold: ["univ3rs3:93009", "univ3rs3:34235", "univ3rs3:3009", "gen2:1019", "gen2:1042", "gen2:1080", "gen2:1082", "gen2:1092",
    "gen2:1094", "gen2:1098", "gen3:2003", "gen3:2065", "gen3:2087"],
  burn: ["univ3rs3:70069", "univ3rs3:70071", "univ3rs3:317004", "univ3rs3:317006", "univ3rs3:317010", "univ3rs3:317011",
    "bulk:9", "bulk:319027", "bulk:319030"],
  tz: "America/New_York",
};

function installTrigger() {
  refreshResults();
  const has = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === "refreshResults");
  if (!has) ScriptApp.newTrigger("refreshResults").timeBased().everyMinutes(5).create();
}

function refreshResults() {
  const data = readAll_();
  const out = buildResults_(data);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  writeTab_(ss, "By collector", out.byCollector, 2);
  writeTab_(ss, "Detail", out.detail, 1);
  writeTab_(ss, "Snapshot", out.snapshot, 2);
}

// ---------- reading ----------
function rows_(id, tab) {
  const ss = SpreadsheetApp.openById(id);
  const sh = tab ? ss.getSheetByName(tab) : ss.getSheets()[0];
  if (!sh) throw new Error(`missing tab ${tab} in ${id}`);
  return sh.getDataRange().getValues();
}
function readAll_() {
  const names = {};
  const wanted = new Set([...F13.hold, ...F13.burn]);
  for (const [coll, id] of Object.entries(F13.metadata)) {
    const v = rows_(id, null);
    const h = v[0].map((x) => String(x).trim().toLowerCase());
    const ti = h.indexOf("token_id"), ni = h.indexOf("card_name") >= 0 ? h.indexOf("card_name") : h.indexOf("name");
    for (const r of v.slice(1)) { const k = `${coll}:${String(r[ti]).trim()}`; if (wanted.has(k)) names[k] = String(r[ni]).trim(); }
  }
  return {
    names,
    profiles: rows_(F13.storeId, "profiles").slice(1),
    commitments: rows_(F13.storeId, "commitments").slice(1),
    transfers: rows_(F13.ledgerId, "transfers").slice(1),
    state: rows_(F13.ledgerId, "state").slice(1),
    snapshot: rows_(F13.ledgerId, F13.snapshotTab).slice(1),
  };
}

// ---------- the results (pure: same input, same output) ----------
const iso_ = (v) => (v instanceof Date ? v.toISOString() : String(v));
function est_(isoStr) { return Utilities.formatDate(new Date(isoStr), F13.tz, "MMM dd hh:mm a z"); }
function buildResults_(d) {
  const lc = (w) => String(w).trim().toLowerCase();
  const prof = {};
  for (const r of d.profiles) { try { const u = JSON.parse(r[3]).username; if (u) prof[lc(r[0])] = u; } catch (e) {} }
  const nameOf = (w) => prof[w] || w;
  const tok = (k) => d.names[k] || k;
  const lastRun = d.state.map((r) => iso_(r[3])).filter(Boolean).sort().pop() || "";
  const asOf = lastRun ? `the ledger run ${est_(lastRun)}` : "the latest ledger run";
  const entries = d.commitments.filter((r) => String(r[0]) === F13.phase).map((r) => ({ w: lc(r[1]), at: iso_(r[2]), p: JSON.parse(r[3]) }))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  const opens = Date.parse(F13.opens), closes = Date.parse(F13.closes);
  const burns = d.transfers.filter((r) => lc(r[5]) === F13.burnWallet).map((r) => ({ from: lc(r[4]), key: `${r[1]}:${String(r[3])}`, amt: Number(r[6]), t: Date.parse(iso_(r[9])), tx: String(r[10]) }))
    .filter((b) => b.t >= opens && b.t <= closes);

  const byCollector = [[`friday the 13th x3: results as of ${asOf}. Profile names come from claimed conn3ct profiles; wallets without one show as the wallet. Updates itself every 5 minutes.`],
    ["profile", "wallet", "entered", "held: claims", "held: tokens", "burns committed", "burns arrived at 333burn", "burn details (arrived / committed)", "total editions (held + burns arrived)", "still pending (committed, not yet arrived)"]];
  const detail = [["profile", "wallet", "role", "token", "name", "committed", "arrived at 333burn", "transactions"]];
  const tot = [0, 0, 0, 0];
  for (const e of entries) {
    const holds = e.p.holds || [], bl = e.p.burns || [];
    const arrived = {}, txs = {};
    for (const b of bl) {
      const mine = burns.filter((x) => x.from === e.w && x.key === b.key);
      arrived[b.key] = Math.min(Number(b.qty), mine.reduce((a, x) => a + x.amt, 0));
      txs[b.key] = mine.map((x) => x.tx).join(" ");
    }
    const bc = bl.reduce((a, b) => a + Number(b.qty), 0), ba = Object.values(arrived).reduce((a, n) => a + n, 0);
    byCollector.push([nameOf(e.w), e.w, est_(e.at), holds.length, holds.map(tok).join(" | "), bc, ba,
      bl.map((b) => `${tok(b.key)}: ${arrived[b.key]} / ${b.qty}`).join(" | ") || "none", holds.length + ba, bc - ba]);
    tot[0] += holds.length; tot[1] += bc; tot[2] += ba; tot[3] += holds.length + ba;
    for (const k of holds) detail.push([nameOf(e.w), e.w, "held (snapshot)", k, tok(k), 1, "", ""]);
    for (const b of bl) detail.push([nameOf(e.w), e.w, "burn", b.key, tok(b.key), Number(b.qty), arrived[b.key], txs[b.key]]);
  }
  byCollector.push(["TOTAL", `${entries.length} entries`, "", tot[0], "", tot[1], tot[2], "", tot[3], tot[1] - tot[2]]);

  // Snapshot: holdings of the qualifying pieces, and what each wallet has cited.
  const order = Object.fromEntries(F13.hold.map((k, i) => [k, i]));
  const held = {};
  for (const r of d.snapshot) {
    const k = `${r[0]}:${String(r[1])}`, n = Number(r[3]);
    if (k in order && n > 0) (held[lc(r[2])] = held[lc(r[2])] || {})[k] = n;
  }
  const cited = Object.fromEntries(entries.map((e) => [e.w, e.p.holds || []]));
  const srows = Object.entries(held).map(([w, h]) => {
    const ks = Object.keys(h).sort((a, b) => order[a] - order[b]);
    const c = cited[w];
    return [nameOf(w), w, ks.length, ks.map((k) => `${tok(k)}${h[k] > 1 ? " ×" + h[k] : ""}`).join(" | "), c ? "yes" : "no", c ? c.length : 0, ks.length - (c ? c.length : 0)];
  }).sort((a, b) => b[2] - a[2] || (String(a[0]).startsWith("0x") - String(b[0]).startsWith("0x")) || String(a[0]).toLowerCase().localeCompare(String(b[0]).toLowerCase()));
  const snapshot = [[`snapshot: holdings of the ${F13.hold.length} qualifying stan pieces as of ${F13.snapshotLabel} (ledger tab ${F13.snapshotTab}). Entries as of ${asOf}. Profile names from claimed conn3ct profiles; wallets without one show as the wallet. Updates itself every 5 minutes.`],
    ["profile", "wallet", "qualifying pieces held (claims available)", "pieces held at the snapshot", "entered", "pieces cited", "not cited"], ...srows,
    ["TOTAL", `${srows.length} wallets`, srows.reduce((a, r) => a + r[2], 0), "", `${srows.filter((r) => r[4] === "yes").length} entered`, srows.reduce((a, r) => a + r[5], 0), srows.reduce((a, r) => a + r[6], 0)],
    [], ["by piece", "", "holders", "editions held", "holders"]];
  for (const k of F13.hold) {
    const hs = Object.entries(held).filter(([, h]) => h[k]).map(([w, h]) => [w, h[k]])
      .sort((a, b) => (String(nameOf(a[0])).startsWith("0x") - String(nameOf(b[0])).startsWith("0x")) || String(nameOf(a[0])).toLowerCase().localeCompare(String(nameOf(b[0])).toLowerCase()));
    snapshot.push([tok(k), k, hs.length, hs.reduce((a, x) => a + x[1], 0), hs.map(([w, n]) => `${nameOf(w)}${n > 1 ? " ×" + n : ""}`).join(" | ")]);
  }
  return { byCollector, detail, snapshot };
}

// ---------- writing ----------
// Rewrites a tab whole (cleared first, so a shorter list leaves no stale rows).
function writeTab_(ss, name, rows, frozen) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  const width = Math.max(...rows.map((r) => r.length));
  const grid = rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
  sh.getRange(1, 1, grid.length, width).setNumberFormat("@").setValues(grid);   // plain text: times and wallets are never reinterpreted
  sh.setFrozenRows(frozen);
}
