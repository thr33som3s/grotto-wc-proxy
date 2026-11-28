// ── 3v3nt results: one tab per published 3v3nt, rewritten every 5 minutes ──
// Apps Script bound to the "3v3nt results" workbook. Runs as its owner. Reads the private store (3v3nts, entries,
// profiles), the ledger sheet (transfers, ledger runs, snapshots) and the metadata sheets (piece names), and counts
// claims and entries with the server's own rule code (bundled above, generated from api/_lib/events.js).
// Names come from claimed conn3ct profiles; any other wallet shows as the wallet.
// Setup, once: Extensions → Apps Script, paste this file, run installTrigger, approve access.
var STORE_ID = "10hplc8h_AOXz_w9VOxVc9Fg_Tp97Gqg-tNi-dpCzbaQ";
var LEDGER_ID = "1vDH6lXF_xegq8pWzGdDgHJPwnmpmoDXZoMaWj967UtM";
var WALLETS = { "333burn": "0x3d373231a0a60bb6203fd1a91e3f058100c2244d", "3vault": "0xe5a97ce51460114e13b632df211896c663cbae76" };
var TZ = "America/New_York";

function installTrigger() {
  refreshResults();
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "refreshResults"; });
  if (!has) ScriptApp.newTrigger("refreshResults").timeBased().everyMinutes(5).create();
}

function vals_(id, tab) {
  var ss = SpreadsheetApp.openById(id);
  var sh = tab ? ss.getSheetByName(tab) : ss.getSheets()[0];
  return sh ? sh.getDataRange().getDisplayValues() : null;
}
function when_(iso) { return iso ? Utilities.formatDate(new Date(iso), TZ, "MMM d, h:mm a z") : ""; }

function refreshResults() {
  var events = (vals_(STORE_ID, "events") || [[]]).slice(1).filter(function (r) { return r[0]; })
    .map(function (r) { try { return JSON.parse(r[2]); } catch (e) { return null; } })
    .filter(function (c) { return c && c.status === "published"; })
    .map(function (c) { return cleanEvent(c, 0).config; });   // the server's own cleaning (older saved shapes included)
  if (!events.length) return;
  var data = {
    profiles: (vals_(STORE_ID, "profiles") || [[]]).slice(1),
    commitments: (vals_(STORE_ID, "commitments") || [[]]).slice(1),
    transfers: (vals_(LEDGER_ID, "transfers") || [[]]).slice(1),
    state: (vals_(LEDGER_ID, "state") || [[]]).slice(1),
    snapshot: function (tab) { var v = vals_(LEDGER_ID, tab); return v ? v.slice(1) : null; },
    metadata: function (coll) { var c = COLLECTIONS.filter(function (x) { return x.key === coll; })[0]; return c ? vals_(c.sheet, null) : null; },
  };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  events.forEach(function (cfg) {
    var rows = eventTab_(cfg, data);
    var name = tabName_(cfg);
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clearContents();
    var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var grid = rows.map(function (r) { return r.concat(Array(width - r.length).fill("")); });
    sh.getRange(1, 1, grid.length, width).setNumberFormat("@").setValues(grid);
    sh.setFrozenRows(1);
  });
}
function tabName_(cfg) { return (String(cfg.name || cfg.id).replace(/[\[\]:*?\/\\]/g, " ").trim() + " (" + cfg.id + ")").slice(0, 100); }

