// GET  /api/commit?phase=candidacy                          -> window times and state; with a session, your entry if any,
//                                                               and which of its candidates have been burned to 333burn
// POST /api/commit { phase, entries }                        -> checks the entry and returns the exact message to sign
// POST /api/commit { phase, entries, issuedAt, signature }   -> stores the entry, final, once per wallet per phase
// Entries for candidacy: [{ race: "KY", candidate: "univ3rs3:10001" }, ...]
// Demographics: { demographics: [{ kind: free|added|straddle, card?, team?, color, tiers, races }], inserts: [{ key, qty }] }
import { store } from "./_lib/store.js";
import { readHoldings, readTransfers, readUsResults } from "./_lib/ledger.js";
import { tally } from "./_lib/tally.js";
import { cors, body, walletFromReq, signerOf } from "./_lib/session.js";
import { windowState, storedPhase, RACES, RACE_CODES, candidatePool, candidacyMessage, TEST_MODE, candidacyBurns,
  univ3rs3Tokens, collectionTokens, checkDemographics, demographicsMessage, demographicsItems, sentTo, confirmSpan, PHASES, candidateRaces, shortName,
  candidacyIndex, demographicsIndex, demographicsReveal, DEMOGRAPHICS_REVEALED, tallyInput, mapResults, RESULTS_REVEALED, votingToken, checkVotes, votingMessage, votingItems, votingIndex } from "./_lib/l3ction.js";

