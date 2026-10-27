// One-time job: pin the gen1 and gen2 thr33zi3s images to thr33s's own Pinata account, so the
// thr33som3s gateway (which only serves content pinned to that account) can serve them.
// Reads the image links from each sheet, takes the CID out of every link (gen2 is one folder CID),
// and asks Pinata to pin each one by CID. Pinning happens in the background on Pinata's side.
const SHEETS = [
  { key: "thr33zi3s", id: "1aWO-XB7n409h2_9xoVq9f8q72kU3t7L2PsVYWPK8S9o" },
  { key: "gen2", id: "1fmYevh7PteIB8VD7u7MstffY8ZR6qK6BgKrgUEVVQRU" },
];
const TOKEN = process.env.GOOGLE_ACCESS_TOKEN;
const JWT = process.env.PINATA_JWT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function sheetRows(id) {
  const g = (p) => fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } }).then(async (r) => { if (!r.ok) throw new Error(`Sheets ${r.status}`); return r.json(); });
  const title = (await g("?fields=sheets.properties.title")).sheets[0].properties.title;
  return (await g(`/values/${encodeURIComponent(`'${title}'!A:C`)}`)).values || [];
}
// "https://ipfs.io/ipfs/Qm.../1001_Gen2.png" -> "Qm..."
const cidOf = (link) => { const m = String(link || "").match(/\/ipfs\/([A-Za-z0-9]+)/) || String(link || "").match(/^(Qm[1-9A-Za-z]{44}|baf[a-z0-9]+)/); return m ? m[1] : null; };

async function main() {
  if (!TOKEN || !JWT) throw new Error("Missing: " + [!TOKEN && "Google access token", !JWT && "PINATA_JWT (repository secret)"].filter(Boolean).join(", "));
  const cids = new Map(); // cid -> name
  for (const s of SHEETS) {
    const rows = (await sheetRows(s.id)).slice(1);
    for (const r of rows) { const c = cidOf(r[2]); if (c && !cids.has(c)) cids.set(c, `thr33som3s ${s.key} ${r[0]}`); }
    log(`${s.key}: ${rows.length} rows read`);
  }
  log(`${cids.size} distinct CIDs to pin`);
  let ok = 0, failed = 0;
  for (const [cid, name] of cids) {
    const r = await fetch("https://api.pinata.cloud/pinning/pinByHash", {
      method: "POST",
      headers: { Authorization: `Bearer ${JWT}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hashToPin: cid, pinataMetadata: { name } }),
    });
    const body = await r.text();
    if (r.ok) { ok++; log(`queued ${cid} (${name})`); }
    else { failed++; log(`FAILED ${cid} (${name}): HTTP ${r.status} ${body.slice(0, 160)}`); }
    await sleep(1200); // stay well under Pinata's request rate limit
  }
  log(`done: ${ok} queued, ${failed} failed. Pins finish in the background; check Pinata's Files page.`);
  if (failed && !ok) process.exit(1);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
