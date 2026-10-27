// Reads the ledger sheet (written every 5 minutes by the GitHub Actions ledger job).
// Editions, holders and wallet balances all come from here, never from the chain on a page view.

export const LEDGER_SHEET = "1vDH6lXF_xegq8pWzGdDgHJPwnmpmoDXZoMaWj967UtM";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

// Warm serverless instances reuse this for 2 minutes, so bursts of requests read the sheet once.
const memo = new Map();
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
