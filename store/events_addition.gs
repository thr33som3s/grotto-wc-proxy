// ── 3v3nts from build3r: saved configs ───────────────────────────
// Addition to the private store's Apps Script (grotto_private_store.gs). Keeps one row per 3v3nt in a tab
// named "events": id, status, config (JSON), updated_at, by. Saving the same id replaces its row.
// In doPost, after the secret has been checked and the body parsed, add:
//     const ev = handleEvents_(body);
//     if (ev) return ContentService.createTextOutput(JSON.stringify(ev)).setMimeType(ContentService.MimeType.JSON);
function handleEvents_(body) {
  const a = body.action;
  if (a !== "put_event" && a !== "get_event" && a !== "list_events") return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName("events");
  if (!sh) { sh = ss.insertSheet("events"); sh.appendRow(["id", "status", "config", "updated_at", "by"]); }
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
    return { ok: true, updated_at: now };
  } finally { lock.releaseLock(); }
}