const SIGN_MAX_AGE_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  const KEY = process.env.GOOGLE_API_KEY;
  const wallet = walletFromReq(req);
  const phase = String((req.method === "GET" ? req.query.phase : body(req).phase) || "");
  if (req.method === "GET" && phase === "map") return map(res, KEY, wallet);
  const win = windowState(phase, Date.now(), wallet);
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
      let ballots = null;
      if (phase === "voting") {
        ballots = await votingBallots(KEY);
        if (mine) {
          const [from, to] = confirmSpan(mine, win);
          sent = Object.fromEntries(Object.entries(sentTo(votingItems(mine.payload), wallet, await readTransfers(KEY), from, to)).map(([k, v]) => [k, v.sent]));
        }
      }
      return res.status(200).json({ phase, window: win, races: RACES, entry: mine, burns, sent, ballots });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST" });
    if (!wallet) return res.status(401).json({ error: "sign in first" });
    if (!["candidacy", "demographics", "voting"].includes(phase)) return res.status(400).json({ error: `${phase} submissions open later` });
    if (!win.commitOpen) return res.status(403).json({ error: `the ${phase} window is not open` });

    const { profile } = await store("get_profile", { wallet });
    if (!profile) return res.status(403).json({ error: "create a profile first" });
    const existing = (await store("get_commitment", { phase: storedPhase(phase), wallet })).commitment;
    if (existing) return res.status(409).json({ error: `you already submitted your ${phase} entry; it is final`, entry: existing });

    const b = body(req);
    if (phase === "demographics") return demographics(req, res, b, wallet, KEY, profile.username);
    if (phase === "voting") return voting(req, res, b, wallet, KEY, profile.username);
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
// thr33s's own wallet, signed in on conn3ct, previews the reveal early. Never cached.
const ARTIST_WALLET = "0xfe917312344b4ed3283c5e142868cd3eaa782933";
async function map(res, KEY, wallet) {
  const preview = wallet === ARTIST_WALLET;
  // Usernames go only to a signed-in collector; everyone else sees the last 4 characters of each wallet.
  // A signed-in view is never cached, so it can't reach anyone else.
  const signedIn = !!wallet;
  res.setHeader("Cache-Control", signedIn ? "private, no-store" : "s-maxage=60, stale-while-revalidate=120");
  const now = Date.now();
  const out = { races: RACES, schedule: PHASES, us: await readUsResults(KEY), candidateCount: null, ballots: null, preview, generatedAt: new Date().toISOString() };
  if (preview || now > Date.parse(PHASES.candidacy.confirmCloses)) {
    const [{ commitments = [] }, transfers, univ] = await Promise.all([store("list_commitments", { phase: "candidacy" }), readTransfers(KEY), univ3rs3Tokens(KEY)]);
    const names = Object.fromEntries(univ.map((t) => [t.key, shortName(t.name)]));
    const images = Object.fromEntries(univ.map((t) => [t.key, t.image || ""]));
    const cr = candidateRaces(commitments, transfers, names, images);
    out.candidateCount = cr.total;
    if (preview || now > Date.parse(PHASES.demographics.commitCloses)) out.ballots = cr.races;
    // Demographics: hidden until thr33s says; his preview counts chris trueman as confirmed (Nov 2).
    if (preview || DEMOGRAPHICS_REVEALED) {
      const [{ commitments: demos = [] }, bulk, { profiles = [] }] = await Promise.all([store("list_commitments", { phase: storedPhase("demographics") }), collectionTokens(KEY, "bulk").catch(() => []), store("list_profiles", {})]);
      // The store's entry list carries no usernames; attach each collector's from their profile.
      const userOf = new Map(profiles.map((p) => [String(p.wallet).toLowerCase(), p.username]));
      const short = (w) => "…" + String(w).toLowerCase().slice(-4);
      const named = (list) => list.map((e) => ({ ...e, username: signedIn ? (userOf.get(String(e.wallet).toLowerCase()) || short(e.wallet)) : short(e.wallet) }));
      demos.splice(0, demos.length, ...named(demos));
      commitments.splice(0, commitments.length, ...named(commitments));
      const tokens = new Map([...univ, ...bulk].map((t) => [t.key, t]));
      const assume = preview && !DEMOGRAPHICS_REVEALED ? new Set(["0x35cd6404a0ae7d84bf7dabc3681af9aadca10457"]) : new Set();
      const rv = demographicsReveal(demos, transfers, tokens, now, assume);
      out.demographics = rv.races;
      if (preview) out.demographicsStatus = rv.status;
      // Results: thr33s's preview only (preliminary: pending voting entries counted), until he says.
      if (preview || RESULTS_REVEALED) {
        const votes = named((await store("list_commitments", { phase: storedPhase("voting") })).commitments || []);
        const colls = [...new Set(votes.flatMap((e) => (e.payload?.votes || []).map((v) => String(v.token).split(":")[0])))].filter((c) => c !== "univ3rs3" && c !== "bulk");
        const extra = (await Promise.all(colls.map((c) => collectionTokens(KEY, c).catch(() => [])))).flat();
        const all = new Map([...tokens, ...extra.map((t) => [t.key, t])]);
        const usCalls = Object.fromEntries(Object.entries(out.us || {}).filter(([, u]) => u.called).map(([r, u]) => [r, u.color]));
        const { input, status } = tallyInput({ candidacy: commitments, demographics: demos, voting: votes }, transfers, all, usCalls, now, preview && !RESULTS_REVEALED);
        const t = tally(input);
        out.results = mapResults(t, input, all);
        out.grotto = Object.fromEntries(Object.entries(out.results).map(([r, x]) => [r, { color: x.color }]));
        if (preview) { out.votingStatus = status.voting; out.tallyErrors = t.errors; out.prize = t.prize; out.rulings = t.rulings; }
      }
    }
  }
  return res.status(200).json(out);
}

// Every race with a confirmed candidate, and its candidates (the voting ballot; public since demographics closed).
async function votingBallots(KEY) {
  const [{ commitments = [] }, transfers, univ] = await Promise.all([store("list_commitments", { phase: storedPhase("candidacy") }), readTransfers(KEY), univ3rs3Tokens(KEY)]);
  const names = Object.fromEntries(univ.map((t) => [t.key, shortName(t.name)]));
  const images = Object.fromEntries(univ.map((t) => [t.key, t.image || ""]));
  return candidateRaces(commitments, transfers, names, images).races;
}

