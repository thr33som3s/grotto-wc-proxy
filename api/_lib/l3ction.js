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

// Candidate pool: univ3rs3 Base cards whose team is Candidates (rules §4.1, builder pool "Candidates").
export async function candidatePool(key) {
  const c = COLLECTIONS.find((x) => x.key === "univ3rs3");
  const api = "https://sheets.googleapis.com/v4/spreadsheets";
  const meta = await (await fetch(`${api}/${c.sheet}?fields=sheets.properties.title&key=${key}`)).json();
  const title = meta.sheets[0].properties.title;
  const data = await (await fetch(`${api}/${c.sheet}/values/${encodeURIComponent(`'${title}'!A:BF`)}?key=${key}`)).json();
  return new Map(buildCollection(c, data.values || [])
    .filter((t) => String(t.traits.team || "").toLowerCase() === "candidates" && String(t.traits.card_type || "").toLowerCase() === "base")
    .map((t) => [t.key, t]));
}

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

// Which committed candidates the ledger shows arriving at 333burn from the collector during the
// confirmation window (in rehearsal mode: any time after the entry was submitted).
// Returns { "univ3rs3:10010": { tx, time }, ... }.
export function candidacyBurns(entry, wallet, transfers, win) {
  const want = new Set((entry?.payload?.entries || []).map((e) => e.candidate));
  const from = TEST_MODE ? Date.parse(entry.submitted_at) : Date.parse(win.confirmOpens);
  const to = TEST_MODE ? Infinity : Date.parse(win.confirmCloses);
  const out = {};
  for (const t of transfers) {
    if (t.from !== wallet || t.to !== DESTINATIONS["333burn"] || !want.has(t.key) || t.amount < 1) continue;
    const at = Date.parse(t.time);
    if (!(at >= from && at <= to)) continue;
    if (!out[t.key]) out[t.key] = { tx: t.tx, time: t.time };
  }
  return out;
}
