// GET  /api/profile                      (signed in) -> your profile, including your email
// POST /api/profile { username, pfp, email } (signed in) -> creates your profile, or updates pfp/email
// Usernames: required, unique ignoring case, letters/numbers/spaces/_-., up to 24 characters, and fixed once
// created (thr33s can change one in the private sheet). Names on thr33s's allowlist are reserved
// for the wallet they're listed with.
import { store } from "./_lib/store.js";
import { cors, body, walletFromReq } from "./_lib/session.js";
import { publicProfile } from "./session.js";

// Letters, numbers, _ - . and single spaces between words (Grotto names like "chris trueman", "Mrs.Omac").
export const USERNAME_RE = /^(?=.{1,24}$)[A-Za-z0-9_.-]+( [A-Za-z0-9_.-]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PFP = 40000; // characters of the data: URL; the page shrinks images to a small square first

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const wallet = walletFromReq(req);
  if (!wallet) return res.status(401).json({ error: "sign in first" });
  try {
    const { profile } = await store("get_profile", { wallet });
    if (req.method === "GET") return res.status(200).json({ profile: profile ? publicProfile(profile, true) : null });
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    const b = body(req);
    const pfp = String(b.pfp || "");
    if (pfp && (!/^data:image\/(jpeg|png|webp);base64,/.test(pfp) || pfp.length > MAX_PFP)) return res.status(400).json({ error: "profile picture must be a small image" });
    const email = String(b.email || "").trim();
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: "that email address doesn't look right" });

    if (profile) { // update: picture and email only
      await store("put_profile", { wallet, allowUpdate: true, profile: { username: profile.username, pfp, email } });
      return res.status(200).json({ profile: { ...publicProfile(profile, true), pfp, email } });
    }
    const username = String(b.username || "").trim();
    const problem = await usernameProblem(username, wallet);
    if (problem) return res.status(409).json({ error: problem, field: "username" });
    const r = await store("put_profile", { wallet, profile: { username, pfp, email } });
    if (r.ok === false) return res.status(409).json({ error: r.error });
    res.status(201).json({ profile: { wallet, username, pfp, email } });
  } catch (e) { res.status(502).json({ error: e.message }); }
}

export async function usernameProblem(username, wallet) {
  if (!USERNAME_RE.test(username)) return "usernames use letters, numbers, spaces, _ - or ., up to 24 characters";
  const u = username.toLowerCase();
  const [{ allowlist = [] }, { profiles = [] }] = await Promise.all([store("get_allowlist"), store("list_profiles")]);
  const reserved = allowlist.find((a) => String(a.username).toLowerCase() === u);
  if (reserved && reserved.wallet !== wallet)
    return "that username belongs to a different wallet. if you believe that's an error, contact thr33som3s. for now, choose a different username.";
  if (profiles.some((p) => String(p.username).toLowerCase() === u && p.wallet !== wallet)) return "that username is taken";
  return null;
}
