// On-demand job: read specific tokens' metadata straight from their contract (via Alchemy) and write it to
// the "metadata-import" tab of the ledger sheet: collection, token_id, name, description, image, token_uri,
// attributes (JSON). Used to fill in tokens missing from a metadata sheet. Nothing else is changed.
import { CONTRACTS, CHAINS } from "./core.mjs";

const SHEET = process.env.LEDGER_SHEET_ID, ALCHEMY = process.env.ALCHEMY_API_KEY, TOKEN = process.env.GOOGLE_ACCESS_TOKEN;
const COLL = (process.env.COLLECTION || "univ3rs3").trim();
const IDS = (process.env.IDS || "").split(/[\s,]+/).filter(Boolean);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const S = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}`;
async function sheets(path, opts = {}) {
  const r = await fetch(S + path, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`Sheets ${opts.method || "GET"} failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function main() {
  const missing = [!SHEET && "LEDGER_SHEET_ID", !ALCHEMY && "ALCHEMY_API_KEY", !TOKEN && "Google access token", !IDS.length && "IDS"].filter(Boolean);
  if (missing.length) throw new Error("Missing: " + missing.join(", "));
  const c = CONTRACTS.find((x) => x.key === COLL);
  if (!c) throw new Error("unknown collection " + COLL);
  const rows = [];
  for (let i = 0; i < IDS.length; i += 100) {
    const r = await fetch(`https://${CHAINS[c.chain].alchemy}.g.alchemy.com/nft/v3/${ALCHEMY}/getNFTMetadataBatch`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens: IDS.slice(i, i + 100).map((id) => ({ contractAddress: c.address, tokenId: id })), refreshCache: true }),
    });
    if (!r.ok) throw new Error(`Alchemy: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    for (const n of j.nfts || j || []) {
      const m = n.raw?.metadata || {};
      rows.push([COLL, String(BigInt(n.tokenId)), m.name || n.name || "", m.description || n.description || "", m.image || "", n.tokenUri || n.raw?.tokenUri || "", JSON.stringify(m.attributes || [])]);
    }
  }
  const meta = await sheets("?fields=sheets.properties.title");
  if (!meta.sheets.some((s) => s.properties.title === "metadata-import"))
    await sheets(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "metadata-import" } } }] }) });
  await sheets(`/values/${encodeURIComponent("metadata-import!A:Z")}:clear`, { method: "POST", body: "{}" });
  await sheets(`/values/${encodeURIComponent("metadata-import!A1")}?valueInputOption=RAW`, { method: "PUT",
    body: JSON.stringify({ values: [["collection", "token_id", "name", "description", "image", "token_uri", "attributes"], ...rows] }) });
  log(`${COLL}: ${rows.length} of ${IDS.length} tokens written to metadata-import`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
