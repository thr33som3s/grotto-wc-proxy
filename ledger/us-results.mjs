// Election-night job: reads the US Senate results and writes one row per Grotto race to the "us-results"
// tab of the ledger sheet: race, called, winner, party, color, source, updated, override.
// Primary source: the New York Times' public results file (AP-sourced). It returns 404 until election night.
// The parser walks the file for race objects instead of assuming one exact layout, so a small format
// change on the night doesn't break it. The "override" column is thr33s's; it is never overwritten.
const SHEET = process.env.LEDGER_SHEET_ID, TOKEN = process.env.GOOGLE_ACCESS_TOKEN;
const DATE = process.env.ELECTION_DATE || "2026-11-03";
// Any other date is a test: it writes to "us-results-test", never to the tab the live map reads.
const TAB = DATE === "2026-11-03" ? "us-results" : "us-results-test";
const [Y, M, D] = DATE.split("-");
// The Times publishes its results data at addresses that carry a random ID, so the job reads the address
// from tonight's Senate results page instead of guessing it. The old guessed address is kept as a last try.
const PAGES = [
  `https://www.nytimes.com/interactive/${Y}/${M}/${D}/us/elections/results-senate.html`,
  `https://www.nytimes.com/interactive/${Y}/${M}/${D}/us/elections/results-senate-elections.html`,
];
const GUESS = `https://static01.nyt.com/elections-assets/pages/data/${DATE}/results-senate.json`;
const UA = { "User-Agent": "Mozilla/5.0 (thr33som3s-3l3ction results)" };
export function feedUrls(html) {
  const out = new Set();
  for (const m of String(html).matchAll(/https?:\/\/static01\.nyt\.com\/elections-assets\/[^"'\s<>\\]+?\.json/g)) out.add(m[0]);
  // senate feeds first; county-level files are large and still parse, but come last
  return [...out].sort((a, b) => (/senate/i.test(b) - /senate/i.test(a)) || (/county/i.test(a) - /county/i.test(b)));
}
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
  if (!meta.sheets.some((s) => s.properties.title === TAB))
    await sheets(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, gridProperties: { frozenRowCount: 1 } } } }] }) });
  // keep thr33s's overrides
  const prev = ((await sheets(`/values/${encodeURIComponent(`${TAB}!A:H`)}`)).values || []).slice(1);
  const override = Object.fromEntries(prev.filter((r) => r[0]).map((r) => [r[0], r[7] || ""]));
  const prevRow = Object.fromEntries(prev.filter((r) => r[0]).map((r) => [r[0], r]));
  let urls = [];
  for (const page of PAGES) {
    try { const r = await fetch(page, { headers: UA }); log("page", page, r.status); if (r.ok) urls.push(...feedUrls(await r.text())); } catch (e) { log("page failed", page, e.message); }
  }
  urls = [...new Set([...urls, GUESS])];
  log(`trying ${urls.length} data file(s)`);
  const parsed = new Map();
  for (const u of urls.slice(0, 12)) {
    try {
      const r = await fetch(u, { headers: UA });
      if (!r.ok) { log("data", r.status, u); continue; }
      const got = parseResults(await r.json());
      for (const [st, p] of got) if (p.called && !(parsed.get(st) || {}).called) parsed.set(st, p);
      log(`data ok: ${got.size} races, ${[...got.values()].filter((x) => x.called).length} called`, u);
    } catch (e) { log("data failed", u, e.message); }
  }
  const now = new Date().toISOString();
  // A race once called stays called: a failed or empty run never erases an earlier call.
  const rows = RACES.map((st) => {
    const p = parsed.get(st), old = prevRow[st];
    if (p && p.called) return [st, "yes", p.winner, p.party, p.color, "nyt (AP)", now, override[st] || ""];
    if (old && old[1] === "yes") return [st, "yes", old[2] || "", old[3] || "", old[4] || "", old[5] || "", old[6] || "", override[st] || ""];
    return [st, "no", "", "", "", "not called yet", now, override[st] || ""];
  });
  await sheets(`/values/${encodeURIComponent(`${TAB}!A1`)}?valueInputOption=RAW`, { method: "PUT",
    body: JSON.stringify({ values: [["race", "called", "winner", "party", "color", "source", "updated", "override"], ...rows] }) });
  log(`${rows.filter((x) => x[1] === "yes").length} of ${RACES.length} Grotto races called`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
