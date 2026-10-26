// GET /api/holders?token=univ3rs3:317004
// Every wallet holding a token, largest balance first, from the ledger. Burn addresses are excluded.
import { readHoldings, readSupply, readState } from "./_lib/ledger.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  const KEY = process.env.GOOGLE_API_KEY;
  const token = String(req.query.token || "");
  if (!/^[a-z0-9]+:\d+$/.test(token)) return res.status(400).json({ error: "token must look like univ3rs3:317004" });
  try {
    const [all, supply, ledger] = await Promise.all([readHoldings(KEY), readSupply(KEY), readState(KEY)]);
    const holders = all.filter((h) => h.key === token).map(({ wallet, balance }) => ({ wallet, balance }));
    res.status(200).json({ token, ledger, editions: supply.get(token) || null, holders });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
