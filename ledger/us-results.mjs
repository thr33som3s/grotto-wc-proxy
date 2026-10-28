// Election-night job: reads the US Senate results and writes one row per Grotto race to the "us-results"
// tab of the ledger sheet: race, called, winner, party, color, source, updated, override.
// Primary source: the New York Times' public results file (AP-sourced). It returns 404 until election night.
// The parser walks the file for race objects instead of assuming one exact layout, so a small format
// change on the night doesn't break it. The "override" column is thr33s's; it is never overwritten.
const SHEET = process.env.LEDGER_SHEET_ID, TOKEN = process.env.GOOGLE_ACCESS_TOKEN;
const DATE = process.env.ELECTION_DATE || "2026-11-03";
const URL = `https://static01.nyt.com/elections-assets/pages/data/${DATE}/results-senate.json`;
const log = (...a) => console.log(new Date().toISOString(), ...a);

export const RACES = ["AL","AK","AR","CO","DE","FL","GA","ID","IL","IA","KS","KY","LA","ME","MA","MI","MN","MS","MT","NE","NH","NJ","NM","NC","OH","OK","OR","RI","SC","SD","TN","TX","VA","WV","WY"];
const STATE_NAMES = { alabama:"AL", alaska:"AK", arkansas:"AR", colorado:"CO", delaware:"DE", florida:"FL", georgia:"GA", idaho:"ID", illinois:"IL", iowa:"IA", kansas:"KS", kentucky:"KY", louisiana:"LA", maine:"ME", massachusetts:"MA", michigan:"MI", minnesota:"MN", mississippi:"MS", montana:"MT", nebraska:"NE", "new hampshire":"NH", "new jersey":"NJ", "new mexico":"NM", "north carolina":"NC", ohio:"OH", oklahoma:"OK", oregon:"OR", "rhode island":"RI", "south carolina":"SC", "south dakota":"SD", tennessee:"TN", texas:"TX", virginia:"VA", "west virginia":"WV", wyoming:"WY" };

// Party text -> Grotto color: Republican red, Democratic blue, anyone else (independent, third party) purple (§5.3).
export function colorOf(party) {
  const p = String(party || "").toLowerCase();
  if (/^(r|rep|gop)$|republican/.test(p)) return "red";
  if (/^(d|dem)$|democrat/.test(p)) return "blue";
  return p ? "purple" : "";
}
function stateOf(o) {
  for (const k of ["state_id", "state_postal", "state_abbrev", "postal", "state"]) {
    const v = o[k]; if (typeof v === "string" && /^[A-Za-z]{2}$/.test(v.trim())) return v.trim().toUpperCase();
  }
  for (const k of ["state_name", "state", "name"]) {
    const v = o[k]; if (typeof v === "string" && STATE_NAMES[v.trim().toLowerCase()]) return STATE_NAMES[v.trim().toLowerCase()];
  }
  return null;
}
const isWinner = (c) => c && (c.winner === true || c.won === true || c.is_winner === true || c.winner === "X" || c.status === "won");
const partyOf = (c) => c.party_id || c.party || c.party_name || c.partyShortName || (c.party_details && c.party_details.name) || "";
const nameOf = (c) => c.name_display || c.full_name || c.name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "";

// Finds every object that looks like a race (has a candidates array and a state), anywhere in the file.
export function parseResults(json) {
  const found = new Map();
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const cands = Array.isArray(o.candidates) ? o.candidates : Array.isArray(o.results) ? o.results : null;
    const st = cands && stateOf(o);
    if (cands && st) {
      const w = cands.find(isWinner);
      const called = !!w || o.called === true || o.result === "called" || o.race_call_status === "called";
      const prev = found.get(st);
      // a state can carry more than one race object (e.g. county rows); keep the statewide/called one
      if (!prev || (!prev.called && called)) found.set(st, { race: st, called: !!w, winner: w ? nameOf(w) : "", party: w ? String(partyOf(w)) : "", color: w ? colorOf(partyOf(w)) : "" });
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  walk(json);
  return found;
}

async function sheets(path, opts = {}) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}${path}`, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`Sheets ${opts.method || "GET"} failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function main() {
  if (!SHEET || !TOKEN) throw new Error("Missing: LEDGER_SHEET_ID or Google access token");
  const meta = await sheets("?fields=sheets.properties.title");
  if (!meta.sheets.some((s) => s.properties.title === "us-results"))
    await sheets(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "us-results", gridProperties: { frozenRowCount: 1 } } } }] }) });
  // keep thr33s's overrides
  const prev = ((await sheets(`/values/${encodeURIComponent("us-results!A:H")}`)).values || []).slice(1);
  const override = Object.fromEntries(prev.filter((r) => r[0]).map((r) => [r[0], r[7] || ""]));
  const r = await fetch(URL, { headers: { "User-Agent": "thr33som3s-3l3ction/1.0" } });
  let parsed = new Map(), source = "nyt", note = "";
  if (r.status === 404) { note = "awaiting results"; log("results file not published yet (404)"); }
  else if (!r.ok) { note = `nyt http ${r.status}`; log(note); }
  else { parsed = parseResults(await r.json()); log(`parsed ${parsed.size} senate races from the nyt file`); }
  const now = new Date().toISOString();
  const rows = RACES.map((st) => { const p = parsed.get(st) || {};
    return [st, p.called ? "yes" : "no", p.winner || "", p.party || "", p.color || "", p.called ? source : note || "nyt: not called", now, override[st] || ""]; });
  await sheets(`/values/${encodeURIComponent("us-results!A1")}?valueInputOption=RAW`, { method: "PUT",
    body: JSON.stringify({ values: [["race", "called", "winner", "party", "color", "source", "updated", "override"], ...rows] }) });
  log(`${rows.filter((x) => x[1] === "yes").length} of ${RACES.length} Grotto races called`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
