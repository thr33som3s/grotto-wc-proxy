// GET /api/names  (signed in, with a profile) -> { names: { wallet: username, ... } }
// Lets profile holders see usernames in place of wallet addresses. Guests don't get the map.
import { store } from "./_lib/store.js";
import { cors, walletFromReq } from "./_lib/session.js";

export default async function handler(req, res) {
  cors(res, "GET");
  if (req.method === "OPTIONS") return res.status(204).end();
  const wallet = walletFromReq(req);
  if (!wallet) return res.status(401).json({ error: "sign in first" });
  try {
    const { profiles = [] } = await store("list_profiles");
    if (!profiles.some((p) => p.wallet === wallet)) return res.status(403).json({ error: "create a profile first" });
    res.status(200).json({ names: Object.fromEntries(profiles.map((p) => [p.wallet, p.username])) });
  } catch (e) { res.status(502).json({ error: e.message }); }
}
