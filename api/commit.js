// GET  /api/commit?phase=candidacy                          -> window times and state; with a session, your entry if any
// POST /api/commit { phase, entries }                        -> checks the entry and returns the exact message to sign
// POST /api/commit { phase, entries, issuedAt, signature }   -> stores the entry, final, once per wallet per phase
// Entries for candidacy: [{ race: "KY", candidate: "univ3rs3:10001" }, ...]
import { store } from "./_lib/store.js";
import { readHoldings } from "./_lib/ledger.js";
import { cors, body, walletFromReq, signerOf } from "./_lib/session.js";
import { windowState, storedPhase, RACES, RACE_CODES, candidatePool, candidacyMessage } from "./_lib/l3ction.js";

const SIGN_MAX_AGE_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const KEY = process.env.GOOGLE_API_KEY;
  const wallet = walletFromReq(req);
  const phase = String((req.method === "GET" ? req.query.phase : body(req).phase) || "");
  const win = windowState(phase);
  if (!win) return res.status(400).json({ error: "unknown phase" });
  try {
    if (req.method === "GET") {
      const mine = wallet ? (await store("get_commitment", { phase: storedPhase(phase), wallet })).commitment : null;
      return res.status(200).json({ phase, window: win, races: RACES, entry: mine });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    if (!wallet) return res.status(401).json({ error: "sign in first" });
    if (phase !== "candidacy") return res.status(400).json({ error: `${phase} submissions open later` });
    if (!win.commitOpen) return res.status(403).json({ error: "the candidacy window is not open" });

    const { profile } = await store("get_profile", { wallet });
    if (!profile) return res.status(403).json({ error: "create a profile first" });
    const existing = (await store("get_commitment", { phase: storedPhase(phase), wallet })).commitment;
    if (existing) return res.status(409).json({ error: "you already submitted your candidacy entry; it is final", entry: existing });

    const b = body(req);
    const entries = Array.isArray(b.entries) ? b.entries.map((e) => ({ race: String(e.race || "").toUpperCase(), candidate: String(e.candidate || "") })) : [];
    const [pool, holdings] = await Promise.all([candidatePool(KEY), readHoldings(KEY)]);
    const problems = checkCandidacy(entries, wallet, pool, holdings);
    if (problems.length) return res.status(422).json({ error: problems[0], problems });
    const names = Object.fromEntries(entries.map((e) => [e.candidate, pool.get(e.candidate).name]));

    if (!b.signature) { // step 1: return the exact text to sign
      const issuedAt = new Date().toISOString();
      return res.status(200).json({ issuedAt, message: candidacyMessage(wallet, entries, names, issuedAt) });
    }
    const age = Date.now() - Date.parse(b.issuedAt);
    if (!(age >= -60000 && age <= SIGN_MAX_AGE_MS)) return res.status(400).json({ error: "that signature request expired; review and sign again" });
    const message = candidacyMessage(wallet, entries, names, b.issuedAt);
    if (signerOf(message, b.signature) !== wallet) return res.status(400).json({ error: "signature does not match your wallet" });
    const r = await store("put_commitment", { phase: storedPhase(phase), wallet, payload: { entries }, signature: b.signature, message });
    if (r.ok === false) return res.status(409).json({ error: r.error === "already submitted" ? "you already submitted your candidacy entry; it is final" : r.error });
    res.status(201).json({ ok: true, submitted_at: r.submitted_at, entries });
  } catch (e) { res.status(502).json({ error: e.message }); }
}

// Rules §4.1: burn a 2024 candidate you hold to run it in one race; each candidate once; one per race.
export function checkCandidacy(entries, wallet, pool, holdings) {
  const out = [];
  if (!entries.length) out.push("choose at least one candidate");
  const held = new Map(holdings.filter((h) => h.wallet === wallet).map((h) => [h.key, h.balance]));
  const races = new Set(), cands = new Set();
  for (const e of entries) {
    if (!RACE_CODES.has(e.race)) out.push(`unknown race ${e.race}`);
    if (!pool.has(e.candidate)) out.push(`${e.candidate} is not a 2024 candidate card`);
    else if (!(held.get(e.candidate) > 0)) out.push(`your wallet doesn't hold ${pool.get(e.candidate).name}`);
    if (races.has(e.race)) out.push(`only one candidate per race (${e.race})`);
    if (cands.has(e.candidate)) out.push(`each candidate can run once (${pool.get(e.candidate)?.name || e.candidate})`);
    races.add(e.race); cands.add(e.candidate);
  }
  return out;
}
