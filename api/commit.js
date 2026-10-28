// GET  /api/commit?phase=candidacy                          -> window times and state; with a session, your entry if any,
//                                                               and which of its candidates have been burned to 333burn
// POST /api/commit { phase, entries }                        -> checks the entry and returns the exact message to sign
// POST /api/commit { phase, entries, issuedAt, signature }   -> stores the entry, final, once per wallet per phase
// Entries for candidacy: [{ race: "KY", candidate: "univ3rs3:10001" }, ...]
// Demographics: { demographics: [{ kind: free|added|straddle, card?, team?, color, tiers, races }], inserts: [{ key, qty }] }
import { store } from "./_lib/store.js";
import { readHoldings, readTransfers, readUsResults } from "./_lib/ledger.js";
import { cors, body, walletFromReq, signerOf } from "./_lib/session.js";
import { windowState, storedPhase, RACES, RACE_CODES, candidatePool, candidacyMessage, TEST_MODE, candidacyBurns,
  univ3rs3Tokens, checkDemographics, demographicsMessage, demographicsItems, sentTo, confirmSpan, PHASES, candidateRaces, shortName,
  candidacyIndex, demographicsIndex } from "./_lib/l3ction.js";

const SIGN_MAX_AGE_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const KEY = process.env.GOOGLE_API_KEY;
  const wallet = walletFromReq(req);
  const phase = String((req.method === "GET" ? req.query.phase : body(req).phase) || "");
  if (req.method === "GET" && phase === "map") return map(res, KEY);
  const win = windowState(phase);
  if (!win) return res.status(400).json({ error: "unknown phase" });
  try {
    if (req.method === "GET") {
      const mine = wallet ? (await store("get_commitment", { phase: storedPhase(phase), wallet })).commitment : null;
      // Burn confirmations: which committed candidates the ledger has seen arrive at 333burn.
      const burns = mine && phase === "candidacy" ? candidacyBurns(mine, wallet, await readTransfers(KEY), win) : null;
      // Demographics: how much of each committed piece has reached its destination ("key>dest" -> qty sent).
      let sent = null;
      if (mine && phase === "demographics") {
        const [from, to] = confirmSpan(mine, win);
        sent = Object.fromEntries(Object.entries(sentTo(demographicsItems(mine.payload), wallet, await readTransfers(KEY), from, to)).map(([k, v]) => [k, v.sent]));
      }
      return res.status(200).json({ phase, window: win, races: RACES, entry: mine, burns, sent });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    if (!wallet) return res.status(401).json({ error: "sign in first" });
    if (phase !== "candidacy" && phase !== "demographics") return res.status(400).json({ error: `${phase} submissions open later` });
    if (!win.commitOpen) return res.status(403).json({ error: `the ${phase} window is not open` });

    const { profile } = await store("get_profile", { wallet });
    if (!profile) return res.status(403).json({ error: "create a profile first" });
    const existing = (await store("get_commitment", { phase: storedPhase(phase), wallet })).commitment;
    if (existing) return res.status(409).json({ error: `you already submitted your ${phase} entry; it is final`, entry: existing });

    const b = body(req);
    if (phase === "demographics") return demographics(req, res, b, wallet, KEY, profile.username);
    const entries = Array.isArray(b.entries) ? b.entries.map((e) => ({ race: String(e.race || "").toUpperCase(), candidate: String(e.candidate || "") })) : [];
    const [pool, holdings] = await Promise.all([candidatePool(KEY), readHoldings(KEY)]);
    const problems = checkCandidacy(entries, wallet, pool, holdings, { skipHolding: TEST_MODE });
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
    const r = await store("put_commitment", { phase: storedPhase(phase), wallet, username: profile.username, payload: { entries }, signature: b.signature, message,
      index: TEST_MODE ? null : candidacyIndex(entries, Object.fromEntries([...pool].map(([k, t]) => [k, t.name])), wallet, profile.username) });
    if (r.ok === false) return res.status(409).json({ error: r.error === "already submitted" ? "you already submitted your candidacy entry; it is final" : r.error });
    res.status(201).json({ ok: true, submitted_at: r.submitted_at, entries });
  } catch (e) { res.status(502).json({ error: e.message }); }
}

