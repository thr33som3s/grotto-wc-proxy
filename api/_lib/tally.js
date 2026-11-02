// 2026 3l3ction tally engine — implements 2026_3l3ction_rules_v18.md
// Pure functions, no dependencies. Same input (including seed) => same output.
// Input comes from the WalletConnect path or the fallback forms; both feed this.
//
// Token custody, ledger holdings checks (e.g. §3.1 holding requirement, a token
// edition used twice), and eligibility pools live outside this engine. The
// caller passes their results in (e.g. demographic.voided = true).

// ---------- §3.2 / §3.4 insert scale ----------

// Defaults match rules v11. A 3v3nt config from the builder overrides them:
// pass input.format (the builder's format object) and settingsFrom() reads it by key.
export const DEFAULTS = {
  capacity: [5, 10, 15, 20, 25, 35],
  standardCosts: [0, 500, 400, 300, 200, 100], // free or added team
  straddleCosts: [500, 500, 400, 300, 200, 100], // no free 5
  maxTeams: 5,
  editions: { candidate: [3, 5], uncontestedMatch: [1, 2], contestedWinner: [1, 1], contestedWinnerColor: [2, 3], purpleVoter: [1, 2] },
  prize: { first: 25, second: 10 },
};
export const TIER_CAPACITY = DEFAULTS.capacity;

// Reads settings from the builder's format: sections, rows and columns are found by key, never by label.
export function settingsFrom(format) {
  const S = JSON.parse(JSON.stringify(DEFAULTS));
  const secs = (format && Array.isArray(format.sections)) ? format.sections : [];
  const sec = (id) => secs.find((x) => x.id === id);
  const num = (v, d) => (v === "" || v === undefined || v === null || isNaN(Number(v)) ? d : Number(v));
  const g = sec("general");
  if (g) { const r = g.rows.find((x) => x.id === "maxTeams"); if (r) S.maxTeams = num(r.values.value, S.maxTeams); }
  const ps = sec("placementScale");
  if (ps && ps.rows.length) {
    S.capacity = ps.rows.map((r, i) => num(r.values.placements, DEFAULTS.capacity[i] ?? 0));
    S.standardCosts = ps.rows.map((r, i) => num(r.values.standard, DEFAULTS.standardCosts[i] ?? 0));
    S.straddleCosts = ps.rows.map((r, i) => num(r.values.straddle, DEFAULTS.straddleCosts[i] ?? 0));
  }
  const ed = sec("editions");
  if (ed) for (const k of Object.keys(S.editions)) {
    const r = ed.rows.find((x) => x.id === k);
    if (r) S.editions[k] = [num(r.values.noConsensus, S.editions[k][0]), num(r.values.consensus, S.editions[k][1])];
  }
  const pr = sec("prize");
  if (pr) for (const k of ["first", "second"]) { const r = pr.rows.find((x) => x.id === k); if (r) S.prize[k] = num(r.values.percent, S.prize[k]); }
  return S;
}

export function insertCost(kind, tiers, S = DEFAULTS) {
  const costs = kind === "straddle" ? S.straddleCosts : S.standardCosts;
  return costs.slice(0, tiers).reduce((a, b) => a + b, 0);
}

// ---------- utilities ----------

const COLORS = new Set(["red", "blue", "purple"]);
const toMs = (t) => (typeof t === "number" ? t : Date.parse(t));