// One 3v3nt's tab: who entered and what they earned, the detail behind it, and the snapshot (holder 3v3nts).
function eventTab_(cfg, d) {
  var lc = function (w) { return String(w || "").trim().toLowerCase(); };
  var prof = {};
  d.profiles.forEach(function (r) { try { var u = JSON.parse(r[3]).username; if (u) prof[lc(r[0])] = u; } catch (e) {} });
  var who = function (w) { return prof[w] || w; };
  var names = {};
  eventCollections(cfg).forEach(function (coll) {
    var v = d.metadata(coll); if (!v) return;
    buildCollection(COLLECTIONS.filter(function (x) { return x.key === coll; })[0], v).forEach(function (t) { names[t.key] = t.name; });
  });
  var nm = function (k) { return names[k] || k; };
  var lastRun = d.state.map(function (r) { return r[3]; }).filter(Boolean).sort().pop() || "";
  var opens = Date.parse(cfg.window.opens), closes = Date.parse(cfg.window.closes);
  var byDest = {}; Object.keys(WALLETS).forEach(function (n) { byDest[WALLETS[n]] = n; });
  var transfers = d.transfers.map(function (r) { return { key: r[1] + ":" + r[3], from: lc(r[4]), to: lc(r[5]), amount: Number(r[6]) || 0, time: r[9], tx: r[10] }; })
    .filter(function (t) { var at = Date.parse(t.time); return byDest[t.to] && at >= opens && at <= closes; });
  var phase = "event:" + cfg.id;
  var entries = d.commitments.filter(function (r) { return r[0] === phase; })
    .map(function (r) { return { w: lc(r[1]), at: r[2], p: cleanPayload(JSON.parse(r[3] || "{}")) }; })
    .sort(function (a, b) { return a.at < b.at ? -1 : 1; });

  var out = [[cfg.name + ": results as of the ledger run " + when_(lastRun) + ". Open " + when_(cfg.window.opens) + " until " + when_(cfg.window.closes)
    + ". Profile names from claimed conn3ct profiles; wallets without one show as the wallet. Updates itself every 5 minutes."], []];
  out.push(["by collector"]);
  out.push(["profile", "wallet", "entered", "claims", "entries on the wheel", "claims still pending", "entries still pending", "sends committed", "sends arrived"]);
  var detail = [["detail"], ["profile", "wallet", "role", "tokens", "put in", "rule", "earns once everything arrives", "of", "arrived (burn / vault)", "transactions"]];
  var tot = [0, 0, 0, 0, 0, 0];
  entries.forEach(function (e) {
    var items = moves(e.p), sent = {};
    items.forEach(function (it) { var k = it.key + ">" + it.dest; sent[k] = sent[k] || { sent: 0, txs: [] }; });
    transfers.forEach(function (t) { var k = t.key + ">" + byDest[t.to]; if (sent[k] && t.from === e.w) { sent[k].sent += t.amount; if (sent[k].txs.indexOf(t.tx) < 0) sent[k].txs.push(t.tx); } });
    var c = confirmedClaims(cfg, e.p, sent);
    var committed = items.reduce(function (a, it) { return a + it.qty; }, 0);
    var arrived = Object.keys(c.arrived).reduce(function (a, k) { return a + c.arrived[k]; }, 0);
    out.push([who(e.w), e.w, when_(e.at), c.claims, c.entries, c.pending, c.pendingEntries, committed, arrived]);
    tot = [tot[0] + c.claims, tot[1] + c.entries, tot[2] + c.pending, tot[3] + c.pendingEntries, tot[4] + committed, tot[5] + arrived];
    outcome(cfg, e.p).lines.forEach(function (l) {
      var dest = l.role === "burn" ? "333burn" : l.role === "vault" ? "3vault" : null;
      var arr = dest ? l.keys.reduce(function (a, k) { return a + (c.arrived[k + ">" + dest] || 0); }, 0) : "";
      var txs = dest ? l.keys.map(function (k) { return (sent[k + ">" + dest] || { txs: [] }).txs.join(" "); }).filter(Boolean).join(" ") : "";
      detail.push([who(e.w), e.w, { hold: "holder", burn: "burn", vault: "vault", cite: "cite" }[l.role],
        (l.label ? l.label + ": " : "") + l.keys.map(nm).join(" | "), l.role === "cite" ? l.keys.length : l.in, l.rule, l.out, l.unit, arr, txs]);
    });
  });
  out.push(["TOTAL", entries.length + " entries", "", tot[0], tot[1], tot[2], tot[3], tot[4], tot[5]]);
  out.push([]);
  out = out.concat(detail);

  // Snapshot: who held the holder pieces at the snapshot, and how much of it they claimed with.
  if (usesSnapshot(cfg)) {
    out.push([]);
    var snap = d.snapshot(cfg.snapshot.tab);
    if (!snap) out.push(["snapshot: not taken yet (it's taken 10 minutes before the 3v3nt opens, " + when_(cfg.snapshot.at) + ")"]);
    else {
      var pool = {}; roleKeys(cfg, "hold").forEach(function (k) { pool[k] = 1; });
      var held = {};
      snap.forEach(function (r) { var k = r[0] + ":" + r[1], n = Number(r[3]) || 0; if (pool[k] && n > 0) { var w = lc(r[2]); (held[w] = held[w] || {})[k] = n; } });
      var claimed = {}; entries.forEach(function (e) { claimed[e.w] = {}; e.p.hold.forEach(function (x) { claimed[e.w][x.key] = x.qty; }); });
      out.push(["snapshot: holder pieces held as of " + when_(cfg.snapshot.at) + " (ledger tab " + cfg.snapshot.tab + ")"]);
      out.push(["profile", "wallet", "pieces held", "editions held", "claimed with", "entered"]);
      Object.keys(held).sort(function (a, b) { return who(a).toLowerCase() < who(b).toLowerCase() ? -1 : 1; }).forEach(function (w) {
        var h = held[w], cl = claimed[w] || {};
        out.push([who(w), w, Object.keys(h).map(function (k) { return nm(k) + (h[k] > 1 ? " ×" + h[k] : ""); }).join(" | "),
          Object.keys(h).reduce(function (a, k) { return a + h[k]; }, 0),
          Object.keys(cl).map(function (k) { return nm(k) + " ×" + cl[k]; }).join(" | "), claimed[w] ? "yes" : "no"]);
      });
    }
  }
  return out;
}
