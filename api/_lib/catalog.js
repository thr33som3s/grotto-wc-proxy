// Shared catalog logic: the one place where the six collections are read, cleaned and tagged with
// trait families. Used by /api/catalog now; CONN3CT, the 3v3nt builder and the ledger read its output.
// Mirrors the 3v3nt builder's catalog layer so every surface sees identical data.

export const IPFS_GATEWAY = "https://metadata.thr33som3s.com/ipfs/";

// Canonical order (thr33s's hierarchy).
export const COLLECTIONS = [
  { key: "univ3rs3", label: "univ3rs3", chain: "ethereum", contract: "0xb20b9fb2657bc527cc8a5cb707071095113cab3b", sheet: "1qnlN5EHwSn71bjMFKCu9y71DUdNnkvcVda6AA2HPi-s" },
  { key: "bulk", label: "bulk", chain: "base", contract: "0x2e199bc11fa4c8918792da731328412eed861ab2", sheet: "1s_8-7x5Sq9vnARg1myRKWHnjqjyoj-7QXelol0l8xwQ" },
  { key: "thr33zi3s", label: "thr33zi3s", chain: "ethereum", contract: "0xdee1996336fcabb458c2b92fce19cf84eb587e64", sheet: "1aWO-XB7n409h2_9xoVq9f8q72kU3t7L2PsVYWPK8S9o" },
  { key: "gen2", label: "gen2", chain: "ethereum", contract: "0x8c6ebfc76199f379e706af27ad68f5340cc5b4e2", sheet: "1fmYevh7PteIB8VD7u7MstffY8ZR6qK6BgKrgUEVVQRU" },
  { key: "gen3", label: "gen3", chain: "ethereum", contract: "0xfdc33f1417086244e35096ff3bdf6192bd6f9f0b", sheet: "1i15K-52jj4wMYMRWUcYrZuwxJQcAXcFPn-ocglmkxgg" },
  { key: "guest", label: "guest", chain: "ethereum", contract: "0xac49356040d92ddfc37fba0385f6455d6ce1b6f6", sheet: "1KQh5V76-jcTQxTAhAIHZvGQHNhbP6_yGKcnCutbmaJs" },
];

// Trait families sheet: tab "members" (family, value, slot, collection) and tab "tree" (family, parent family).
export const FAMILIES_SHEET = "1avlL5zyANxPAb8O-ZXytw2gLU33CGO7jcAcyWEC6hmk";
export const SLOT_FIELDS = ["hair/hat", "eyes", "face/mouth", "shirt/torso", "arms", "accessories", "background"];

export const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
export const up = (s) => norm(s).toUpperCase();
const EMPTY = new Set(["", "NULL", "NONE", "N/A"]);

// Header aliases -> one trait field across all collections and generations.
export function canonField(h) {
  const k = norm(h).toLowerCase();
  if (k === "token_id") return "token_id";
  if (k === "card_name" || k === "name") return "name";
  if (k === "ipfs_hash" || k === "image" || k === "image_ipfs") return "_image";
  if (k === "description") return "_description";
  if (k === "glasses/eyes" || k === "face/eyes") return "eyes";
  if (/^arms(_\d+)?$/.test(k)) return "arms";
  if (k === "accessory" || k === "accessories") return "accessories";
  if (k === "33" || k === "thirty thr33") return "thirty thr33";
  return k;
}

// Trims, treats NULL/NONE/blank as empty, DK/LT -> DARK/LIGHT. Exact colors stay exact.
export function cleanValue(v) {
  let s = norm(v);
  if (EMPTY.has(s.toUpperCase())) return "";
  return s.replace(/^DK\b/i, "DARK").replace(/^LT\b/i, "LIGHT");
}

// Full links in a sheet are kept exactly as written: the thr33som3s gateway only serves content
// pinned to its own Pinata account, and the gen1/gen2 images are pinned elsewhere.
// Bare CIDs (univ3rs3, bulk, gen3) and ipfs:// links go through the thr33som3s gateway.
export function imageUrl(v) {
  const s = norm(v);
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("ipfs://")) return IPFS_GATEWAY + s.slice(7);
  if (/^(Qm|baf)/.test(s)) return IPFS_GATEWAY + s;
  return s;
}

// rows: the sheet's values, header first.
export function buildCollection(coll, rows) {
  const header = (rows[0] || []).map(canonField);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const idIdx = header.indexOf("token_id");
    const id = norm(r[idIdx >= 0 ? idIdx : 0]);
    if (!id) continue;
    const t = { key: `${coll.key}:${id}`, coll: coll.key, id, name: "", image: "", traits: {} };
    header.forEach((f, j) => {
      const raw = r[j];
      if (f === "name") { t.name = norm(raw); return; }
      if (f === "_image") { if (!t.image) t.image = imageUrl(raw); return; }
      if (!f || f.startsWith("_") || f === "token_id") return;
      const v = cleanValue(raw);
      if (!v) return;
      if (f === "arms") (t.traits.arms ||= []).push(v);
      else t.traits[f] = v;
    });
    out.push(t);
  }
  return out;
}

const valuesOf = (t, f) => { const v = t.traits[f]; return v === undefined ? [] : Array.isArray(v) ? v : [v]; };

export function parseFamilies(memberRows, treeRows) {
  const body = (rows) => (rows || []).slice(1).filter((r) => r && norm(r[0]));
  return {
    members: body(memberRows).filter((r) => norm(r[1])).map((r) => ({ family: norm(r[0]), value: norm(r[1]), slot: norm(r[2]).toLowerCase(), collection: norm(r[3]).toLowerCase() })),
    tree: body(treeRows).map((r) => ({ family: norm(r[0]), parent: norm(r[1]) })),
  };
}

// Tags each token with its families and every family above them in the tree.
// Returns trait values not yet in any family, by slot, with token counts.
export function applyFamilies(tokens, fam) {
  const parent = new Map(fam.tree.map((t) => [up(t.family), t.parent]));
  const label = new Map();
  for (const m of fam.members) label.set(up(m.family), m.family);
  for (const t of fam.tree) label.set(up(t.family), t.family);
  const lineage = (f) => { const out = []; const seen = new Set(); let cur = f; while (cur && !seen.has(up(cur))) { seen.add(up(cur)); out.push(label.get(up(cur)) || cur); cur = parent.get(up(cur)); } return out; };
  const byValue = new Map();
  for (const m of fam.members) { const k = up(cleanValue(m.value)); if (!byValue.has(k)) byValue.set(k, []); byValue.get(k).push(m); }
  const unassigned = Object.fromEntries(SLOT_FIELDS.map((f) => [f, {}]));
  for (const t of tokens) {
    delete t.traits.family;
    const fs = new Set();
    for (const f of SLOT_FIELDS) for (const v of valuesOf(t, f)) {
      const hits = (byValue.get(up(v)) || []).filter((m) => (!m.slot || m.slot === f) && (!m.collection || m.collection === t.coll));
      if (!hits.length) { const u = unassigned[f]; u[v] = (u[v] || 0) + 1; }
      for (const m of hits) for (const a of lineage(m.family)) fs.add(a);
    }
    if (fs.size) t.traits.family = [...fs];
  }
  return unassigned;
}
