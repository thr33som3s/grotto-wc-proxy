// Pure ledger logic: turns transfer events into holdings and supply. No network calls here.

export const BURN_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);
export const ZERO = "0x0000000000000000000000000000000000000000";

// The six collections, in thr33s's canonical order.
export const CONTRACTS = [
  { key: "univ3rs3", chain: "ethereum", address: "0xb20b9fb2657bc527cc8a5cb707071095113cab3b" },
  { key: "bulk", chain: "base", address: "0x2e199bc11fa4c8918792da731328412eed861ab2" },
  { key: "thr33zi3s", chain: "ethereum", address: "0xdee1996336fcabb458c2b92fce19cf84eb587e64" },
  { key: "gen2", chain: "ethereum", address: "0x8c6ebfc76199f379e706af27ad68f5340cc5b4e2" },
  { key: "gen3", chain: "ethereum", address: "0xfdc33f1417086244e35096ff3bdf6192bd6f9f0b" },
  { key: "guest", chain: "ethereum", address: "0xac49356040d92ddfc37fba0385f6455d6ce1b6f6" },
];
export const CHAINS = {
  ethereum: { alchemy: "eth-mainnet", confirmations: 12 },
  base: { alchemy: "base-mainnet", confirmations: 30 },
};
export const byAddress = new Map(CONTRACTS.map((c) => [c.address, c]));

const dec = (hex) => (hex === undefined || hex === null ? "" : BigInt(hex).toString());

// One Alchemy getAssetTransfers result -> one row per token moved.
// ERC-1155 batch transfers carry several tokens; each becomes its own row.
export function rowsFromTransfer(chain, t) {
  const contract = (t.rawContract?.address || "").toLowerCase();
  const coll = byAddress.get(contract);
  if (!coll) return [];
  const from = (t.from || ZERO).toLowerCase();
  const to = (t.to || ZERO).toLowerCase();
  const type = from === ZERO ? "mint" : BURN_ADDRESSES.has(to) ? "burn" : "transfer";
  const block = Number(BigInt(t.blockNum));
  const time = t.metadata?.blockTimestamp || "";
  const items = t.erc1155Metadata?.length
    ? t.erc1155Metadata.map((m) => ({ id: dec(m.tokenId), amount: dec(m.value) }))
    : [{ id: dec(t.erc721TokenId ?? t.tokenId), amount: "1" }];
  return items.map((it, i) => [chain, coll.key, contract, it.id, from, to, it.amount, type, block, time, t.hash, `${t.uniqueId || t.hash}:${i}`]);
}

export const TRANSFER_HEADER = ["chain", "collection", "contract", "token_id", "from", "to", "amount", "type", "block", "time", "tx", "event_id"];
export const HOLDINGS_HEADER = ["collection", "token_id", "wallet", "balance"];
export const SUPPLY_HEADER = ["collection", "token_id", "minted", "burned", "circulating", "holders"];

const order = Object.fromEntries(CONTRACTS.map((c, i) => [c.key, i]));
const cmpToken = (a, b) => order[a[0]] - order[b[0]] || (BigInt(a[1]) < BigInt(b[1]) ? -1 : BigInt(a[1]) > BigInt(b[1]) ? 1 : 0);

