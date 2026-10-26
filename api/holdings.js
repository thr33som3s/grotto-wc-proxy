// GET /api/holdings?wallet=0x...
// One wallet's balance of every thr33som3s token, from the ledger. Works for any wallet:
// the connected collector's own, or another collector's profile.
import { readHoldings, readState, isAddress } from "./_lib/ledger.js";
import { COLLECTIONS } from "./_lib/catalog.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  const KEY = process.env.GOOGLE_API_KEY;
  const wallet = String(req.query.wallet || "").toLowerCase();
  if (!isAddress(wallet)) return res.status(400).json({ error: "wallet must be a 0x address" });
  try {
    const [all, ledger] = await Promise.all([readHoldings(KEY), readState(KEY)]);
    const tokens = all.filter((h) => h.wallet === wallet).map(({ key, coll, id, balance }) => ({ key, coll, id, balance }));
    const byCollection = Object.fromEntries(COLLECTIONS.map((c) => [c.key, { pieces: 0, editions: 0 }]));
    for (const t of tokens) { byCollection[t.coll].pieces++; byCollection[t.coll].editions += t.balance; }
    res.status(200).json({
      wallet, ledger,
      totals: { pieces: tokens.length, editions: tokens.reduce((s, t) => s + t.balance, 0), byCollection },
      tokens,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
