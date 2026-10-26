// Ledger runner for GitHub Actions.
// First run (no state): backfills every transfer of the six contracts from block 0.
// Later runs: check both chains for events since the last processed block. Nothing new -> exit.
// Something new -> write it, rebuild holdings and supply, then keep checking every minute
// until 15 minutes pass with no further changes.
import crypto from "node:crypto";
import { CONTRACTS, CHAINS, TRANSFER_HEADER, HOLDINGS_HEADER, SUPPLY_HEADER, rowsFromTransfer, derive } from "./core.mjs";

const SHEET = process.env.LEDGER_SHEET_ID;
const ALCHEMY = process.env.ALCHEMY_API_KEY;
const SA = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || "{}");
const REBUILD = process.env.REBUILD === "true";
const BURST_QUIET_MS = 15 * 60 * 1000;
const BURST_INTERVAL_MS = 60 * 1000;
const MAX_RUN_MS = 50 * 60 * 1000; // stay under the workflow's timeout

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Google Sheets (service account) ----------
let token = null, tokenExp = 0;
async function gtoken() {
  if (token && Date.now() < tokenExp - 60000) return token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: SA.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(SA.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }) });
  if (!r.ok) throw new Error(`Google auth failed: ${r.status}`);
  const j = await r.json(); token = j.access_token; tokenExp = Date.now() + j.expires_in * 1000;
  return token;
}
const S = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`;
async function sheets(path, opts = {}) {
  const r = await fetch(S + path, { ...opts, headers: { Authorization: `Bearer ${await gtoken()}`, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`Sheets ${opts.method || "GET"} ${path.split("?")[0]} failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
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
  const r = await fetch(`https://${CHAINS[chain].alchemy}.g.alchemy.com/v2/${ALCHEMY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }) });
  if (!r.ok) throw new Error(`Alchemy ${chain} ${method}: HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`Alchemy ${chain} ${method}: ${j.error.message}`);
  return j.result;
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

async function main() {
  if (!SHEET || !ALCHEMY || !SA.client_email) throw new Error("LEDGER_SHEET_ID, ALCHEMY_API_KEY and GOOGLE_SERVICE_ACCOUNT must be set");
  const started = Date.now();
  let state = REBUILD ? {} : await readState();
  if (!Object.keys(state).length) {
    log("no state: full backfill from block 0");
    await writeTab("transfers", [TRANSFER_HEADER]);
  }
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