// GET /api/commit?phase=map: public data for the 3l3ction map page. Races, the schedule, the US calls,
// the number of confirmed candidates (once candidacy confirmations close), and every race with a candidate
// and who the candidates are (once demographics entries close). Who ran them stays private until results.
async function map(res, KEY) {
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
  const now = Date.now();
  const out = { races: RACES, schedule: PHASES, us: await readUsResults(KEY), candidateCount: null, ballots: null, generatedAt: new Date().toISOString() };
  if (now > Date.parse(PHASES.candidacy.confirmCloses)) {
    const [{ commitments = [] }, transfers, univ] = await Promise.all([store("list_commitments", { phase: "candidacy" }), readTransfers(KEY), univ3rs3Tokens(KEY)]);
    const names = Object.fromEntries(univ.map((t) => [t.key, shortName(t.name)]));
    const cr = candidateRaces(commitments, transfers, names);
    out.candidateCount = cr.total;
    if (now > Date.parse(PHASES.demographics.commitCloses)) out.ballots = cr.races;
  }
  return res.status(200).json(out);
}

// Demographics entry (rules §3): check, return the text to sign, then store once signed.
async function demographics(req, res, b, wallet, KEY, username) {
  const clean = (d) => ({ kind: String(d.kind || ""), card: d.card ? String(d.card) : undefined, team: d.team ? String(d.team) : undefined,
    color: String(d.color || ""), tiers: Number(d.tiers), races: Array.isArray(d.races) ? d.races.map((r) => String(r).toUpperCase()) : [] });
  const payload = {
    demographics: (Array.isArray(b.demographics) ? b.demographics : []).map(clean),
    inserts: (Array.isArray(b.inserts) ? b.inserts : []).filter((i) => Number(i.qty) > 0).map((i) => ({ key: String(i.key), qty: Number(i.qty) })),
  };
  const [univ, holdings] = await Promise.all([univ3rs3Tokens(KEY), readHoldings(KEY)]);
  const tokens = new Map(univ.map((t) => [t.key, t]));
  const held = TEST_MODE ? { get: () => Infinity } : new Map(holdings.filter((h) => h.wallet === wallet).map((h) => [h.key, h.balance]));
  const { problems } = checkDemographics(payload, tokens, held);
  if (problems.length) return res.status(422).json({ error: problems[0], problems });
  const keys = [...payload.demographics.map((d) => d.card).filter(Boolean), ...payload.inserts.map((i) => i.key)];
  const names = Object.fromEntries(keys.map((k) => [k, tokens.get(k)?.name || k]));
  if (!b.signature) {
    const issuedAt = new Date().toISOString();
    return res.status(200).json({ issuedAt, message: demographicsMessage(wallet, payload, names, issuedAt) });
  }
  const age = Date.now() - Date.parse(b.issuedAt);
  if (!(age >= -60000 && age <= SIGN_MAX_AGE_MS)) return res.status(400).json({ error: "that signature request expired; review and sign again" });
  const message = demographicsMessage(wallet, payload, names, b.issuedAt);
  if (signerOf(message, b.signature) !== wallet) return res.status(400).json({ error: "signature does not match your wallet" });
  const r = await store("put_commitment", { phase: storedPhase("demographics"), wallet, username, payload, signature: b.signature, message,
    index: TEST_MODE ? null : demographicsIndex(payload, names, wallet, username) });
  if (r.ok === false) return res.status(409).json({ error: r.error === "already submitted" ? "you already submitted your demographics entry; it is final" : r.error });
  return res.status(201).json({ ok: true, submitted_at: r.submitted_at, payload });
}

// Rules §4.1: burn a 2024 candidate you hold to run it in one race; each candidate once; one per race.
// In rehearsal mode (preview deployments only) the holding check is skipped, so any wallet can
// rehearse with any candidate. Entries are filed under "candidacy-test" and never count.
export function checkCandidacy(entries, wallet, pool, holdings, { skipHolding = false } = {}) {
  const out = [];
  if (!entries.length) out.push("choose at least one candidate");
  const held = new Map(holdings.filter((h) => h.wallet === wallet).map((h) => [h.key, h.balance]));
  const races = new Set(), cands = new Set();
  for (const e of entries) {
    if (!RACE_CODES.has(e.race)) out.push(`unknown race ${e.race}`);
    if (!pool.has(e.candidate)) out.push(`${e.candidate} is not a 2024 candidate card`);
    else if (!skipHolding && !(held.get(e.candidate) > 0)) out.push(`your wallet doesn't hold ${pool.get(e.candidate).name}`);
    if (races.has(e.race)) out.push(`only one candidate per race (${e.race})`);
    if (cands.has(e.candidate)) out.push(`each candidate can run once (${pool.get(e.candidate)?.name || e.candidate})`);
    races.add(e.race); cands.add(e.candidate);
  }
  return out;
}
