// Reads the ledger sheet (written every 5 minutes by the GitHub Actions ledger job).
// Editions, holders and wallet balances all come from here, never from the chain on a page view.

export const LEDGER_SHEET = "1vDH6lXF_xegq8pWzGdDgHJPwnmpmoDXZoMaWj967UtM";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

// Warm serverless instances reuse this for 2 minutes, so bursts of requests read the sheet once.
const memo = new Map();
export const resetLedgerMemo = () => memo.clear(); // for tests
async function tab(name, cols, key) {
  const hit = memo.get(name);
  if (hit && Date.now() - hit.at < 120000) return hit.rows;
  const r = await fetch(`${API}/${LEDGER_SHEET}/values/${encodeURIComponent(`${name}!A:${cols}`)}?key=${key}`);
  if (!r.ok) throw new Error(`ledger ${name}: Sheets API ${r.status}`);
  const rows = ((await r.json()).values || []).slice(1);
  memo.set(name, { at: Date.now(), rows });
  return rows;
}

export const tokenKey = (coll, id) => `${coll}:${id}`;

// key -> { minted, burned, circulating, holders }
export async function readSupply(key) {
  const out = new Map();
  for (const [coll, id, minted, burned, circ, holders] of await tab("supply", "F", key))
    out.set(tokenKey(coll, id), { minted: +minted, burned: +burned, circulating: +circ, holders: +holders });
  return out;
}

// [{ key, coll, id, wallet, balance }]
export async function readHoldings(key) {
  return (await tab("holdings", "D", key)).map(([coll, id, wallet, balance]) => ({ key: tokenKey(coll, id), coll, id, wallet, balance: +balance }));
}

export async function readState(key) {
  return Object.fromEntries((await tab("state", "E", key)).map(([chain, lastBlock, lastChangeAt, lastRunAt]) => [chain, { lastBlock: +lastBlock, lastChangeAt, lastRunAt }]));
}

export const isAddress = (w) => /^0x[0-9a-fA-F]{40}$/.test(w || "");

// Images read from contracts' on-chain metadata by the "images" job: key -> { image, cached }.
// Empty until the job has run; callers fall back to the sheet's own image.
export async function readImages(key) {
  try {
    const out = new Map();
    for (const [coll, id, image, cached] of await tab("images", "E", key)) out.set(tokenKey(coll, id), { image: image || "", cached: cached || "" });
    return out;
  } catch { return new Map(); }
}

// Every transfer the ledger has recorded: { chain, coll, id, key, from, to, amount, type, block, time, tx }.
export async function readTransfers(key) {
  return (await tab("transfers", "L", key)).map(([chain, coll, , id, from, to, amount, type, block, time, tx]) =>
    ({ chain, coll, id, key: tokenKey(coll, id), from, to, amount: +amount, type, block: +block, time, tx }));
}

// US Senate calls written by the us-results job; thr33s's override column wins when filled.
export async function readUsResults(key) {
  try {
    const out = {};
    for (const [race, called, winner, party, color, source, updated, override] of await tab("us-results", "H", key)) {
      if (!race) continue;
      const o = String(override || "").trim().toLowerCase();
      out[race] = o ? { called: true, color: ["red", "blue", "purple"].includes(o) ? o : "", winner: "", party: o, source: "thr33s", updated }
                    : { called: called === "yes", color: color || "", winner: winner || "", party: party || "", source: source || "", updated };
    }
    return out;
  } catch { return {}; }
}

// A frozen copy of the holdings tab, taken for one 3v3nt (e.g. "snapshot-f13"). Same columns as holdings.
export async function readSnapshot(name, key) {
  return (await tab(name, "D", key)).map(([coll, id, wallet, balance]) => ({ key: tokenKey(coll, id), coll, id, wallet: String(wallet).toLowerCase(), balance: +balance }));
}

// Pending mints (tab "pending": collection, token_id, wallet, owed, minted, remaining, source, since): editions owed
// that haven't been minted to the wallet yet. The ledger job counts "remaining" down as mints arrive. [] if no tab.
export async function readPending(key) {
  try {
    return (await tab("pending", "H", key)).filter((r) => r[0] && r[1] && r[2]).map(([coll, id, wallet, owed, minted, remaining, source]) => {
      const o = +owed || 0, rem = remaining === undefined || remaining === "" ? o : +remaining;
      return { key: tokenKey(coll, id), coll, id: String(id), wallet: String(wallet).toLowerCase(), owed: o, remaining: Math.max(0, rem || 0), source: source || "" };
    });
  } catch { return []; }
}
// key -> { pending, collectors }, counting only what's still pending.
export function pendingByToken(rows) {
  const out = new Map();
  for (const r of rows) { if (r.remaining <= 0) continue; const e = out.get(r.key) || { pending: 0, collectors: new Set() }; e.pending += r.remaining; e.collectors.add(r.wallet); out.set(r.key, e); }
  return new Map([...out].map(([k, e]) => [k, { pending: e.pending, collectors: e.collectors.size }]));
}

// Snapshot requests and their status (tab "snapshots": tab, at, status, taken_at, rows), written by the store
// when thr33s saves a 3v3nt and completed by the ledger job. Missing tab -> no requests yet.
export async function readSnapshotRequests(key) {
  try { return new Map((await tab("snapshots", "E", key)).map(([t, at, status, takenAt, rows]) => [t, { at, status: status || "pending", takenAt: takenAt || "", rows: +rows || 0 }])); }
  catch { return new Map(); }
}
