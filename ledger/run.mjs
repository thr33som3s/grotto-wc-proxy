// Ledger runner for GitHub Actions.
// First run (no state): backfills every transfer of the six contracts from block 0.
// Later runs: check both chains for events since the last processed block. Nothing new -> exit.
// Something new -> write it, rebuild holdings and supply, then keep checking every minute
// until 15 minutes pass with no further changes.
import { CONTRACTS, CHAINS, TRANSFER_HEADER, HOLDINGS_HEADER, SUPPLY_HEADER, rowsFromTransfer, derive } from "./core.mjs";

const SHEET = process.env.LEDGER_SHEET_ID;
const ALCHEMY = process.env.ALCHEMY_API_KEY;
// Google access comes from GitHub's keyless login (Workload Identity Federation): the workflow
// exchanges GitHub's identity for a short-lived token. No service account key exists anywhere.
const ACCESS_TOKEN = process.env.GOOGLE_ACCESS_TOKEN;
const REBUILD = process.env.REBUILD === "true";
const BURST_QUIET_MS = 15 * 60 * 1000;
const BURST_INTERVAL_MS = 60 * 1000;
const MAX_RUN_MS = 50 * 60 * 1000; // stay under the workflow's timeout

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Google Sheets ----------
const gtoken = async () => ACCESS_TOKEN;
const S = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`;
// Google and Alchemy both have brief outages; retry 5xx and rate limits with backoff before giving up.
async function withRetry(label, fn) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (!e.retryable || attempt >= 4) throw e;
      const wait = 5000 * 2 ** (attempt - 1);
      log(`${label}: ${e.message}; retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}
