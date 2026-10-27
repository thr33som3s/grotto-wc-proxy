// One-time (re-runnable) job: read each token's image straight from its contract's on-chain metadata,
// via Alchemy, and write it to the "images" tab of the ledger sheet. The catalog then uses these images
// for collections whose sheet links don't load (see IMAGE_FROM_CHAIN in api/_lib/catalog.js).
// Columns: collection, token_id, image (the metadata's own image link), cached (Alchemy's copy), token_uri.
import { CONTRACTS, CHAINS } from "./core.mjs";

const SHEET = process.env.LEDGER_SHEET_ID;
const ALCHEMY = process.env.ALCHEMY_API_KEY;
const TOKEN = process.env.GOOGLE_ACCESS_TOKEN;
const ONLY = (process.env.COLLECTIONS || "guest").split(",").map((s) => s.trim()).filter(Boolean);
const log = (...a) => console.log(new Date().toISOString(), ...a);

const S = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`;
async function sheets(path, opts = {}) {
  const r = await fetch(S + path, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`Sheets ${opts.method || "GET"} failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function ensureTab(name) {
  const meta = await sheets("?fields=sheets.properties.title");
  if (meta.sheets.some((s) => s.properties.title === name)) return;
  await sheets(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: name, gridProperties: { frozenRowCount: 1 } } } }] }) });
}

async function contractImages(c) {
  const out = [];
  let pageKey;
  do {
    const u = new URL(`https://${CHAINS[c.chain].alchemy}.g.alchemy.com/nft/v3/${ALCHEMY}/getNFTsForContract`);
    u.searchParams.set("contractAddress", c.address); u.searchParams.set("withMetadata", "true"); u.searchParams.set("limit", "100");
    if (pageKey) u.searchParams.set("pageKey", pageKey);
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Alchemy ${c.key}: HTTP ${r.status}`);
    const j = await r.json();
    for (const n of j.nfts || []) {
      const raw = n.raw?.metadata?.image || n.raw?.metadata?.image_url || "";
      out.push([c.key, String(BigInt(n.tokenId)), raw, n.image?.cachedUrl || n.image?.pngUrl || "", n.tokenUri || n.raw?.tokenUri || ""]);
    }
    pageKey = j.pageKey;
  } while (pageKey);
  return out;
}

async function main() {
  const missing = [!SHEET && "LEDGER_SHEET_ID", !ALCHEMY && "ALCHEMY_API_KEY", !TOKEN && "Google access token"].filter(Boolean);
  if (missing.length) throw new Error("Missing: " + missing.join(", "));
  await ensureTab("images");
  // Keep rows for collections not in this run; replace rows for the ones that are.
  const existing = ((await sheets(`/values/${encodeURIComponent("images!A:E")}`)).values || []).slice(1).filter((r) => r[0] && !ONLY.includes(r[0]));
  const fresh = [];
  for (const key of ONLY) {
    const c = CONTRACTS.find((x) => x.key === key);
    if (!c) { log(`unknown collection ${key}, skipped`); continue; }
    const rows = await contractImages(c);
    log(`${key}: ${rows.length} tokens, ${rows.filter((r) => r[2] || r[3]).length} with images`);
    fresh.push(...rows);
  }
  await sheets(`/values/${encodeURIComponent("images!A:Z")}:clear`, { method: "POST", body: "{}" });
  await sheets(`/values/${encodeURIComponent("images!A1")}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [["collection", "token_id", "image", "cached", "token_uri"], ...existing, ...fresh] }) });
  log("done");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
