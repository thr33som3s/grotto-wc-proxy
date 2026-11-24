// GET /api/holdings?wallet=0x...
// One wallet's balance of every thr33som3s token, from the ledger. Works for any wallet:
// the connected collector's own, or another collector's profile.
import { readHoldings, readState, readPending, isAddress } from "./_lib/ledger.js";
import { COLLECTIONS } from "./_lib/catalog.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  const KEY = process.env.GOOGLE_API_KEY;
  const wallet = String(req.query.wallet || "").toLowerCase();
  if (!isAddress(wallet)) return res.status(400).json({ error: "wallet must be a 0x address" });
  try {
    const [all, ledger, pend] = await Promise.all([readHoldings(KEY), readState(KEY), readPending(KEY)]);
    const tokens = all.filter((h) => h.wallet === wallet).map(({ key, coll, id, balance }) => ({ key, coll, id, balance }));
    // Editions owed to this wallet but not minted to it yet count as theirs ("pending mint").
    const byKey = new Map(tokens.map((t) => [t.key, t]));
    for (const p of pend) {
      if (p.wallet !== wallet || p.remaining <= 0) continue;
      let t = byKey.get(p.key);
      if (!t) { t = { key: p.key, coll: p.coll, id: p.id, balance: 0 }; byKey.set(p.key, t); tokens.push(t); }
      t.pending = (t.pending || 0) + p.remaining;
    }
    const byCollection = Object.fromEntries(COLLECTIONS.map((c) => [c.key, { pieces: 0, editions: 0 }]));
    for (const t of tokens) { if (!byCollection[t.coll]) continue; byCollection[t.coll].pieces++; byCollection[t.coll].editions += t.balance + (t.pending || 0); }
    res.status(200).json({
      wallet, ledger,
      totals: { pieces: tokens.length, editions: tokens.reduce((s, t) => s + t.balance + (t.pending || 0), 0),
        pendingEditions: tokens.reduce((s, t) => s + (t.pending || 0), 0), byCollection },
      tokens,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
