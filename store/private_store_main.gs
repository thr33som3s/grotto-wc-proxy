// thr33som3s private store. Apps Script bound to the private Google Sheet.
// The proxy (grotto-wc-proxy on Vercel) is the only caller: every request must carry the shared
// secret stored in this script's properties as STORE_SECRET. Wallet signatures are checked by the
// proxy before it calls here; this script stores what the proxy has already verified.
//
// Tabs (created automatically on first use):
//   connections : every wallet that connects, guest or player
//   profiles    : one row per wallet; profile fields kept as JSON so the profile design can change
//   commitments : one row per wallet per phase; a second entry for the same phase is refused
//   allowlist   : thr33s's list of known collectors (wallet, username): prefilled and reserved names

const TABS = {
  connections: ['time', 'wallet', 'mode', 'page', 'user_agent'],
  profiles: ['wallet', 'created_at', 'updated_at', 'profile_json', 'signature', 'message'],
  commitments: ['phase', 'wallet', 'submitted_at', 'payload_json', 'signature', 'message', 'username'],
  allowlist: ['wallet', 'username'],   // filled in by thr33s: prepared profiles and reserved names
};

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad json' }); }
  const secret = PropertiesService.getScriptProperties().getProperty('STORE_SECRET');
  if (!secret || req.secret !== secret) return out({ ok: false, error: 'unauthorized' });
  try {
    switch (req.action) {
      case 'log_connection': return out(logConnection(req));
      case 'get_profile': return out(getProfile(req.wallet));
      case 'put_profile': return out(putProfile(req));
      case 'get_commitment': return out(getCommitment(req.phase, req.wallet));
      case 'put_commitment': return out(putCommitment(req));
      case 'list_commitments': return out(listCommitments(req.phase));
      case 'list_profiles': return out(listProfiles());
      case 'get_allowlist': return out(getAllowlist());
      case 'put_event': case 'get_event': case 'list_events': return out(handleEvents_(req));   // build3r 3v3nts (file events_addition)
      default: return out({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

function out(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function now() { return new Date().toISOString(); }
const lc = (w) => String(w || '').toLowerCase();

function tab(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(TABS[name]); sh.setFrozenRows(1); }
  return sh;
}
function rows(name) {
  const v = tab(name).getDataRange().getValues();
  const head = v[0];
  return v.slice(1).map((r, i) => ({ row: i + 2, ...Object.fromEntries(head.map((h, j) => [h, r[j]])) }));
}

function logConnection(req) {
  tab('connections').appendRow([now(), lc(req.wallet), req.mode || '', req.page || '', String(req.userAgent || '').slice(0, 300)]);
  return { ok: true };
}

function getProfile(wallet) {
  const p = rows('profiles').find((r) => r.wallet === lc(wallet));
  return { ok: true, profile: p ? { wallet: p.wallet, created_at: p.created_at, updated_at: p.updated_at, ...JSON.parse(p.profile_json || '{}') } : null };
}

// Creates a profile, or updates it when the proxy allows edits (req.allowUpdate).
function putProfile(req) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const w = lc(req.wallet);
    const existing = rows('profiles').find((r) => r.wallet === w);
    const json = JSON.stringify(req.profile || {});
    if (existing) {
      if (!req.allowUpdate) return { ok: false, error: 'profile exists' };
      tab('profiles').getRange(existing.row, 3, 1, 4).setValues([[now(), json, req.signature || '', req.message || '']]);
      return { ok: true, updated: true };
    }
    tab('profiles').appendRow([w, now(), now(), json, req.signature || '', req.message || '']);
    return { ok: true, created: true };
  } finally { lock.releaseLock(); }
}

function getCommitment(phase, wallet) {
  const c = rows('commitments').find((r) => r.phase === phase && r.wallet === lc(wallet));
  return { ok: true, commitment: c ? { phase: c.phase, wallet: c.wallet, submitted_at: c.submitted_at, payload: JSON.parse(c.payload_json || 'null') } : null };
}

// One entry per wallet per phase, final. The lock makes two simultaneous submissions impossible.
function putCommitment(req) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const w = lc(req.wallet);
    const all = rows('commitments');
    if (all.some((r) => r.phase === req.phase && r.wallet === w)) return { ok: false, error: 'already submitted' };
    // build3r pay option, first come first served: the total is checked here, inside the lock, so two entries
    // signed at the same moment can't both take the last paid editions.
    if (req.payCap !== undefined && req.payCap !== null) {
      const taken = all.filter((r) => r.phase === req.phase).reduce((a, r) => a + (Number((JSON.parse(r.payload_json || '{}') || {}).pay) || 0), 0);
      const want = Number((req.payload || {}).pay) || 0;
      if (taken + want > Number(req.payCap)) return { ok: false, error: 'pay sold out', left: Math.max(0, Number(req.payCap) - taken) };
    }
    const at = now();
    tab('commitments').appendRow([req.phase, w, at, JSON.stringify(req.payload), req.signature || '', req.message || '', req.username || '']);
    // Sorted views (one row per candidate per race, per placement, per insert), sent by the server.
    writeIndex(req.index, at);
    return { ok: true, submitted_at: at };
  } finally { lock.releaseLock(); }
}

