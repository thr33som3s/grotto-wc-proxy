// 3v3nts built in build3r (conn3ct, thr33s's wallet only) and run by one generic runtime.
// Generalized from the Friday the 13th 3v3nt (api/_lib/f13.js), which stays hand-coded while it runs.
//
// A config:
// { id, name, intro: [paragraph], status: "draft" | "published",
//   window: { opens, closes },                      ISO times
//   snapshot: { tab, at },                          a frozen copy of the ledger's holdings (Holder role, "snapshot")
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

export function blankEvent(id, name = "") {
  return { id, name, intro: [], status: "draft", window: { opens: "", closes: "" }, snapshot: { tab: "", at: "" }, tokens: [],
    roles: { hold: { count: "snapshot", claims: 1, max: null }, burn: { claims: 1, max: null }, vault: { claims: 1, max: null }, cite: { claims: 1, max: null } } };
}

// Cleans a config sent from build3r. Returns { config, problems }.
export function cleanEvent(c) {
  const problems = [];
  const id = String(c?.id || "").toLowerCase();
  if (!ID_RE.test(id)) problems.push("the 3v3nt id must be 2–41 lowercase letters, numbers or hyphens");
  const out = blankEvent(id, String(c?.name || "").slice(0, 120));
  out.intro = (Array.isArray(c?.intro) ? c.intro : String(c?.intro || "").split(/\n\s*\n/)).map((p) => String(p).trim()).filter(Boolean).slice(0, 30);
  out.status = c?.status === "published" ? "published" : "draft";
  out.window = { opens: String(c?.window?.opens || ""), closes: String(c?.window?.closes || "") };
  // The snapshot's tab is always "snapshot-<id>" in the ledger sheet; the ledger job takes it, exact to the second.
  out.snapshot = { tab: `snapshot-${id}`, at: Date.parse(c?.snapshot?.at) ? new Date(c.snapshot.at).toISOString() : "" };
  const seen = new Set();
  for (const t of Array.isArray(c?.tokens) ? c.tokens : []) {
    const key = String(t?.key || "");
    if (!/^[a-z0-9]+:\d+$/.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.tokens.push({ key, role: ROLES.includes(t.role) ? t.role : null });
  }
  for (const r of ROLES) {
    const src = c?.roles?.[r] || {};
    const n = (v, d) => (v === "" || v === null || v === undefined || isNaN(Number(v)) ? d : Math.max(0, Math.floor(Number(v))));
    out.roles[r] = { ...out.roles[r], claims: n(src.claims, out.roles[r].claims), max: n(src.max, null) };
    if (r === "hold") out.roles.hold.count = src.count === "entry" ? "entry" : "snapshot";
  }
  if (out.status === "published") {
    if (!out.name) problems.push("give the 3v3nt a name before publishing");
    if (!(Date.parse(out.window.opens) < Date.parse(out.window.closes))) problems.push("set when the 3v3nt opens and closes");
    if (!out.tokens.some((t) => t.role)) problems.push("assign at least one token to a role");
    if (out.tokens.some((t) => t.role === "hold") && out.roles.hold.count === "snapshot" && !out.snapshot.at) problems.push("the holder role counts a snapshot: set when it's taken");
  }
  return { config: out, problems };
}

export const roleKeys = (cfg, role) => cfg.tokens.filter((t) => t.role === role).map((t) => t.key);
export const eventCollections = (cfg) => [...new Set(cfg.tokens.map((t) => t.key.split(":")[0]))];

export const usesSnapshot = (cfg) => roleKeys(cfg, "hold").length > 0 && cfg.roles.hold.count === "snapshot";
export function eventWindow(cfg, now = Date.now(), testMode = false) {
  const o = Date.parse(cfg.window.opens), c = Date.parse(cfg.window.closes);
  const open = testMode || (cfg.status === "published" && now >= o && now <= c);
  return { opens: cfg.window.opens, closes: cfg.window.closes, open, closed: !testMode && now > c, testMode, snapshotAt: cfg.snapshot.at || null, holdCount: cfg.roles.hold.count };
}

// rows: [{ key, wallet, balance }] from the snapshot tab or live holdings -> this wallet's holder tokens.
export function heldIn(cfg, rows, wallet) {
  const pool = new Set(roleKeys(cfg, "hold")), w = String(wallet || "").toLowerCase();
  return [...new Set(rows.filter((r) => String(r.wallet).toLowerCase() === w && r.balance > 0 && pool.has(r.key)).map((r) => r.key))];
}

// payload: { hold: [key], burn: [{ key, qty }], vault: [{ key, qty }], cite: [key] }
export function cleanPayload(b) {
  const keys = (a) => (Array.isArray(a) ? a.map(String) : []);
  const qtys = (a) => (Array.isArray(a) ? a : []).filter((x) => Number(x?.qty) > 0).map((x) => ({ key: String(x.key), qty: Number(x.qty) }));
  return { hold: keys(b.hold), burn: qtys(b.burn), vault: qtys(b.vault), cite: keys(b.cite) };
}

// held: Set of holder tokens this wallet qualifies with (snapshot or now); live: Map key -> balance now.
export function checkEntry(cfg, p, held, live) {
  const out = [];
  const pool = Object.fromEntries(ROLES.map((r) => [r, new Set(roleKeys(cfg, r))]));
  const twice = (list, what) => { const s = new Set(); for (const k of list) { if (s.has(k)) out.push(`${k} is ${what} twice`); s.add(k); } };
  for (const k of p.hold) {
    if (!pool.hold.has(k)) out.push(`${k} isn't a holder token in this 3v3nt`);
    else if (!held.has(k)) out.push(cfg.roles.hold.count === "snapshot" ? `your wallet didn't hold ${k} at the snapshot` : `your wallet doesn't hold ${k}`);
  }
  twice(p.hold, "cited");
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
  for (const r of ROLES) {
    const max = cfg.roles[r].max;
    const n = r === "hold" || r === "cite" ? p[r].length : p[r].reduce((a, x) => a + x.qty, 0);
    if (max !== null && max !== undefined && n > max) out.push(`at most ${max} ${ROLE_LABEL[r]} ${r === "hold" || r === "cite" ? "tokens" : "editions"} per collector`);
  }
  if (!ROLES.some((r) => p[r].length)) out.push("choose at least one token");
  return out;
}

export function entryClaims(cfg, p) {
  const c = cfg.roles;
  return p.hold.length * c.hold.claims + p.cite.length * c.cite.claims
    + p.burn.reduce((a, x) => a + x.qty, 0) * c.burn.claims + p.vault.reduce((a, x) => a + x.qty, 0) * c.vault.claims;
}

// What moves on-chain: [{ key, dest, qty }]
export const moves = (p) => [...p.burn.map((x) => ({ key: x.key, dest: DEST.burn, qty: x.qty })), ...p.vault.map((x) => ({ key: x.key, dest: DEST.vault, qty: x.qty }))];

// sent: { "key>dest": { sent } } from sentTo. Counts each move up to the amount committed.
export function confirmedClaims(cfg, p, sent) {
  const c = cfg.roles;
  const arrived = {};
  let burn = 0, vault = 0;
  for (const r of ["burn", "vault"]) for (const x of p[r]) {
    const k = `${x.key}>${DEST[r]}`, s = Math.min(x.qty, (sent[k] || {}).sent || 0);
    arrived[k] = s; if (r === "burn") burn += s; else vault += s;
  }
  const claims = p.hold.length * c.hold.claims + p.cite.length * c.cite.claims + burn * c.burn.claims + vault * c.vault.claims;
  return { arrived, claims, pending: entryClaims(cfg, p) - claims };
}

export function entryMessage(cfg, wallet, p, names, issuedAt) {
  const nm = (k) => names[k] || k;
  const sec = (title, lines) => `${title}\n${lines.length ? lines.join("\n") : "  none"}`;
  const parts = [];
  if (roleKeys(cfg, "hold").length) parts.push(sec(`held${cfg.roles.hold.count === "snapshot" ? " at the snapshot" : ""}: ${p.hold.length}`, p.hold.map((k) => `  ${nm(k)}`)));
  if (roleKeys(cfg, "cite").length) parts.push(sec(`cited: ${p.cite.length}`, p.cite.map((k) => `  ${nm(k)}`)));
  if (roleKeys(cfg, "burn").length) parts.push(sec(`to burn at 333burn: ${p.burn.reduce((a, x) => a + x.qty, 0)}`, p.burn.map((x) => `  ${nm(x.key)} x${x.qty}`)));
  if (roleKeys(cfg, "vault").length) parts.push(sec(`to 3vault: ${p.vault.reduce((a, x) => a + x.qty, 0)}`, p.vault.map((x) => `  ${nm(x.key)} x${x.qty}`)));
  return `thr33som3s 3v3nt: ${cfg.name}\nentry: final, one per collector\n\nwallet: ${wallet}\nsigned: ${issuedAt}\n\n${parts.join("\n\n")}\n\n`
    + `claims if everything sent arrives by the close: ${entryClaims(cfg, p)}\n\nSigning is free and moves nothing now.`;
}