function hashString(s) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seedString) {
  // mulberry32
  let a = hashString(seedString);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- validation ----------
// Returns { valid: {candidacies, demographics, votes}, errors: [...] }.
// Invalid entries are excluded from the tally and reported.

export function validate(input, S = settingsFrom(input.format)) {
  const errors = [];
  const races = new Set(input.races);
  const err = (type, id, reason) => errors.push({ type, id, reason });

  // Candidacies §4.1
  const candidacies = [];
  const seenCandidate = new Set();
  const seenCandidateRace = new Set();
  for (const c of input.candidacies || []) {
    if (!races.has(c.race)) { err("candidacy", c.id, `unknown race ${c.race}`); continue; }
    const kc = `${c.collector}|${c.candidate}`;
    const kr = `${c.collector}|${c.race}`;
    if (seenCandidate.has(kc)) { err("candidacy", c.id, "collector already ran this candidate"); continue; }
    if (seenCandidateRace.has(kr)) { err("candidacy", c.id, "collector already has a candidate in this race"); continue; }
    seenCandidate.add(kc); seenCandidateRace.add(kr);
    candidacies.push(c);
  }

  // Demographics §3
  const demographics = [];
  const byCollector = new Map();
  for (const d of input.demographics || []) {
    if (!byCollector.has(d.collector)) byCollector.set(d.collector, []);
    byCollector.get(d.collector).push(d);
  }
  for (const [collector, list] of byCollector) {
    const base = list.filter((d) => d.kind !== "straddle");
    const frees = base.filter((d) => d.kind === "free");
    const accepted = [];
    const teams = new Set();
    const teamColor = new Set();
    // free first, then added in submitted order
    for (const d of [...frees, ...base.filter((d) => d.kind === "added")]) {
      if (d.kind === "free" && accepted.some((a) => a.kind === "free")) { err("demographic", d.id, "only one free demographic"); continue; }
      if (teams.has(d.team)) { err("demographic", d.id, "team already declared; use a straddle for the other color"); continue; }
      if (teams.size >= S.maxTeams) { err("demographic", d.id, `${S.maxTeams}-team cap reached`); continue; }
      teams.add(d.team); teamColor.add(`${d.team}|${d.color}`);
      accepted.push(d);
    }
    for (const d of list.filter((d) => d.kind === "straddle")) {
      const other = d.color === "red" ? "blue" : "red";
      if (!teamColor.has(`${d.team}|${other}`)) { err("demographic", d.id, "straddle needs the same team declared in the other color"); continue; }
      if (teamColor.has(`${d.team}|${d.color}`)) { err("demographic", d.id, "team already declared in this color"); continue; }
      teamColor.add(`${d.team}|${d.color}`);
      accepted.push(d);
    }
    for (const d of accepted) {
      if (d.color !== "red" && d.color !== "blue") { err("demographic", d.id, "color must be red or blue"); continue; }
      if (!(d.tiers >= 1 && d.tiers <= S.capacity.length)) { err("demographic", d.id, `tiers must be 1–${S.capacity.length}`); continue; }
      const placements = d.placements || [];
      if (new Set(placements).size !== placements.length) { err("demographic", d.id, "demographic placed in the same race twice"); continue; }
      if (placements.length > S.capacity[d.tiers - 1]) { err("demographic", d.id, `more placements than capacity ${S.capacity[d.tiers - 1]}`); continue; }
      const bad = placements.find((r) => !races.has(r));
      if (bad) { err("demographic", d.id, `unknown race ${bad}`); continue; }
      demographics.push(d);
    }
  }

  // Votes §6.2
  const namesByRace = new Map();
  for (const c of candidacies) {
    if (!namesByRace.has(c.race)) namesByRace.set(c.race, new Set());
    namesByRace.get(c.race).add(c.candidate);
  }
  const votes = [];
  const seenVote = new Set();
  for (const v of input.votes || []) {
    if (!races.has(v.race)) { err("vote", v.id, `unknown race ${v.race}`); continue; }
    const k = `${v.collector}|${v.race}`;
    if (seenVote.has(k)) { err("vote", v.id, "one vote per collector per race"); continue; }
    const t = v.token || {};
    if (!COLORS.has(t.color)) { err("vote", v.id, "token color must be red, blue or purple"); continue; }
    if (![1, 2, 3].includes(t.multiplier)) { err("vote", v.id, "multiplier must be 1, 2 or 3"); continue; }
    let effective = t.color;
    if (t.color === "purple") {
      if (v.declared !== "red" && v.declared !== "blue") { err("vote", v.id, "purple token must declare red or blue"); continue; }
      effective = v.declared;
    }
    const names = namesByRace.get(v.race) || new Set();
    // Rules v13 §6.2: votes can be cast only in races with a candidate.
    if (names.size === 0) { err("vote", v.id, "no candidate in this race; votes are only possible where a candidate runs"); continue; }
    let candidate = null;
    if (names.size >= 2) {
      if (!names.has(v.candidate)) { err("vote", v.id, "contested race: vote must name a candidate in the race"); continue; }
      candidate = v.candidate;
    }
    seenVote.add(k);
    votes.push({ ...v, candidate, effective, ts: toMs(v.timestamp) });
  }

  return { valid: { candidacies, demographics, votes }, errors };
}

// ---------- tally ----------

// US result: "red" | "blue" | null (not yet called). Any other value
// (an independent or third-party winner) is treated as "purple".
function normalizeUs(u) {
  if (u === undefined || u === null) return null;
  return u === "red" || u === "blue" ? u : "purple";
}

const editionsFor = (consensus, noCons, withCons) =>
  consensus === null
    ? { editions: noCons, pending: true, editionsIfConsensus: withCons }
    : { editions: consensus ? withCons : noCons, pending: false };

export function tally(input) {
  const seed = input.seed || "unseeded";
  const S = settingsFrom(input.format);
  const E = S.editions;
  const { valid, errors } = validate(input, S);
  const usResults = input.usResults || {};
  const rulings = [];

  const activePlacements = [];
  for (const d of valid.demographics) {
    if (d.voided) continue;
    for (const race of d.placements) activePlacements.push({ race, color: d.color, demographic: d.id, collector: d.collector, ts: toMs(d.timestamp) });
  }

  const races = [];
  const voteResults = [];
  const candidateResults = [];
  const transfers = [];
  const wheels = {};

  for (const raceId of input.races) {
    const cands = valid.candidacies.filter((c) => c.race === raceId);
    const names = [...new Set(cands.map((c) => c.candidate))];
    const hasCandidate = names.length > 0;
    const contested = names.length >= 2;
    const rv = valid.votes.filter((v) => v.race === raceId);
    const pl = activePlacements.filter((p) => p.race === raceId);

    // §5.1 race color
    const placementRed = pl.filter((p) => p.color === "red").length;
    const placementBlue = pl.filter((p) => p.color === "blue").length;
    const voteRed = rv.filter((v) => v.effective === "red").reduce((s, v) => s + v.token.multiplier, 0);
    const voteBlue = rv.filter((v) => v.effective === "blue").reduce((s, v) => s + v.token.multiplier, 0);
    const red = placementRed + voteRed;
    const blue = placementBlue + voteBlue;
    let color = red > blue ? "red" : blue > red ? "blue" : "purple";
    // VACANT: no votes and no placements at all. No color, no editions.
    const vacant = rv.length === 0 && pl.length === 0;
    if (vacant) color = null;

    // §5.2 winning candidate
    let winner = null;
    let decidedByTimestamp = false;
    let colorOnly = false; // race has a color but no candidate is paid
    const candidateVotes = {};
    if (contested) {
      // Candidate support = votes (with multipliers) + placements made by the
      // collector(s) who ran that candidate in this race (1 each).
      const runner = new Map(); // collector -> candidate in this race
      for (const c of cands) runner.set(c.collector, c.candidate);
      const firstVote = {};
      const firstPlacement = {};
      for (const n of names) candidateVotes[n] = 0;
      for (const v of rv) {
        candidateVotes[v.candidate] += v.token.multiplier;
        if (firstVote[v.candidate] === undefined || v.ts < firstVote[v.candidate]) firstVote[v.candidate] = v.ts;
      }
      for (const p of pl) {
        const n = runner.get(p.collector);
        if (n === undefined) continue;
        candidateVotes[n] += 1;
        if (firstPlacement[n] === undefined || p.ts < firstPlacement[n]) firstPlacement[n] = p.ts;
      }
      const max = Math.max(...names.map((n) => candidateVotes[n]));
      const tied = names.filter((n) => candidateVotes[n] === max);
      if (max === 0) {
        // No votes and no placements from candidates' collectors. Other
        // placements still set the race color; no candidate wins or is paid.
        if (!vacant) colorOnly = true;
      } else if (tied.length === 1) {
        winner = tied[0];
      } else {
        // Tie-break: earliest vote if any tied candidate has votes; otherwise earliest placement.
        const byVote = tied.filter((n) => firstVote[n] !== undefined).sort((a, b) => firstVote[a] - firstVote[b]);
        const byPlacement = tied.filter((n) => firstPlacement[n] !== undefined).sort((a, b) => firstPlacement[a] - firstPlacement[b]);
        winner = byVote.length ? byVote[0] : byPlacement[0];
        decidedByTimestamp = true;
        // Rules v18 §5.2: the first vote (or placement) picks the winning candidate; the race keeps the color
        // its red and blue totals set. Only a red/blue tie makes a race purple (§5.1).
      }
    } else if (hasCandidate && !vacant) {
      winner = names[0]; // lone candidate: any vote or any placement = full payout
    }

    // §5.3 consensus: true / false / null (US result pending).
    // A US winner who is neither red nor blue is "purple": only a purple
    // Grotto race has consensus there, and no vote can call it correctly.
    const us = normalizeUs(usResults[raceId]);
    const consensus = vacant ? false : us === null ? null : color === us;

    // §4.2 candidate editions
    for (const c of cands) {
      let r;
      if (winner === null || c.candidate !== winner) r = { editions: 0, pending: false };
      else r = editionsFor(consensus, ...E.candidate);
      candidateResults.push({ candidacy: c.id, collector: c.collector, candidate: c.candidate, race: raceId, won: c.candidate === winner, ...r });
    }

    // §6.3 token outcomes + §6.4 vote editions
    const outcomes = [];
    for (const v of rv) {
      let outcome;
      let editions = { editions: 0, pending: false };
      if (!hasCandidate) {
        outcome = "returned"; // participation only
      } else if (color === "purple") {
        outcome = "burned";
        editions = editionsFor(consensus, ...E.purpleVoter); // purple consensus (independent US winner) adds the bonus
      } else {
        const forWinner = !contested || v.candidate === winner;
        if (color === "blue") outcome = "burned";
        else if (v.token.color === "red") outcome = forWinner ? "returned" : "burned";
        else if (v.token.color === "blue") outcome = v.token.kind === "trait" ? "burned" : "redistributed";
        else outcome = "burned"; // purple tokens always burn
        if (!contested) {
          editions = v.effective === color ? editionsFor(consensus, ...E.uncontestedMatch) : { editions: 0, pending: false };
        } else if (forWinner) {
          editions = v.effective === color ? editionsFor(consensus, ...E.contestedWinnerColor) : editionsFor(consensus, ...E.contestedWinner);
        }
      }
      outcomes.push({ v, outcome, editions });
    }

    // Blue-token redistribution in red races
    if (color === "red" && hasCandidate) {
      const pool = outcomes.filter((o) => o.outcome === "redistributed");
      // Only red tokens share; purple declared red counts as a red vote but burns and receives nothing.
      const recipients = outcomes.filter((o) => o.v.token.color === "red" && (!contested || o.v.candidate === winner));
      if (pool.length && !recipients.length) {
        for (const o of pool) o.outcome = "burned";
        rulings.push({ race: raceId, issue: "red race with blue tokens but no eligible red voters; blue tokens burned by default" });
      } else if (pool.length) {
        const weight = new Map();
        for (const o of recipients) weight.set(o.v.collector, (weight.get(o.v.collector) || 0) + o.v.token.multiplier);
        const W = [...weight.values()].reduce((a, b) => a + b, 0);
        const n = pool.length;
        const share = new Map();
        let assigned = 0;
        for (const [c, w] of weight) { const s = Math.floor((n * w) / W); share.set(c, s); assigned += s; }
        // Wheel: one slot per red vote (a x3 token = 3 slots). Spun once per
        // remainder token, every slot available on every spin.
        const rand = rng(`${seed}|${raceId}|wheel`);
        const slots = [];
        for (const o of recipients.slice().sort((x, y) => x.v.ts - y.v.ts || (x.v.id < y.v.id ? -1 : 1)))
          for (let m = 0; m < o.v.token.multiplier; m++) slots.push(o.v.collector);
        const wheelLog = [];
        for (let k = assigned; k < n; k++) {
          const c = slots[Math.floor(rand() * slots.length)];
          share.set(c, share.get(c) + 1);
          wheelLog.push(c);
        }
        const dealt = shuffle(pool.slice().sort((a, b) => a.v.ts - b.v.ts || (a.v.id < b.v.id ? -1 : 1)), rng(`${seed}|${raceId}|deal`));
        let i = 0;
        for (const [c] of [...share.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
          for (let s = 0; s < share.get(c); s++, i++) {
            const o = dealt[i];
            transfers.push({ race: raceId, vote: o.v.id, token: o.v.token.id, from: o.v.collector, to: c });
            o.to = c;
          }
        }
        wheels[raceId] = wheelLog;
      }
    }

    for (const { v, outcome, editions, to } of outcomes) {
      voteResults.push({
        vote: v.id, collector: v.collector, race: raceId, token: v.token.id, tokenColor: v.token.color,
        kind: v.token.kind, effective: v.effective, candidate: v.candidate,
        outcome: v.token.kind === "trait" && outcome === "returned" ? "kept" : outcome,
        ...(to ? { awardedTo: to } : {}),
        ...editions,
      });
    }

    races.push({
      race: raceId, color, red, blue, placementRed, placementBlue, voteRed, voteBlue,
      status: vacant ? "vacant" : colorOnly ? "color-only" : "decided",
      hasCandidate, contested, vacant, colorOnly, candidates: names, candidateVotes, winner, decidedByTimestamp,
      usResult: us, consensus,
    });
  }

  // §7 prediction prize
  const scores = new Map();
  let anyPending = false;
  for (const v of valid.votes) {
    const us = normalizeUs(usResults[v.race]);
    if (us === null) anyPending = true;
    if (!scores.has(v.collector)) scores.set(v.collector, { collector: v.collector, correct: 0, called: 0 });
    const s = scores.get(v.collector);
    s.called += 1;
    if (us !== null && v.effective === us) s.correct += 1;
  }
  const pool = valid.demographics.reduce((s, d) => s + insertCost(d.kind, d.tiers, S), 0);
  const prize = prediction([...scores.values()], pool, S.prize);
  prize.pending = anyPending;

  return { races, candidates: candidateResults, votes: voteResults, transfers, wheel: wheels, prize, errors, rulings };
}

export function prediction(scoreList, pool, prizePct = DEFAULTS.prize) {
  const P1 = prizePct.first, P2 = prizePct.second;
  const ranked = scoreList.slice().sort((a, b) => b.correct - a.correct || (a.collector < b.collector ? -1 : 1));
  const result = { pool, ranked, first: [], second: [], awards: [] };
  if (!ranked.length) return result;
  const top = ranked[0].correct;
  const first = ranked.filter((s) => s.correct === top).map((s) => s.collector);
  let second = [];
  if (first.length === 1) {
    const rest = ranked.filter((s) => s.correct < top);
    if (rest.length) second = rest.filter((s) => s.correct === rest[0].correct).map((s) => s.collector);
  }
  const fullPct = P1 * first.length + P2 * second.length;
  const capped = fullPct > 100;
  const pct1 = capped ? (P1 / fullPct) * 100 : P1;
  const pct2 = capped ? (P2 / fullPct) * 100 : P2;
  for (const c of first) result.awards.push({ collector: c, place: 1, percent: pct1, inserts: Math.floor((pool * pct1) / 100) });
  for (const c of second) result.awards.push({ collector: c, place: 2, percent: pct2, inserts: Math.floor((pool * pct2) / 100) });
  Object.assign(result, { first, second, capped });
  return result;
}
