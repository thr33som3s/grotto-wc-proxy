export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_KEY  = process.env.GOOGLE_API_KEY;
  const SHEET_ID = '1s_8-7x5Sq9vnARg1myRKWHnjqjyoj-7QXelol0l8xwQ';
  const tab      = req.query.tab || 'BASE-thr33som3s-Bulk-metadata';

  // Encode the range — tab name needs single quotes if it contains spaces/special chars
  const safeTab  = tab.includes(' ') || tab.includes('-')
    ? `'${tab}'`
    : tab;
  const range    = encodeURIComponent(`${safeTab}!A:BF`);
  const url      = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${API_KEY}`;

  try {
    const response = await fetch(url);
    const text     = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({ error: text, tab, range: `${safeTab}!A:BF` });
    }
    const data = JSON.parse(text);
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
