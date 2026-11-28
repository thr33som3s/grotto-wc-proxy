// 3v3nts built in build3r (conn3ct, thr33s's wallet only) and run by one generic runtime.
// Generalized from the Friday the 13th 3v3nt (api/_lib/f13.js), which stays hand-coded while it runs.
//
// A config:
// { id, name, intro: [paragraph], status: "draft" | "published",
//   window: { opens, closes },                      ISO times
//   snapshot: { tab, at },                          set by the server: tab "snapshot-<id>", at = 10 minutes before opens
//   tokens: [{ key, role }],                        every token thr33s added; role null until assigned
//   roles: {
//     hold:  { count: "snapshot" | "entry", claims, max },   must hold; nothing moves
//     burn:  { claims, max },                                 sent to 333burn; per edition
//     vault: { claims, max },                                 sent to 3vault; per edition
//     cite:  { claims, max } } }                              any card in the universe; nothing moves, no holding check
// claims: claims earned per token (hold, cite) or per edition (burn, vault). max: most per collector (blank = none).
// One entry per collector, final. Burns and vaults count only when the ledger sees them arrive before the close,
// up to the amount committed.

export const ROLES = ["hold", "burn", "vault", "cite"];
export const ROLE_LABEL = { hold: "holder", burn: "burn", vault: "vault", cite: "cite" };
export const DEST = { burn: "333burn", vault: "3vault" };
export const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
// thr33s's rules: the snapshot is taken 10 minutes before the 3v3nt opens; a 3v3nt must be published at least
// 30 minutes before it opens.
export const SNAPSHOT_BEFORE_MS = 10 * 60 * 1000;
export const PUBLISH_CUTOFF_MS = 30 * 60 * 1000;

// ── Rules (thr33s's): every role uses the same mechanism ─────────
// A rule: put in N → get M claims or M entries (entries on the wheel), with optional caps per collector on what goes
// in (maxIn: editions burned / sent / held, or cards cited) and on what comes out (maxOut: claims or entries).
// Blank caps mean no maximum. A rule covers one token ("token") or several together ("group"); a token is in at
// most one rule, and tokens with no rule follow their role's default rule, applied per token.
//   hold, burn, vault: the collector chooses how many editions to put in (hold: from 0 up to what they held; never
//                all by default), only in multiples of N; caps on what goes in and what comes out are hard limits.
//   cite:        per token N is 1 (a card is cited once); a group can ask for N cards cited together.
// Defaults: 1 → 1 claim, no caps; holder 1 → 1 claim with at most 1 claim per token (one per unique token held).
export const UNITS = ["claims", "entries"];
const ROLE_DEFAULT = {
  hold: { count: "snapshot", n: 1, m: 1, unit: "claims", maxIn: null, maxOut: 1 },
  burn: { n: 1, m: 1, unit: "claims", maxIn: null, maxOut: null },
  vault: { n: 1, m: 1, unit: "claims", maxIn: null, maxOut: null },
  cite: { n: 1, m: 1, unit: "claims", maxIn: null, maxOut: null },
};
// Pay (thr33s's): a collector can commit to pay a fee per edition, each paid edition one claim. Nothing is charged:
// the signature is the commitment; payment is handled off chain. Limits per collector and in total (first come,
// first served); blank means none. Kept in its own block so it can move into each phase when phases arrive.
const PAY_DEFAULT = { enabled: false, cost: "", currency: "", maxPer: null, maxTotal: null };
export const DECIMAL_RE = /^\d+(\.\d{1,18})?$/;
// cost × qty, exactly (no floating point): "0.01" × 3 -> "0.03". Digit by digit, so it runs anywhere (Apps Script too).
export function payTotal(cost, qty) {
  if (!DECIMAL_RE.test(String(cost))) return "";
  const [w, f = ""] = String(cost).split(".");
  const digits = (w + f).split("").map(Number), q = Math.floor(Number(qty)) || 0;
  let carry = 0;
  const out = [];
  for (let i = digits.length - 1; i >= 0; i--) { const x = digits[i] * q + carry; out.unshift(x % 10); carry = Math.floor(x / 10); }
  while (carry > 0) { out.unshift(carry % 10); carry = Math.floor(carry / 10); }
  const t = out.join("").padStart(f.length + 1, "0");
  const int = t.slice(0, t.length - f.length).replace(/^0+(?=\d)/, ""), frac = f.length ? t.slice(t.length - f.length).replace(/0+$/, "") : "";
  return frac ? `${int}.${frac}` : int;
}
export const payText = (pay) => `${pay.cost} ${pay.currency} per edition`;
export function blankEvent(id, name = "") {
  return { id, name, intro: [], status: "draft", window: { opens: "", closes: "" }, snapshot: { tab: "", at: "" }, tokens: [],
    roles: JSON.parse(JSON.stringify(ROLE_DEFAULT)), rules: [], pay: { ...PAY_DEFAULT } };
}
const whole = (v, d, min = 0) => (v === "" || v === null || v === undefined || isNaN(Number(v)) ? d : Math.max(min, Math.floor(Number(v))));
const cap = (src, k, d) => (src && Object.prototype.hasOwnProperty.call(src, k) ? whole(src[k], null) : d);
// One rule's numbers, cleaned. `legacy` reads the older { claims, max } shape (one claim count per token, one cap).
function cleanRule(src, role, d) {
  const legacy = src && src.m === undefined && src.claims !== undefined;
  const r = {
    n: whole(src?.n, d.n, 1),
    m: whole(legacy ? src.claims : src?.m, d.m),
    unit: UNITS.includes(src?.unit) ? src.unit : d.unit,
    // A cap that's given but blank means no maximum; a cap that isn't given at all takes the default.
    maxIn: legacy ? (role !== "hold" ? whole(src.max, null) : null) : cap(src, "maxIn", d.maxIn),
    maxOut: legacy ? (role === "hold" ? whole(src.claims, null) : null) : cap(src, "maxOut", d.maxOut),
  };
  return r;
}