const httpError = (msg, status) => Object.assign(new Error(msg), { retryable: status === 429 || status >= 500 });
async function sheets(path, opts = {}) {
  return withRetry("sheets", async () => {
    const r = await fetch(S + path, { ...opts, headers: { Authorization: `Bearer ${await gtoken()}`, "Content-Type": "application/json" } });
    if (!r.ok) throw httpError(`Sheets ${opts.method || "GET"} ${path.split("?")[0]} failed: ${r.status} ${(await r.text()).slice(0, 200)}`, r.status);
    return r.json();
  });
}
const rng = (a) => encodeURIComponent(a);
const readTab = async (tab, cols) => ((await sheets(`/values/${rng(`${tab}!A:${cols}`)}`)).values || []);
const clearTab = (tab) => sheets(`/values/${rng(`${tab}!A:Z`)}:clear`, { method: "POST", body: "{}" });
async function writeTab(tab, rows) {
  await clearTab(tab);
  for (let i = 0; i < rows.length; i += 20000) {
    const chunk = rows.slice(i, i + 20000);
    await sheets(`/values/${rng(`${tab}!A${i + 1}`)}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: chunk }) });
  }
}
async function appendTab(tab, rows) {
  for (let i = 0; i < rows.length; i += 20000)
    await sheets(`/values/${rng(`${tab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values: rows.slice(i, i + 20000) }) });
}

// ---------- Alchemy ----------
async function alchemy(chain, method, params) {
  return withRetry("alchemy", async () => {
    const r = await fetch(`https://${CHAINS[chain].alchemy}.g.alchemy.com/v2/${ALCHEMY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }) });
    if (!r.ok) throw httpError(`Alchemy ${chain} ${method}: HTTP ${r.status}`, r.status);
    const j = await r.json();
    if (j.error) throw httpError(`Alchemy ${chain} ${method}: ${j.error.message}`, 500);
    return j.result;
  });
}
// Events from fromBlock to toBlock (inclusive) for this chain's contracts, oldest first.
async function transfers(chain, fromBlock, toBlock) {
  const addrs = CONTRACTS.filter((c) => c.chain === chain).map((c) => c.address);
  const out = [];
  let pageKey;
  do {
    const res = await alchemy(chain, "alchemy_getAssetTransfers", [{
      fromBlock: "0x" + fromBlock.toString(16), toBlock: "0x" + toBlock.toString(16), contractAddresses: addrs,
      category: ["erc721", "erc1155"], order: "asc", withMetadata: true, excludeZeroValue: false, maxCount: "0x3e8", ...(pageKey ? { pageKey } : {}),
    }]);
    for (const t of res.transfers) out.push(...rowsFromTransfer(chain, t));
    pageKey = res.pageKey;
  } while (pageKey);
  return out;
}

// ---------- state ----------
const STATE_HEADER = ["chain", "last_block", "last_change_at", "last_run_at", "events_total"];
async function readState() {
  const rows = (await readTab("state", "E")).slice(1);
  return Object.fromEntries(rows.filter((r) => r[0]).map((r) => [r[0], { lastBlock: Number(r[1]), lastChangeAt: r[2] || "", eventsTotal: Number(r[4] || 0) }]));
}
const writeState = (st) => writeTab("state", [STATE_HEADER, ...Object.entries(st).map(([c, s]) => [c, s.lastBlock, s.lastChangeAt, new Date().toISOString(), s.eventsTotal])]);

async function rebuildDerived() {
  const rows = (await readTab("transfers", "L")).slice(1);
  const { holdings, supply } = derive(rows);
  await writeTab("holdings", [HOLDINGS_HEADER, ...holdings]);
  await writeTab("supply", [SUPPLY_HEADER, ...supply]);
  log(`holdings ${holdings.length} rows, supply ${supply.length} tokens`);
}

// One pass over both chains. Returns the number of new events written.
async function check(state) {
  let added = 0;
  for (const chain of Object.keys(CHAINS)) {
    const head = Number(BigInt(await alchemy(chain, "eth_blockNumber", [])));
    const safe = head - CHAINS[chain].confirmations; // skip blocks that could still reorganize
    const st = state[chain] || { lastBlock: -1, lastChangeAt: "", eventsTotal: 0 };
    if (safe <= st.lastBlock) { state[chain] = st; continue; }
    const rows = await transfers(chain, st.lastBlock + 1, safe);
    if (rows.length) { await appendTab("transfers", rows); st.lastChangeAt = new Date().toISOString(); st.eventsTotal += rows.length; added += rows.length; }
    st.lastBlock = safe;
    state[chain] = st;
    log(`${chain}: blocks to ${safe}, ${rows.length} new events`);
  }
  if (added) await rebuildDerived();
  await writeState(state);
  return added;
}

// If a run failed after appending events but before saving its state, the next run would fetch
// those blocks again and double-count them. Drop any rows past each chain's saved block first.
async function repairPastState(state) {
  const all = await readTab("transfers", "L");
  if (all.length <= 1) return;
  const [head, ...rows] = all;
  const keep = rows.filter((r) => { const st = state[r[0]]; return !st || Number(r[8]) <= st.lastBlock; });
  if (keep.length === rows.length) return;
  log(`repair: removing ${rows.length - keep.length} rows recorded past the saved state`);
  await writeTab("transfers", [head, ...keep]);
  await rebuildDerived();
}

async function main() {
  const missing = [!SHEET && "LEDGER_SHEET_ID", !ALCHEMY && "ALCHEMY_API_KEY (repository secret)", !ACCESS_TOKEN && "Google access token (from the sign-in step)"].filter(Boolean);
  if (missing.length) throw new Error(`Missing: ${missing.join(", ")}`);
  const started = Date.now();
  let state = REBUILD ? {} : await readState();
  if (!Object.keys(state).length) {
    log("no state: full backfill from block 0");
    await writeTab("transfers", [TRANSFER_HEADER]);
  }
  if (Object.keys(state).length) await repairPastState(state);
  let added = await check(state);
  if (!added) { log("no new events"); return; }
  // Burst: keep checking every minute until 15 quiet minutes.
  let lastChange = Date.now();
  while (Date.now() - lastChange < BURST_QUIET_MS && Date.now() - started < MAX_RUN_MS) {
    await sleep(BURST_INTERVAL_MS);
    added = await check(state);
    if (added) lastChange = Date.now();
  }
  log("burst over");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
