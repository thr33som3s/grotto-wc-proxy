// 2026 3l3ction: schedule, races, and the candidate pool. Times are UTC.
//   Candidacy    commit  Wed Oct 28 12:00am–11:59pm EDT   confirm Thu Oct 29 12:01am–11:59pm EDT
//   Demographics commit  Fri Oct 30 12:00am–11:59pm EDT   confirm Sat Oct 31 12:01am–11:59pm EDT
//   Voting       commit  Sun Nov 1 12:00am EDT–11:59pm EST confirm Mon Nov 2 12:01am–11:59pm EST
import { COLLECTIONS, buildCollection } from "./catalog.js";

export const PHASES = {
  candidacy:    { commitOpens: "2026-10-28T04:00:00Z", commitCloses: "2026-10-29T03:59:59Z", confirmOpens: "2026-10-29T04:01:00Z", confirmCloses: "2026-10-30T03:59:59Z" },
  demographics: { commitOpens: "2026-10-30T04:00:00Z", commitCloses: "2026-10-31T03:59:59Z", confirmOpens: "2026-10-31T04:01:00Z", confirmCloses: "2026-11-01T03:59:59Z" },
  voting:       { commitOpens: "2026-11-01T04:00:00Z", commitCloses: "2026-11-02T04:59:59Z", confirmOpens: "2026-11-02T05:01:00Z", confirmCloses: "2026-11-03T04:59:59Z" },
};
// Preview deployments can set COMMIT_TEST_MODE=1: windows are always open and entries are stored
// under "<phase>-test", so testing never touches the real event.
export const TEST_MODE = process.env.COMMIT_TEST_MODE === "1";
export const storedPhase = (phase) => (TEST_MODE ? `${phase}-test` : phase);
export function windowState(phase, now = Date.now()) {
  const p = PHASES[phase];
  if (!p) return null;
  const t = (s) => Date.parse(s);
  const commitOpen = TEST_MODE || (now >= t(p.commitOpens) && now <= t(p.commitCloses));
  const confirmOpen = TEST_MODE || (now >= t(p.confirmOpens) && now <= t(p.confirmCloses));
  return { ...p, commitOpen, confirmOpen, testMode: TEST_MODE };
}