// Cleans a config sent from build3r. Returns { config, problems }.
export function cleanEvent(c, now = Date.now()) {
  const problems = [];
  const id = String(c?.id || "").toLowerCase();
  if (!ID_RE.test(id)) problems.push("the 3v3nt id must be 2–41 lowercase letters, numbers or hyphens");
  const out = blankEvent(id, String(c?.name || "").slice(0, 120));
  out.intro = (Array.isArray(c?.intro) ? c.intro : String(c?.intro || "").split(/\n\s*\n/)).map((p) => String(p).trim()).filter(Boolean).slice(0, 30);
  out.status = c?.status === "published" ? "published" : "draft";
  const iso = (v) => (Date.parse(v) ? new Date(v).toISOString() : "");
  out.window = { opens: iso(c?.window?.opens), closes: iso(c?.window?.closes) };
  // The snapshot's tab is always "snapshot-<id>" in the ledger sheet; its time is always 10 minutes before opens.
  out.snapshot = { tab: `snapshot-${id}`, at: out.window.opens ? new Date(Date.parse(out.window.opens) - SNAPSHOT_BEFORE_MS).toISOString() : "" };
  const seen = new Set();
  for (const t of Array.isArray(c?.tokens) ? c.tokens : []) {
    const key = String(t?.key || "");
    if (!/^[a-z0-9]+:\d+$/.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.tokens.push({ key, role: ROLES.includes(t.role) ? t.role : null });
  }
  for (const r of ROLES) {
    out.roles[r] = cleanRule(c?.roles?.[r] || {}, r, ROLE_DEFAULT[r]);
    if (r === "cite") out.roles.cite.n = 1;
    if (r === "hold") out.roles.hold.count = c?.roles?.hold?.count === "entry" ? "entry" : "snapshot";
  }
  // Rules: each token in at most one, and only tokens of the rule's role; empty rules dropped.
  const roleOf = new Map(out.tokens.map((t) => [t.key, t.role]));
  const ruled = new Set();
  let gi = 0;
  for (const src of Array.isArray(c?.rules) ? c.rules : []) {
    const role = ROLES.includes(src?.role) ? src.role : null;
    if (!role) continue;
    const keys = [...new Set((Array.isArray(src.keys) ? src.keys : []).map(String))].filter((k) => roleOf.get(k) === role && !ruled.has(k));
    if (!keys.length) continue;
    const scope = src.scope === "group" && keys.length > 1 ? "group" : "token";
    const rule = { role, scope, keys, ...cleanRule(src, role, ROLE_DEFAULT[role]) };
    if (role === "cite" && scope === "token") rule.n = 1;
    if (scope === "group") rule.label = String(src.label || "").trim().slice(0, 40) || `group ${String.fromCharCode(65 + (gi % 26))}`;
    if (scope === "group") gi++;
    keys.forEach((k) => ruled.add(k));
    out.rules.push(rule);
  }
  const pay = c?.pay || {};
  out.pay = { enabled: !!pay.enabled, cost: DECIMAL_RE.test(String(pay.cost ?? "").trim()) ? String(pay.cost).trim().replace(/^0+(?=\d)/, "") : "",
    currency: String(pay.currency || "").trim().slice(0, 12), maxPer: whole(pay.maxPer, null, 1), maxTotal: whole(pay.maxTotal, null, 1) };
  if (out.status === "published") {
    if (!out.name) problems.push("give the 3v3nt a name before publishing");
    if (out.pay.enabled && (!out.pay.cost || !out.pay.currency)) problems.push("the pay option needs a cost per edition and a currency");
    if (!(Date.parse(out.window.opens) < Date.parse(out.window.closes))) problems.push("set when the 3v3nt opens and closes");
    else if (Date.parse(out.window.opens) - now < PUBLISH_CUTOFF_MS) problems.push("a 3v3nt has to be published at least 30 minutes before it opens");
    if (!out.tokens.some((t) => t.role) && !out.pay.enabled) problems.push("assign at least one token to a role, or turn on the pay option");
  }
  return { config: out, problems };
}

// The rule each token follows: its own, its group's, or its role's default (per token).
export function ruleBuckets(cfg, role) {
  const keys = roleKeys(cfg, role), inRule = new Set();
  const buckets = (cfg.rules || []).filter((r) => r.role === role).map((r) => { r.keys.forEach((k) => inRule.add(k)); return r.scope === "group" ? { ...r } : null; }).filter(Boolean);
  for (const r of (cfg.rules || []).filter((r) => r.role === role && r.scope === "token")) for (const k of r.keys) buckets.push({ ...r, keys: [k] });
  for (const k of keys) if (!inRule.has(k)) buckets.push({ role, scope: "token", keys: [k], ...cfg.roles[role], default: true });
  return buckets;
}
const unitWord = (m, unit) => (m === 1 ? (unit === "entries" ? "entry" : "claim") : unit);
export const ruleText = (r) => `${r.n} → ${r.m} ${unitWord(r.m, r.unit)}`
  + (r.maxIn !== null && r.maxIn !== undefined ? ` · at most ${r.maxIn} in` : "") + (r.maxOut !== null && r.maxOut !== undefined ? ` · at most ${r.maxOut} ${r.unit}` : "");

export const roleKeys = (cfg, role) => cfg.tokens.filter((t) => t.role === role).map((t) => t.key);
export const eventCollections = (cfg) => [...new Set(cfg.tokens.map((t) => t.key.split(":")[0]))];

export const usesSnapshot = (cfg) => roleKeys(cfg, "hold").length > 0 && cfg.roles.hold.count === "snapshot";
export function eventWindow(cfg, now = Date.now(), testMode = false) {
  const o = Date.parse(cfg.window.opens), c = Date.parse(cfg.window.closes);
  const open = testMode || (cfg.status === "published" && now >= o && now <= c);
  return { opens: cfg.window.opens, closes: cfg.window.closes, open, closed: !testMode && now > c, testMode, snapshotAt: cfg.snapshot.at || null, holdCount: cfg.roles.hold.count };
}

// rows: [{ key, wallet, balance }] from the snapshot tab or live holdings -> this wallet's holder tokens.
export function heldIn(cfg, rows, wallet) { return [...heldCounts(cfg, rows, wallet).keys()]; }
// ... and how many editions of each it held (what holder rules count).
export function heldCounts(cfg, rows, wallet) {
  const pool = new Set(roleKeys(cfg, "hold")), w = String(wallet || "").toLowerCase(), out = new Map();
  for (const r of rows) if (String(r.wallet).toLowerCase() === w && r.balance > 0 && pool.has(r.key)) out.set(r.key, (out.get(r.key) || 0) + r.balance);
  return out;
}

// payload: { hold: [{ key, qty }], burn: [{ key, qty }], vault: [{ key, qty }], cite: [key], pay: editions }
// hold qty = how many of the editions held the collector claims with (0 means not claimed).
export function cleanPayload(b) {
  const keys = (a) => (Array.isArray(a) ? a.map(String) : []);
  const qtys = (a) => (Array.isArray(a) ? a : []).filter((x) => Number(x?.qty) > 0).map((x) => ({ key: String(x.key), qty: Number(x.qty) }));
  const pay = Number(b?.pay) || 0;
  return { hold: qtys(b.hold), burn: qtys(b.burn), vault: qtys(b.vault), cite: keys(b.cite), pay: pay > 0 ? pay : 0 };
}

// What one rule gives for what was put in: only whole multiples of N, within the caps (else a problem).
// trim: for amounts still arriving, pay only whole multiples within the caps and report nothing.
function applyRule(r, units, trim = false) {
  let u = units;
  if (trim) {
    if (r.maxIn !== null && r.maxIn !== undefined) u = Math.min(u, r.maxIn);
    u = Math.floor(u / r.n) * r.n;
    let out = (u / r.n) * r.m;
    if (r.maxOut !== null && r.maxOut !== undefined) out = Math.min(out, r.maxOut);
    return { in: u, out, problems: [] };
  }
  const problems = [];
  if (u % r.n) problems.push(`in multiples of ${r.n}`);
  if (r.maxIn !== null && r.maxIn !== undefined && u > r.maxIn) problems.push(`at most ${r.maxIn}`);
  const out = Math.floor(u / r.n) * r.m;
  if (r.maxOut !== null && r.maxOut !== undefined && out > r.maxOut) problems.push(`at most ${r.maxOut} ${r.unit}`);
  return { in: u, out, problems };
}
// Units each token puts in: cite = 1 (if cited); hold, burn, vault = the amount chosen.
function unitsFor(role, p) {
  if (role === "cite") return new Map(p.cite.map((k) => [k, 1]));
  const m = new Map(); for (const x of p[role]) m.set(x.key, (m.get(x.key) || 0) + x.qty); return m;
}
// The result of an entry: { claims, entries, lines: [{ role, keys, label, rule, in, out, unit }], problems }.
export function outcome(cfg, p) {
  const res = { claims: 0, entries: 0, lines: [], problems: [] };
  if (p.pay > 0) {   // each paid edition is one claim, counted from the commitment (payment is off chain)
    res.claims += p.pay;
    res.lines.push({ role: "pay", keys: [], label: null, rule: payText(cfg.pay || PAY_DEFAULT), in: p.pay, out: p.pay, unit: "claims", amount: payTotal((cfg.pay || {}).cost, p.pay) });
  }
  for (const role of ROLES) {
    const units = unitsFor(role, p);
    if (!units.size) continue;
    for (const b of ruleBuckets(cfg, role)) {
      const u = b.keys.reduce((a, k) => a + (units.get(k) || 0), 0);
      if (!b.keys.some((k) => units.has(k))) continue;
      const r = applyRule(b, u);
      const name = b.scope === "group" ? b.label : b.keys[0];
      r.problems.forEach((x) => res.problems.push(`${name}: ${role === "cite" ? "cite" : role === "hold" ? "hold" : role === "burn" ? "burn" : "send to 3vault"} ${x}`));
      res[b.unit] += r.out;
      res.lines.push({ role, keys: b.keys.filter((k) => units.has(k)), label: b.scope === "group" ? b.label : null, rule: ruleText(b), in: r.in, out: r.out, unit: b.unit });
    }
  }
  return res;
}

// held: Set of holder tokens this wallet qualifies with (snapshot or now); live: Map key -> balance now.
export function checkEntry(cfg, p, held, live, heldN = new Map()) {
  const out = [];
  const pool = Object.fromEntries(ROLES.map((r) => [r, new Set(roleKeys(cfg, r))]));
  const twice = (list, what) => { const s = new Set(); for (const k of list) { if (s.has(k)) out.push(`${k} is ${what} twice`); s.add(k); } };
  for (const x of p.hold) {
    if (!pool.hold.has(x.key)) out.push(`${x.key} isn't a holder token in this 3v3nt`);
    else if (!held.has(x.key)) out.push(cfg.roles.hold.count === "snapshot" ? `your wallet didn't hold ${x.key} at the snapshot` : `your wallet doesn't hold ${x.key}`);
    else if (!Number.isInteger(x.qty) || x.qty < 1) out.push(`choose a whole number of ${x.key}`);
    else if (x.qty > (heldN.get(x.key) || 0)) out.push(cfg.roles.hold.count === "snapshot" ? `you held only ${heldN.get(x.key) || 0} of ${x.key} at the snapshot` : `you hold only ${heldN.get(x.key) || 0} of ${x.key}`);
  }
  twice(p.hold.map((x) => x.key), "claimed");
  const need = new Map();   // editions sent anywhere, per token: burn and vault draw on the same balance
  for (const r of ["burn", "vault"]) {
    for (const x of p[r]) {
      if (!pool[r].has(x.key)) { out.push(`${x.key} can't be sent to ${DEST[r]} in this 3v3nt`); continue; }
      if (!Number.isInteger(x.qty) || x.qty < 1) { out.push(`choose a whole number of ${x.key}`); continue; }
      need.set(x.key, (need.get(x.key) || 0) + x.qty);
    }
    twice(p[r].map((x) => x.key), "listed");
  }
  for (const [k, q] of need) if (q > (live.get(k) || 0)) out.push(`you hold only ${live.get(k) || 0} of ${k}`);
  for (const k of p.cite) if (!pool.cite.has(k)) out.push(`${k} can't be cited in this 3v3nt`);
  twice(p.cite, "cited");
  if (p.pay) {
    const pay = cfg.pay || PAY_DEFAULT;
    if (!pay.enabled) out.push("this 3v3nt has no pay option");
    else if (!Number.isInteger(p.pay) || p.pay < 1) out.push("choose a whole number of editions to pay for");
    else if (pay.maxPer !== null && pay.maxPer !== undefined && p.pay > pay.maxPer) out.push(`pay for at most ${pay.maxPer} editions`);
  }
  if (!out.length) out.push(...outcome(cfg, p).problems);
  if (!ROLES.some((r) => p[r].length) && !p.pay) out.push("choose at least one token, or editions to pay for");
  return out;
}

// { claims, entries } if everything sent arrives.
export function entryClaims(cfg, p) { const o = outcome(cfg, p); return { claims: o.claims, entries: o.entries }; }

// What moves on-chain: [{ key, dest, qty }]
export const moves = (p) => [...p.burn.map((x) => ({ key: x.key, dest: DEST.burn, qty: x.qty })), ...p.vault.map((x) => ({ key: x.key, dest: DEST.vault, qty: x.qty }))];

// sent: { "key>dest": { sent } } from sentTo. Burns and vaults count only up to the amount committed, and a rule
// only pays out on what has arrived (a group of 3 → 2 pays nothing until all 3 are in).
export function confirmedClaims(cfg, p, sent) {
  const arrived = {};
  const pa = { ...p, burn: [], vault: [] };
  for (const r of ["burn", "vault"]) for (const x of p[r]) {
    const k = `${x.key}>${DEST[r]}`, s = Math.min(x.qty, (sent[k] || {}).sent || 0);
    arrived[k] = s; if (s > 0) pa[r].push({ key: x.key, qty: s });
  }
  const all = outcome(cfg, p), now = outcomeLenient(cfg, pa);
  return { arrived, claims: now.claims, entries: now.entries, pending: all.claims - now.claims, pendingEntries: all.entries - now.entries };
}
// Like outcome, but what has arrived so far pays only its whole multiples (no refusals: it's partway there).
function outcomeLenient(cfg, p) {
  const res = { claims: 0, entries: 0 };
  res.claims += p.pay || 0;   // paid editions count from the commitment
  for (const role of ROLES) {
    const units = unitsFor(role, p);
    for (const b of ruleBuckets(cfg, role)) {
      const u = b.keys.reduce((a, k) => a + (units.get(k) || 0), 0);
      if (!u) continue;
      const r = applyRule(b, u, true);   // whole multiples, caps trimmed
      res[b.unit] += r.out;
    }
  }
  return res;
}

export function entryMessage(cfg, wallet, p, names, issuedAt) {
  const nm = (k) => names[k] || k;
  const o = outcome(cfg, p);
  const verb = { hold: "claimed by holding", cite: "cited", burn: "to burn at 333burn", vault: "to 3vault" };
  const lines = o.lines.map((l) => l.role === "pay"
    ? `  commits to pay ${l.amount} ${cfg.pay.currency} for ${l.in} edition${l.in !== 1 ? "s" : ""} (${l.rule}), paid off chain → ${l.out} ${l.unit}`
    : `  ${verb[l.role]}: ${l.label ? `${l.label} (${l.keys.map(nm).join(", ")})` : nm(l.keys[0])}`
    + `${l.role === "cite" ? "" : " x" + l.in} [${l.rule}] → ${l.out} ${l.unit}`);
  return `thr33som3s 3v3nt: ${cfg.name}\nentry: final, one per collector\n\nwallet: ${wallet}\nsigned: ${issuedAt}\n\n${lines.join("\n")}\n\n`
    + `if everything sent arrives by the close: ${o.claims} claim${o.claims !== 1 ? "s" : ""}, ${o.entries} entr${o.entries !== 1 ? "ies" : "y"} on the wheel\n\nSigning is free and moves nothing now.`;
}