// All transfer rows -> holdings (wallets holding > 0, burn addresses excluded) and supply per token.
export function derive(rows) {
  const bal = new Map(); // coll|id|wallet -> BigInt
  const sup = new Map(); // coll|id -> {minted, burned}
  for (const r of rows) {
    const [, coll, , id, from, to, amountStr, type] = r;
    const amount = BigInt(amountStr || "0");
    const tk = `${coll}|${id}`;
    if (!sup.has(tk)) sup.set(tk, { minted: 0n, burned: 0n });
    const s = sup.get(tk);
    if (type === "mint") s.minted += amount;
    if (type === "burn") s.burned += amount;
    if (from !== ZERO) bal.set(`${tk}|${from}`, (bal.get(`${tk}|${from}`) || 0n) - amount);
    if (!BURN_ADDRESSES.has(to)) bal.set(`${tk}|${to}`, (bal.get(`${tk}|${to}`) || 0n) + amount);
  }
  const holdings = [];
  const holders = new Map();
  for (const [k, v] of bal) {
    if (v <= 0n) continue;
    const [coll, id, wallet] = k.split("|");
    holdings.push([coll, id, wallet, v.toString()]);
    holders.set(`${coll}|${id}`, (holders.get(`${coll}|${id}`) || 0) + 1);
  }
  holdings.sort((a, b) => cmpToken(a, b) || (BigInt(b[3]) > BigInt(a[3]) ? 1 : -1));
  const supply = [...sup].map(([k, s]) => { const [coll, id] = k.split("|"); return [coll, id, s.minted.toString(), s.burned.toString(), (s.minted - s.burned).toString(), holders.get(k) || 0]; });
  supply.sort(cmpToken);
  return { holdings, supply };
}

// Pending mints (ledger tab "pending": collection, token_id, wallet, owed, minted, remaining, source, since).
// Editions owed to a wallet for a token that hasn't been minted to them yet. Only mints count them down:
// a transfer of type "mint" (from the zero address) of that token, to that wallet, at or after `since`.
// Any other transfer leaves pending alone. Several rows for one wallet and token are filled in row order.
export const PENDING_HEADER = ["collection", "token_id", "wallet", "owed", "minted", "remaining", "source", "since"];
export function pendingProgress(pending, transferRows) {
  const mints = new Map();   // "coll:id|wallet" -> [{ t, amount }]
  for (const r of transferRows) {
    if (r[7] !== "mint" || String(r[4]).toLowerCase() !== ZERO) continue;
    const k = `${r[1]}:${r[3]}|${String(r[5]).toLowerCase()}`;
    (mints.get(k) || mints.set(k, []).get(k)).push({ t: Date.parse(r[9]), amount: Number(r[6]) || 0 });
  }
  const used = new Map();
  return pending.map((p) => {
    const k = `${p[0]}:${p[1]}|${String(p[2]).toLowerCase()}`, owed = Math.max(0, Number(p[3]) || 0), since = Date.parse(p[7]) || 0;
    const total = (mints.get(k) || []).filter((m) => m.t >= since).reduce((a, m) => a + m.amount, 0);
    const minted = Math.min(owed, Math.max(0, total - (used.get(k) || 0)));
    used.set(k, (used.get(k) || 0) + minted);
    return [p[0], String(p[1]), String(p[2]).toLowerCase(), owed, minted, owed - minted, p[6] || "", p[7] || ""];
  });
}

// Holdings as of a moment: only transfers whose block time is at or before `atIso` count.
// Used for 3v3nt snapshots, so a snapshot is exact to the second whenever the job gets to it.
export function holdingsAt(rows, atIso) {
  const at = Date.parse(atIso);
  return derive(rows.filter((r) => r[9] && Date.parse(r[9]) <= at)).holdings;
}
// Snapshot requests (ledger tab "snapshots": tab, at, status, taken_at, rows). One is due once both chains have been
// recorded past its time and a minute has passed, so every transfer up to that second is in.
export const SNAPSHOT_HEADER = ["tab", "at", "status", "taken_at", "rows"];
export const SNAPSHOT_SETTLE_MS = 60 * 1000;   // plus: both chains must be recorded past the snapshot time
export const SNAPSHOT_TAB_RE = /^snapshot-[a-z0-9-]{1,60}$/;
export function dueSnapshots(requests, now, chainsDoneThrough) {
  return requests.filter((r) => r.tab && SNAPSHOT_TAB_RE.test(r.tab) && r.status !== "taken" && Date.parse(r.at) + SNAPSHOT_SETTLE_MS <= now
    && Object.values(chainsDoneThrough).every((t) => Date.parse(t) >= Date.parse(r.at)));
}