export const RACES = [["AL","Alabama"],["AK","Alaska"],["AR","Arkansas"],["CO","Colorado"],["DE","Delaware"],["FL","Florida (special)"],["GA","Georgia"],["ID","Idaho"],["IL","Illinois"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MT","Montana"],["NE","Nebraska"],["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NC","North Carolina"],["OH","Ohio (special)"],["OK","Oklahoma"],["OR","Oregon"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["VA","Virginia"],["WV","West Virginia"],["WY","Wyoming"]];
export const RACE_CODES = new Set(RACES.map(([c]) => c));

// univ3rs3 metadata, read once per warm instance for 2 minutes.
let univMemo = null;
export const resetUniv3rs3Memo = () => { univMemo = null; }; // for tests
export async function univ3rs3Tokens(key) {
  if (univMemo && Date.now() - univMemo.at < 120000) return univMemo.tokens;
  const c = COLLECTIONS.find((x) => x.key === "univ3rs3");
  const api = "https://sheets.googleapis.com/v4/spreadsheets";
  const meta = await (await fetch(`${api}/${c.sheet}?fields=sheets.properties.title&key=${key}`)).json();
  const title = meta.sheets[0].properties.title;
  const data = await (await fetch(`${api}/${c.sheet}/values/${encodeURIComponent(`'${title}'!A:BF`)}?key=${key}`)).json();
  const tokens = buildCollection(c, data.values || []);
  univMemo = { at: Date.now(), tokens };
  return tokens;
}
const lc = (v) => String(v || "").toLowerCase();

// Candidate pool: univ3rs3 Base cards whose team is Candidates (rules §4.1, builder pool "Candidates").
export async function candidatePool(key) {
  return new Map((await univ3rs3Tokens(key))
    .filter((t) => lc(t.traits.team) === "candidates" && lc(t.traits.card_type) === "base")
    .map((t) => [t.key, t]));
}

// ── Demographics (rules §3) ──────────────────────────────────────
// Team demographics: univ3rs3 Base, Painted and Award cards of these teams. Participants: any univ3rs3
// Participants card except Madn3ss. Insert demographics: these exact tokens.
export const TEAM_DEMOGRAPHICS = ["NFTs", "Monsters", "Exes", "Subs", "Cat Moms", "Cardinali", "Coders", "Elephant Men"];
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const u = (ids) => ids.map((i) => `univ3rs3:${i}`);
export const TOKEN_DEMOGRAPHICS = {
  "Leathers": u(range(319002, 319005)),
  "Dads to Be": u([313001, 313002, 313003, 318010, 80004]),
  "Daddies to Be": u(range(34401, 34404)),
  "High Waisted Brothers": u([317017]),
  "Stadium Parking Attendants": u([318020]),
  "Trash Bros": ["univ3rs3:319009", "bulk:319007", "bulk:319008"],
  "Dead Dads": u(range(11001, 11004)),
  "Butchers": u(range(11005, 11008)),
  "Lab Rats": u(range(11009, 11012)),
};
const TOKEN_DEMO_BY_KEY = Object.fromEntries(Object.entries(TOKEN_DEMOGRAPHICS).flatMap(([d, ks]) => ks.map((k) => [k, d])));
// The demographic a piece belongs to, or null. t: a catalog token ({ key, coll, traits }).
export function demographicOf(t) {
  if (TOKEN_DEMO_BY_KEY[t.key]) return TOKEN_DEMO_BY_KEY[t.key];
  if (t.coll !== "univ3rs3") return null;
  const team = TEAM_DEMOGRAPHICS.find((x) => lc(x) === lc(t.traits.team));
  const type = lc(t.traits.card_type);
  if (team && ["base", "painted", "award"].includes(type)) return team;
  if (lc(t.traits.team) === "participants" && type !== "madn3ss") return "Participants";
  return null;
}
// Burnable inserts (rules §3.2): any univ3rs3 Insert, and any bulk piece.
export const isBurnable = (t) => t.coll === "bulk" || (t.coll === "univ3rs3" && lc(t.traits.card_type) === "insert");

// Placement scale (rules §3.2, §3.4). Level n (1–6) gives CAPACITY[n-1] placements.
export const CAPACITY = [5, 10, 15, 20, 25, 35];
const STANDARD = [0, 500, 400, 300, 200, 100];
const STRADDLE = [500, 500, 400, 300, 200, 100];
export const insertCost = (kind, tiers) => (kind === "straddle" ? STRADDLE : STANDARD).slice(0, tiers).reduce((a, b) => a + b, 0);

// The pledge every collector signs with their entry (thr33s's wording).
export const COMMIT_PLEDGE = "YOU ARE COMMITTING THESE TOKENS TO BURN. THIS IS A SACRED ACT IN THE PROJECT. DO NOT SELL OR TRADE ANY OF YOUR COMMITS BEFORE THE CONFIRMATION WINDOW. YOU ARE RESPONSIBLE FOR BURNING THESE COMMITS, ANY FAILURE TO DO SO WILL RESULT IN SANCTIONS IN THE PROJECT AND MAY JEOPARDIZE YOUR PARTICIPATION IN THIS 3V3NT.";

// The exact text a collector signs for their candidacy entry.
export function candidacyMessage(wallet, entries, names, issuedAt) {
  const lines = entries.slice().sort((a, b) => (a.race < b.race ? -1 : 1)).map((e) => `${e.race}: ${names[e.candidate] || e.candidate} (${e.candidate})`);
  return `thr33som3s 2026 3l3ction\ncandidacy entry: final, one per collector\n\nwallet: ${wallet}\nsigned: ${issuedAt}\n\n${lines.join("\n")}\n\n${COMMIT_PLEDGE}\n\nSigning is free and moves nothing now.`;
}

// Where committed pieces go (rules: candidates and team cards burn via 333burn; inserts and votes to 3vault).
export const DESTINATIONS = {
  "333burn": "0x3d373231a0a60bb6203fd1a91e3f058100c2244d",
  "3vault": "0xe5a97ce51460114e13b632df211896c663cbae76",
};

// Confirmation status for any committed pieces. items: [{ key, dest: "333burn" | "3vault", qty }].
// Counts what the ledger shows moving from the wallet to each item's destination between fromMs and toMs.
// Returns { "key>dest": { key, dest, qty, sent, txs: [...] } }.
export function sentTo(items, wallet, transfers, fromMs, toMs) {
  const out = {};
  for (const it of items) { const k = `${it.key}>${it.dest}`; out[k] = out[k] || { key: it.key, dest: it.dest, qty: 0, sent: 0, txs: [] }; out[k].qty += it.qty; }
  const byDest = Object.fromEntries(Object.entries(DESTINATIONS).map(([n, a]) => [a, n]));
  for (const t of transfers) {
    const o = out[`${t.key}>${byDest[t.to]}`];
    if (!o || t.from !== wallet) continue;
    const at = Date.parse(t.time);
    if (!(at >= fromMs && at <= toMs)) continue;
    o.sent += t.amount;
    if (!o.txs.includes(t.tx)) o.txs.push(t.tx);
  }
  return out;
}
// The window a phase's confirmations count in (rehearsal mode: any time after the entry was submitted).
export function confirmSpan(entry, win) {
  return TEST_MODE ? [Date.parse(entry.submitted_at), Infinity] : [Date.parse(win.confirmOpens), Date.parse(win.confirmCloses)];
}

// Candidacy: each committed candidate is one edition to 333burn. Returns { key: { tx, time } } for those burned.
export function candidacyBurns(entry, wallet, transfers, win) {
  const items = (entry?.payload?.entries || []).map((e) => ({ key: e.candidate, dest: "333burn", qty: 1 }));
  const [from, to] = confirmSpan(entry, win);
  const st = sentTo(items, wallet, transfers, from, to);
  const out = {};
  for (const v of Object.values(st)) if (v.sent >= 1) out[v.key] = { tx: v.txs[0] };
  return out;
}

// What a demographics entry moves: added-team cards to 333burn (1 each), inserts to 3vault.
export function demographicsItems(payload) {
  const items = [];
  for (const d of payload.demographics || []) if (d.kind === "added") items.push({ key: d.card, dest: "333burn", qty: 1 });
  for (const i of payload.inserts || []) items.push({ key: i.key, dest: "3vault", qty: i.qty });
  return items;
}

// Rules §3: checks a demographics entry against the collector's holdings.
// tokens: Map key -> catalog token (univ3rs3); held: Map key -> balance (any collection).
export function checkDemographics(payload, tokens, held) {
  const out = [];
  const order = { free: 0, added: 1, straddle: 2 };
  const demos = (Array.isArray(payload.demographics) ? payload.demographics : []).slice().sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3));
  const inserts = Array.isArray(payload.inserts) ? payload.inserts : [];
  if (!demos.length) out.push("add at least one demographic");
  const tok = (k) => tokens.get(k) || (k.startsWith("bulk:") ? { key: k, coll: "bulk", traits: {} } : null);
  const use = new Map(); const addUse = (k, n) => use.set(k, (use.get(k) || 0) + n);
  const teams = new Map(); // team -> color (free/added)
  let free = 0, added = 0, cost = 0;
  const straddled = new Set();
  for (const d of demos) {
    if (!["free", "added", "straddle"].includes(d.kind)) { out.push("unknown demographic kind"); continue; }
    if (d.color !== "red" && d.color !== "blue") out.push("each demographic needs red or blue");
    const tiers = Number(d.tiers);
    if (!(Number.isInteger(tiers) && tiers >= 1 && tiers <= 6)) { out.push("block level must be 1 to 6"); continue; }
    const races = Array.isArray(d.races) ? d.races : [];
    if (new Set(races).size !== races.length) out.push("a demographic can be placed in a race only once");
    if (races.some((r) => !RACE_CODES.has(r))) out.push("unknown race");
    if (races.length > CAPACITY[tiers - 1]) out.push(`too many races for ${CAPACITY[tiers - 1]} placements`);
    // Every placement paid for must be placed.
    if (races.length < CAPACITY[tiers - 1]) out.push(`${d.team || "a demographic"} (${d.color || "no color"}): ${races.length} of ${CAPACITY[tiers - 1]} placements placed; place ${CAPACITY[tiers - 1] - races.length} more`);
    cost += insertCost(d.kind, tiers);
    if (d.kind === "straddle") {
      const other = teams.get(d.team);
      if (!other) out.push(`straddle: declare ${d.team} first`);
      else if (other === d.color) out.push(`straddle: ${d.team} must be the other color`);
      if (straddled.has(d.team)) out.push(`only one straddle for ${d.team}`);
      straddled.add(d.team);
      continue;
    }
    const t = d.card && tok(d.card);
    const team = t && demographicOf(t);
    if (!team) { out.push("choose a demographic card"); continue; }
    if (d.team && d.team !== team) out.push("card and demographic don't match");
    if (teams.has(team)) out.push(`${team} is already one of your teams; use a straddle for the other color`);
    teams.set(team, d.color);
    d.team = team;
    if (d.kind === "free") { free++; addUse(d.card, 1); } else { added++; addUse(d.card, 1); }
  }
  if (free > 1) out.push("only one free demographic");
  if (added > 4) out.push("at most 4 added teams");
  let total = 0;
  for (const i of inserts) {
    const q = Number(i.qty), t = tok(i.key);
    if (!(Number.isInteger(q) && q >= 1)) { out.push("insert quantities must be whole numbers"); continue; }
    if (!t || !isBurnable(t)) { out.push(`${i.key} isn't a burnable insert`); continue; }
    addUse(i.key, q); total += q;
  }
  if (total !== cost) out.push(`your placements cost ${cost} inserts but ${total} are selected`);
  for (const [k, n] of use) if ((held.get(k) || 0) < n) out.push(`you don't hold enough of ${tokens.get(k)?.name || k} (need ${n}, hold ${held.get(k) || 0})`);
  return { problems: [...new Set(out)], cost };
}

