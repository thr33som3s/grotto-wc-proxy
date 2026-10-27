// GET  /api/profile                      (signed in) -> your profile, including your email
// POST /api/profile { username, pfp, email } (signed in) -> creates your profile, or updates pfp/email
// pfp is required: the key of a thr33som3s piece the wallet holds.
// Usernames: required, unique ignoring case, letters/numbers/._ up to 24 characters, and fixed once
// created (thr33s can change one in the private sheet). Names on thr33s's allowlist are reserved
// for the wallet they're listed with.
import { store } from "./_lib/store.js";
import { cors, body, walletFromReq } from "./_lib/session.js";
import { publicProfile } from "./session.js";
import { readHoldings } from "./_lib/ledger.js";

// New usernames: letters, numbers, . and _ only, up to 24 characters. No spaces or other characters.
// Canon allowlist names (e.g. "chris trueman") are exempt and kept exactly as listed.
export const USERNAME_RE = /^[A-Za-z0-9._]{1,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Profile pictures are one of the collector's own thr33som3s pieces, stored as its key ("univ3rs3:3010").
// Required. No uploaded images are accepted or stored.
const PFP_RE = /^(univ3rs3|bulk|thr33zi3s|gen2|gen3|guest):\d+$/;
// Custom pictures, one per wallet: thr33som3s's own wallet uses the 333 logo. Nobody else has one.
export const CUSTOM_PFPS = { "0xfe917312344b4ed3283c5e142868cd3eaa782933": "custom:thr33som3s" };
export async function holdsPiece(wallet, key) {
  if (key && CUSTOM_PFPS[wallet] === key) return true;
  if (!PFP_RE.test(key || "")) return false;
  const holdings = await readHoldings(process.env.GOOGLE_API_KEY);
  return holdings.some((h) => h.wallet === wallet && h.key === key && h.balance > 0);
}

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
    const pfpProblem = async () =>
      !(PFP_RE.test(pfp) || CUSTOM_PFPS[wallet] === pfp) ? "choose one of your thr33som3s paintings as your profile picture"
      : !(await holdsPiece(wallet, pfp)) ? "that painting isn't in your collection; choose one you hold" : null;
    const email = String(b.email || "").trim();
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: "that email address doesn't look right" });

    if (profile) { // update: picture and email only
      const pp = await pfpProblem(); if (pp) return res.status(400).json({ error: pp, field: "pfp" });
      await store("put_profile", { wallet, allowUpdate: true, profile: { username: profile.username, pfp, email } });
      return res.status(200).json({ profile: { ...publicProfile(profile, true), pfp, email } });
    }
    const username = String(b.username || "").trim();
    const problem = await usernameProblem(username, wallet);
    if (problem) return res.status(409).json({ error: problem, field: "username" });
    const pp = await pfpProblem(); if (pp) return res.status(400).json({ error: pp, field: "pfp" });
    const r = await store("put_profile", { wallet, profile: { username, pfp, email } });
    if (r.ok === false) return res.status(409).json({ error: r.error });
    res.status(201).json({ profile: { wallet, username, pfp, email } });
  } catch (e) { res.status(502).json({ error: e.message }); }
}

export async function usernameProblem(username, wallet) {
  const u = username.toLowerCase();
  const [{ allowlist = [] }, { profiles = [] }] = await Promise.all([store("get_allowlist"), store("list_profiles")]);
  const reserved = allowlist.find((a) => String(a.username).toLowerCase() === u);
  // A collector's own allowlist name is canon: accepted exactly as listed, with no format rule.
  if (reserved && reserved.wallet !== wallet)
    return "that username belongs to a different wallet. if you believe that's an error, contact thr33som3s. for now, choose a different username.";
  const own = reserved && reserved.username === username;
  if (!own && !USERNAME_RE.test(username)) return "usernames use letters, numbers, . and _ only (no spaces), up to 24 characters";
  if (profiles.some((p) => String(p.username).toLowerCase() === u && p.wallet !== wallet)) return "that username is taken";
  return null;
}
