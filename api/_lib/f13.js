// Friday the 13th 3v3nt (Nov 13, 2026): claim editions of thr33s's new Stan Thomas painting.
//   Hold: one claim per qualifying token held at the snapshot (ledger tab "snapshot-f13", the ledger run of
//         Fri Nov 13, 11:30:22am EST), regardless of editions held.
//   Burn: one claim per edition of a burnable token sent to 333burn during the window, no cap.
// One entry per collector, final: the tokens cited and the burns committed. Burns count only when the ledger
// sees them arrive at 333burn from the collector's wallet before the close, up to the amount committed.
// Nothing is hidden: there is no competition.

export const F13 = {
  opens: "2026-11-13T16:00:00Z",          // Fri Nov 13, 11:00am EST (live as soon as the page is released)
  closes: "2026-11-14T07:59:59Z",         // Fri Nov 13, 11:59:59pm PST
  snapshotTab: "snapshot-f13",
  snapshotAt: "2026-11-13T16:30:22Z",     // the ledger run the snapshot copies (11:30:22am EST)
};

export const F13_HOLD = [
  "univ3rs3:93009", "univ3rs3:34235", "univ3rs3:3009",
  // thr33zi3s with the Stan Thomas trait: gen2 face/mouth, gen3 face/eyes (gen1 has none)
  "gen2:1019", "gen2:1042", "gen2:1080", "gen2:1082", "gen2:1092", "gen2:1094", "gen2:1098",
  "gen3:2003", "gen3:2065", "gen3:2087",
];
export const F13_BURN = [
  "univ3rs3:70069", "univ3rs3:70071", "univ3rs3:317004", "univ3rs3:317006", "univ3rs3:317010", "univ3rs3:317011",
  "bulk:9", "bulk:319027", "bulk:319030",
];
const HOLD = new Set(F13_HOLD), BURN = new Set(F13_BURN);
export const f13Collections = () => [...new Set([...F13_HOLD, ...F13_BURN].map((k) => k.split(":")[0]))];

export function f13Window(now = Date.now(), testMode = false) {
  const open = testMode || (now >= Date.parse(F13.opens) && now <= Date.parse(F13.closes));
  return { opens: F13.opens, closes: F13.closes, open, closed: !testMode && now > Date.parse(F13.closes), testMode, snapshotAt: F13.snapshotAt };
}

// snapshot rows: [{ key, wallet, balance }] -> the qualifying hold tokens this wallet held at the snapshot.
export function snapshotHolds(rows, wallet) {
  const w = String(wallet || "").toLowerCase();
  return [...new Set(rows.filter((r) => r.wallet === w && r.balance > 0 && HOLD.has(r.key)).map((r) => r.key))];
}

// payload: { holds: [key], burns: [{ key, qty }] }. snapHeld: Set of keys held at the snapshot;
// live: Map key -> current balance (ledger). Returns a list of problems (empty when the entry is valid).
export function checkF13(payload, snapHeld, live) {
  const out = [];
  const holds = Array.isArray(payload.holds) ? payload.holds : [];
  const burns = Array.isArray(payload.burns) ? payload.burns : [];
  const seen = new Set();
  for (const k of holds) {
    if (!HOLD.has(k)) out.push(`${k} doesn't qualify for a holding claim`);
    else if (!snapHeld.has(k)) out.push(`your wallet didn't hold ${k} at the snapshot`);
    if (seen.has(k)) out.push(`${k} is cited twice`);
    seen.add(k);
  }
  const bseen = new Set();
  for (const b of burns) {
    const q = Number(b.qty);
    if (!BURN.has(b.key)) out.push(`${b.key} isn't a burnable token for this 3v3nt`);
    else if (!(Number.isInteger(q) && q >= 1)) out.push(`choose a whole number of ${b.key} to burn`);
    else if (q > (live.get(b.key) || 0)) out.push(`you hold only ${live.get(b.key) || 0} of ${b.key}`);
    if (bseen.has(b.key)) out.push(`${b.key} is listed twice`);
    bseen.add(b.key);
  }
  if (!holds.length && !burns.length) out.push("cite a token you hold or choose something to burn");
  return out;
}

export const f13Claims = (payload) => (payload.holds || []).length + (payload.burns || []).reduce((a, b) => a + Number(b.qty), 0);

// sent: { "key>333burn": { sent } } from sentTo. Counts each burn up to the amount committed.
export function f13Confirmed(payload, sent) {
  const burned = {};
  let burnClaims = 0;
  for (const b of payload.burns || []) {
    const s = Math.min(Number(b.qty), (sent[`${b.key}>333burn`] || {}).sent || 0);
    burned[b.key] = s; burnClaims += s;
  }
  const holdClaims = (payload.holds || []).length;
  return { holdClaims, burnClaims, burned, claims: holdClaims + burnClaims };
}

export function f13Message(wallet, payload, names, issuedAt) {
  const nm = (k) => names[k] || k;
  const holds = (payload.holds || []).map((k) => `  ${nm(k)}`);
  const burns = (payload.burns || []).map((b) => `  ${nm(b.key)} x${b.qty}`);
  return `thr33som3s friday the 13th 3v3nt\nentry: final, one per collector\n\nwallet: ${wallet}\nsigned: ${issuedAt}\n\n`
    + `held at the snapshot (1 claim each): ${holds.length}\n${holds.join("\n") || "  none"}\n\n`
    + `to burn at 333burn (1 claim per edition): ${(payload.burns || []).reduce((a, b) => a + Number(b.qty), 0)}\n${burns.join("\n") || "  none"}\n\n`
    + `claims if every burn arrives by the close: ${f13Claims(payload)}\n\nSigning is free and moves nothing now.`;
}