// The exact text a collector signs for their demographics entry.
export function demographicsMessage(wallet, payload, names, issuedAt) {
  const nm = (k) => names[k] || k;
  const lines = (payload.demographics || []).map((d) => {
    const base = `${d.kind} · ${d.team} (${d.color}) · ${CAPACITY[d.tiers - 1]} placements · races: ${(d.races || []).join(", ") || "none"}`;
    if (d.kind === "free") return `${base}\n  card held, keep at least 1: ${nm(d.card)}`;
    if (d.kind === "added") return `${base}\n  card to burn (333burn): ${nm(d.card)}`;
    return base;
  });
  const ins = (payload.inserts || []).map((i) => `  ${nm(i.key)} x${i.qty}`);
  const total = (payload.inserts || []).reduce((a, i) => a + Number(i.qty), 0);
  return `thr33som3s 2026 3l3ction\ndemographics entry: final, one per collector\n\nwallet: ${wallet}\nsigned: ${issuedAt}\n\n${lines.join("\n")}\n\ninserts to 3vault: ${total}\n${ins.join("\n")}\n\n${COMMIT_PLEDGE}\n\nSigning is free and moves nothing now.`;
}

// ── The 3l3ction map (public) ────────────────────────────────────
// Contested races and their candidate names, from candidacy entries whose burns were confirmed.
// Revealed only once candidacy confirmations have closed (rules §6.2: ballots show contested races only).
export function contestedBallots(entries, transfers, candidateNames) {
  const win = windowState("candidacy");
  const byRace = new Map();
  for (const e of entries) {
    const burned = candidacyBurns({ submitted_at: e.submitted_at, payload: e.payload }, e.wallet, transfers, win);
    for (const x of e.payload?.entries || []) {
      if (!burned[x.candidate]) continue;            // only candidates actually burned run
      const name = candidateNames[x.candidate] || x.candidate;
      if (!byRace.has(x.race)) byRace.set(x.race, new Set());
      byRace.get(x.race).add(name);
    }
  }
  const out = {};
  for (const [race, names] of byRace) if (names.size >= 2) out[race] = [...names].sort();
  return out;
}

