// Talks to the private store: an Apps Script web app bound to the private Google Sheet.
// STORE_URL and STORE_SECRET are Vercel environment variables. Nothing here is ever sent to browsers.
export async function store(action, body = {}) {
  const url = process.env.STORE_URL, secret = process.env.STORE_SECRET;
  if (!url || !secret) throw new Error("STORE_URL and STORE_SECRET must be set");
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, action, secret }) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error(`store: unexpected response (${r.status})`); }
  if (j.ok === false && j.error === "unauthorized") throw new Error("store: secret rejected");
  return j;
}
