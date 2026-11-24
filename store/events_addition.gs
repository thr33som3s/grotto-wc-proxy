// ── 3v3nts from build3r: saved configs ───────────────────────────
// A second file in the private store's Apps Script project (next to the main script). Keeps one row per 3v3nt in
// a tab named "events": id, status, config (JSON), updated_at, by. Saving the same id replaces its row.
// doPost sends the three event actions here with one line in its switch:
//     case 'put_event': case 'get_event': case 'list_events': return out(handleEvents_(req));
// After saving: run authorizeEventsOnce from the editor once (it asks Google for access to the ledger sheet),
// then Deploy → Manage deployments → edit → New version → Deploy.
function handleEvents_(body) {
  const a = body.action;
  if (a !== "put_event" && a !== "get_event" && a !== "list_events") return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName("events");
  if (!sh) { sh = ss.insertSheet("events"); sh.appendRow(["id", "status", "config", "updated_at", "by"]); }
  sh.getRange("A:E").setNumberFormat("@");
  const rows = sh.getDataRange().getValues().slice(1);
  const asEvent = (r) => ({ id: String(r[0]), status: String(r[1]), config: String(r[2]), updated_at: r[3] instanceof Date ? r[3].toISOString() : String(r[3]), by: String(r[4]) });
  if (a === "list_events") return { ok: true, events: rows.filter((r) => r[0]).map(asEvent) };
  const id = String(body.id || "");
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) return { ok: false, error: "bad id" };
  const i = rows.findIndex((r) => String(r[0]) === id);
  if (a === "get_event") return { ok: true, event: i >= 0 ? asEvent(rows[i]) : null };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const now = new Date().toISOString();
    const row = [id, String(body.status || "draft"), String(body.config || ""), now, String(body.by || "")];
    if (i >= 0) sh.getRange(i + 2, 1, 1, 5).setValues([row]); else sh.appendRow(row);
    requestSnapshot_(body.config);
    return { ok: true, updated_at: now };
  } finally { lock.releaseLock(); }
}

// A 3v3nt whose holders count at a snapshot gets a request in the ledger sheet's "snapshots" tab. The ledger job
// (GitHub Actions) takes it once its time has passed: holdings rebuilt from the transfers as of that exact second,
// into a tab named "snapshot-<id>". A snapshot already taken is never changed.
const LEDGER_SHEET_ID = "1vDH6lXF_xegq8pWzGdDgHJPwnmpmoDXZoMaWj967UtM";
function requestSnapshot_(configJson) {
  let c; try { c = JSON.parse(configJson); } catch (e) { return; }
  const usesSnapshot = (c.tokens || []).some((t) => t.role === "hold") && c.roles && c.roles.hold && c.roles.hold.count === "snapshot";
  if (!usesSnapshot || !c.snapshot || !c.snapshot.tab || !c.snapshot.at) return;
  const ss = SpreadsheetApp.openById(LEDGER_SHEET_ID);
  let sh = ss.getSheetByName("snapshots");
  if (!sh) { sh = ss.insertSheet("snapshots"); sh.appendRow(["tab", "at", "status", "taken_at", "rows"]); }
  sh.getRange("A:D").setNumberFormat("@");   // keep times as the exact text written, never converted to dates
  const rows = sh.getDataRange().getValues().slice(1);
  const i = rows.findIndex((r) => String(r[0]) === c.snapshot.tab);
  if (i >= 0 && String(rows[i][2]) === "taken") return;
  const row = [c.snapshot.tab, c.snapshot.at, "pending", "", ""];
  if (i >= 0) sh.getRange(i + 2, 1, 1, 5).setValues([row]); else sh.appendRow(row);
}

// Run once by hand after adding this file: Google asks to allow access to the ledger sheet (for snapshot
// requests) and the events tab is created. Changes nothing else.
function authorizeEventsOnce() {
  SpreadsheetApp.openById(LEDGER_SHEET_ID).getName();
  handleEvents_({ action: "list_events" });
}
