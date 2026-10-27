// POST /api/session  { wallet, issuedAt, signature }  -> { token, expiresInMinutes, profile, suggestedUsername }
// GET  /api/session?wallet=0x...                       -> { message, issuedAt }  (the exact text to sign)
// Sign in with a free wallet signature. Sessions last 90 minutes.
import { store } from "./_lib/store.js";
import { cors, body, isAddress, signInMessage, verifySignIn, issueToken, SESSION_MINUTES } from "./_lib/session.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") {
    const wallet = String(req.query.wallet || "");
    if (!isAddress(wallet)) return res.status(400).json({ error: "wallet must be a 0x address" });
    const issuedAt = new Date().toISOString();
    return res.status(200).json({ issuedAt, message: signInMessage(wallet, issuedAt) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
  try {
    const wallet = verifySignIn(body(req));
    const [{ profile }, allow] = await Promise.all([store("get_profile", { wallet }), store("get_allowlist")]);
    const listed = (allow.allowlist || []).find((a) => a.wallet === wallet);
    res.status(200).json({ token: issueToken(wallet), wallet, expiresInMinutes: SESSION_MINUTES, profile: profile ? publicProfile(profile, true) : null, suggestedUsername: profile ? null : listed ? listed.username : null });
  } catch (e) { res.status(400).json({ error: e.message }); }
}
export function publicProfile(p, own) {
  return { wallet: p.wallet, username: p.username, pfp: p.pfp || "", ...(own ? { email: p.email || "" } : {}), created_at: p.created_at };
}
