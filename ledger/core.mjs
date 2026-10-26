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
