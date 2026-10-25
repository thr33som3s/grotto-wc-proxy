// GET /api/catalog
// The whole thr33som3s catalog in one cleaned response: all six collections in canonical order,
// trait values normalized, gen differences merged into one set of trait fields, and trait families applied.
// Query: ?collection=gen2 (one collection only), ?unassigned=1 (include values not yet in a family).
import { COLLECTIONS, FAMILIES_SHEET, buildCollection, parseFamilies, applyFamilies } from "./_lib/catalog.js";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Sheets API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function firstTabRows(sheetId, key, range = "A:BF") {
  const meta = await getJson(`${API}/${sheetId}?fields=sheets.properties.title&key=${key}`);
  const title = meta.sheets[0].properties.title;
  const data = await getJson(`${API}/${sheetId}/values/${encodeURIComponent(`'${title}'!${range}`)}?key=${key}`);
  return data.values || [];
}
async function tabRows(sheetId, tab, range, key) {
  const data = await getJson(`${API}/${sheetId}/values/${encodeURIComponent(`'${tab}'!${range}`)}?key=${key}`);
  return data.values || [];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  // Cached at the edge for 5 minutes; a stale copy is served while it refreshes.
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  const KEY = process.env.GOOGLE_API_KEY;
  if (!KEY) return res.status(500).json({ error: "GOOGLE_API_KEY is not set" });

  const only = req.query.collection;
  const colls = only ? COLLECTIONS.filter((c) => c.key === only) : COLLECTIONS;
  if (only && !colls.length) return res.status(400).json({ error: `unknown collection: ${only}` });

  const errors = [];
  const [collResults, famResult] = await Promise.all([
    Promise.all(colls.map(async (c) => {
      try { return { c, tokens: buildCollection(c, await firstTabRows(c.sheet, KEY)) }; }
      catch (e) { errors.push({ collection: c.key, error: e.message }); return { c, tokens: [] }; }
    })),
    (async () => {
      try { return parseFamilies(await tabRows(FAMILIES_SHEET, "members", "A:D", KEY), await tabRows(FAMILIES_SHEET, "tree", "A:C", KEY)); }
      catch (e) { errors.push({ collection: "families", error: e.message }); return null; }
    })(),
  ]);

  const tokens = collResults.flatMap((r) => r.tokens);
  const unassigned = famResult ? applyFamilies(tokens, famResult) : null;

  res.status(errors.length && !tokens.length ? 502 : 200).json({
    generatedAt: new Date().toISOString(),
    collections: collResults.map(({ c, tokens }) => ({ key: c.key, label: c.label, chain: c.chain, contract: c.contract, count: tokens.length })),
    tokens,
    families: famResult,
    ...(req.query.unassigned ? { unassigned } : {}),
    errors,
  });
}