// ── Sorted views for the private store ───────────────────────────
// Sent with each entry so the store can keep tabs that read in order (who runs what, where).
const RACE_NAME = Object.fromEntries(RACES);
export function candidacyIndex(entries, names, wallet, username) {
  return [{ tab: "candidacies", header: ["race", "state", "candidate", "token", "collector", "wallet"], sortBy: [1, 3],
    rows: entries.map((e) => [e.race, RACE_NAME[e.race] || "", names[e.candidate] || e.candidate, e.candidate, username || "", wallet]) }];
}
export function demographicsIndex(payload, names, wallet, username) {
  const nm = (k) => names[k] || k;
  const placements = [];
  for (const d of payload.demographics) for (const r of d.races)
    placements.push([r, RACE_NAME[r] || "", d.team, d.color, d.kind, d.card ? nm(d.card) : "", username || "", wallet]);
  return [
    { tab: "placements", header: ["race", "state", "demographic", "color", "kind", "card", "collector", "wallet"], sortBy: [1, 3, 4], rows: placements },
    { tab: "inserts", header: ["insert", "token", "quantity", "collector", "wallet"], sortBy: [4, 1],
      rows: payload.inserts.map((i) => [nm(i.key), i.key, i.qty, username || "", wallet]) },
  ];
}
