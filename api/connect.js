// POST /api/connect  { wallet, mode: "guest" | "player", page }
// Logs every wallet that connects to the site, guest or player.
import { store } from "./_lib/store.js";
import { cors, body, isAddress } from "./_lib/session.js";

export default async function handler(req, res) {
  cors(res, "POST");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { wallet, mode, page } = body(req);
  if (!isAddress(wallet)) return res.status(400).json({ error: "wallet must be a 0x address" });
  try {
    await store("log_connection", { wallet, mode: mode === "player" ? "player" : "guest", page: String(page || "").slice(0, 200), userAgent: req.headers["user-agent"] || "" });
    res.status(200).json({ ok: true });
  } catch (e) { res.status(502).json({ error: e.message }); }
}