// For the tally and confirmations, after a phase's commitment window has closed (the proxy checks the time).
function listCommitments(phase) {
  return { ok: true, commitments: rows('commitments').filter((r) => r.phase === phase).map((r) => ({ wallet: r.wallet, submitted_at: r.submitted_at, payload: JSON.parse(r.payload_json || 'null') })) };
}

// Wallet and username only: no emails or pictures leave the sheet this way.
function listProfiles() {
  return { ok: true, profiles: rows('profiles').map((r) => ({ wallet: r.wallet, username: (JSON.parse(r.profile_json || '{}').username) || '' })) };
}
function getAllowlist() {
  return { ok: true, allowlist: rows('allowlist').filter((r) => r.wallet).map((r) => ({ wallet: lc(r.wallet), username: String(r.username || '').trim() })) };
}

// ── Sorted views ─────────────────────────────────────────────────
// index: [{ tab, header: [...], rows: [[...], ...], sortBy: [column numbers, 1-based] }].
// Each tab is created with its header on first use, rows are appended (plus the submitted time),
// and the tab is re-sorted so it always reads in order (e.g. by race, then candidate).
function writeIndex(index, at) {
  if (!Array.isArray(index)) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  index.forEach(function (ix) {
    if (!ix || !ix.tab || !Array.isArray(ix.rows) || !ix.rows.length) return;
    var sh = ss.getSheetByName(ix.tab);
    if (!sh) { sh = ss.insertSheet(ix.tab); sh.appendRow(ix.header.concat(['submitted_at'])); sh.setFrozenRows(1); }
    var rows = ix.rows.map(function (r) { return r.concat([at]); });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    if (sh.getLastRow() > 2 && Array.isArray(ix.sortBy)) {
      sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).sort(ix.sortBy.map(function (c) { return { column: c, ascending: true }; }));
    }
  });
}

// ── Candidacy burns (refreshed every 5 minutes by a timer) ───────
// One row per committed candidate: who ran it where, and whether the ledger shows it burned to 333burn
// inside the confirmation window (Thu Oct 29, 12:01am – 11:59pm EDT), with the transaction and time.
// Reads the public ledger sheet; writes only this store's "candidacy burns" tab.
var LEDGER_SHEET = '1vDH6lXF_xegq8pWzGdDgHJPwnmpmoDXZoMaWj967UtM';
var BURN_WALLET = '0x3d373231a0a60bb6203fd1a91e3f058100c2244d';
var CANDIDACY_CONFIRM = ['2026-10-29T04:01:00Z', '2026-10-30T03:59:59Z'];

function refreshCandidacyBurns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var from = Date.parse(CANDIDACY_CONFIRM[0]), to = Date.parse(CANDIDACY_CONFIRM[1]);
  // transfers to 333burn: collection, token id, from, amount, time, tx
  var q = encodeURIComponent("select B, D, E, G, J, K where F = '" + BURN_WALLET + "'");
  var url = 'https://docs.google.com/spreadsheets/d/' + LEDGER_SHEET + '/gviz/tq?tqx=out:csv&sheet=transfers&tq=' + q;
  var rows = Utilities.parseCsv(UrlFetchApp.fetch(url).getContentText()).slice(1);
  var burned = {};
  rows.forEach(function (r) {
    var at = Date.parse(r[4]);
    if (!(at >= from && at <= to)) return;
    var k = String(r[2]).toLowerCase() + '|' + r[0] + ':' + String(r[1]).replace(/[^0-9]/g, '');
    if (!burned[k]) burned[k] = { tx: r[5], time: r[4] };
  });
  var cand = ss.getSheetByName('candidacies');
  if (!cand) return;
  var data = cand.getDataRange().getValues();
  var head = data[0], idx = function (n) { return head.indexOf(n); };
  var out = data.slice(1).filter(function (r) { return r[idx('race')]; }).map(function (r) {
    var b = burned[String(r[idx('wallet')]).toLowerCase() + '|' + r[idx('token')]];
    return [r[idx('race')], r[idx('state')], r[idx('candidate')], r[idx('token')], r[idx('collector')], r[idx('wallet')],
            b ? 'burned' : (Date.now() > to ? 'not burned: does not run' : 'not yet burned'), b ? b.tx : '', b ? b.time : ''];
  });
  var sh = ss.getSheetByName('candidacy burns') || ss.insertSheet('candidacy burns');
  sh.clearContents();
  sh.getRange(1, 1, 1, 9).setValues([['race', 'state', 'candidate', 'token', 'collector', 'wallet', 'status', 'tx', 'burned_at']]);
  if (out.length) sh.getRange(2, 1, out.length, 9).setValues(out);
  sh.setFrozenRows(1);
}

// Run once by hand: refreshes the tab now, then every 5 minutes.
function setupCandidacyBurnsTimer() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'refreshCandidacyBurns') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshCandidacyBurns').timeBased().everyMinutes(5).create();
  refreshCandidacyBurns();
}
