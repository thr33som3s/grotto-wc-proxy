// GET /api/holders?token=univ3rs3:317004              -> every wallet holding it, largest balance first
// GET /api/holders?token=univ3rs3:317004&activity=1   -> also every mint, transfer and burn of it, newest first
// From the ledger. Burn addresses are excluded from holders.
import { readHoldings, readSupply, readState, readTransfers } from "./_lib/ledger.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  const KEY = process.env.GOOGLE_API_KEY;
  const token = String(req.query.token || "");
  if (!/^[a-z0-9]+:\d+$/.test(token)) return res.status(400).json({ error: "token must look like univ3rs3:317004" });
  try {
    const wantActivity = !!req.query.activity;
    const [all, supply, ledger, transfers] = await Promise.all([readHoldings(KEY), readSupply(KEY), readState(KEY), wantActivity ? readTransfers(KEY) : null]);
    const holders = all.filter((h) => h.key === token).map(({ wallet, balance }) => ({ wallet, balance }))
      .sort((a, b) => b.balance - a.balance || (a.wallet < b.wallet ? -1 : 1));   // largest first
    const activity = transfers
      ? transfers.filter((t) => t.key === token)
          .map(({ chain, from, to, amount, type, block, time, tx }) => ({ chain, from, to, amount, type, block, time, tx }))
          .sort((a, b) => b.block - a.block)
      : undefined;
    res.status(200).json({ token, ledger, editions: supply.get(token) || null, holders, ...(activity ? { activity } : {}) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