// Voting entry (rules §6): check, return the text to sign, then store once signed.
async function voting(req, res, b, wallet, KEY, username) {
  const payload = { votes: (Array.isArray(b.votes) ? b.votes : []).map((v) => ({
    race: String(v.race || "").toUpperCase(), token: String(v.token || ""),
    declared: v.declared ? String(v.declared) : undefined, candidate: v.candidate ? String(v.candidate) : undefined })) };
  const colls = [...new Set(payload.votes.map((v) => v.token.split(":")[0]))];
  const [lists, holdings, ballots, demo] = await Promise.all([
    Promise.all(colls.map((c) => collectionTokens(KEY, c).catch(() => []))), readHoldings(KEY), votingBallots(KEY),
    store("get_commitment", { phase: storedPhase("demographics"), wallet })]);
  const tokens = new Map(lists.flat().map((t) => [t.key, t]));
  for (const v of payload.votes) { const vt = votingToken(tokens.get(v.token)); if (vt && vt.color !== "purple") delete v.declared;
    const bl = ballots[v.race]; if (bl && bl.candidates.length === 1) v.candidate = bl.candidates[0]; }
  const held = TEST_MODE ? { get: () => Infinity } : new Map(holdings.filter((h) => h.wallet === wallet).map((h) => [h.key, h.balance]));
  const freeCard = demo?.commitment?.payload?.demographics?.find((d) => d.kind === "free")?.card || null;
  const problems = checkVotes(payload, tokens, held, ballots, freeCard);
  if (problems.length) return res.status(422).json({ error: problems[0], problems });
  if (!b.signature) {
    const issuedAt = new Date().toISOString();
    return res.status(200).json({ issuedAt, message: votingMessage(wallet, payload, tokens, issuedAt) });
  }
  const age = Date.now() - Date.parse(b.issuedAt);
  if (!(age >= -60000 && age <= SIGN_MAX_AGE_MS)) return res.status(400).json({ error: "that signature request expired; review and sign again" });
  const message = votingMessage(wallet, payload, tokens, b.issuedAt);
  if (signerOf(message, b.signature) !== wallet) return res.status(400).json({ error: "signature does not match your wallet" });
  const r = await store("put_commitment", { phase: storedPhase("voting"), wallet, username, payload, signature: b.signature, message,
    index: TEST_MODE ? null : votingIndex(payload, tokens, wallet, username) });
  if (r.ok === false) return res.status(409).json({ error: r.error === "already submitted" ? "you already submitted your voting entry; it is final" : r.error });
  return res.status(201).json({ ok: true, submitted_at: r.submitted_at, payload });
}

// Demographics entry (rules §3): check, return the text to sign, then store once signed.
async function demographics(req, res, b, wallet, KEY, username) {
  const clean = (d) => ({ kind: String(d.kind || ""), card: d.card ? String(d.card) : undefined, team: d.team ? String(d.team) : undefined,
    color: String(d.color || ""), tiers: Number(d.tiers), races: Array.isArray(d.races) ? d.races.map((r) => String(r).toUpperCase()) : [] });
  const payload = {
    demographics: (Array.isArray(b.demographics) ? b.demographics : []).map(clean),
    inserts: (Array.isArray(b.inserts) ? b.inserts : []).filter((i) => Number(i.qty) > 0).map((i) => ({ key: String(i.key), qty: Number(i.qty) })),
  };
  const [univ, bulk, holdings] = await Promise.all([univ3rs3Tokens(KEY), collectionTokens(KEY, "bulk").catch(() => []), readHoldings(KEY)]);
  const tokens = new Map(univ.map((t) => [t.key, t]));
  const bulkNames = new Map(bulk.map((t) => [t.key, t.name]));
  const held = TEST_MODE ? { get: () => Infinity } : new Map(holdings.filter((h) => h.wallet === wallet).map((h) => [h.key, h.balance]));
  const { problems } = checkDemographics(payload, tokens, held);
  if (problems.length) return res.status(422).json({ error: problems[0], problems });
  const keys = [...payload.demographics.map((d) => d.card).filter(Boolean), ...payload.inserts.map((i) => i.key)];
  const names = Object.fromEntries(keys.map((k) => [k, tokens.get(k)?.name || bulkNames.get(k) || k]));
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
