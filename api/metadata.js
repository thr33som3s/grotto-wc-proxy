export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_KEY  = process.env.GOOGLE_API_KEY;
  const SHEET_ID = '1s_8-7x5Sq9vnARg1myRKWHnjqjyoj-7QXelol0l8xwQ';
  const tab      = req.query.tab || 'BASE-thr33som3s-Bulk-metadata';
  const RANGE    = encodeURIComponent(`${tab}!A:BF`);
  const url      = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Sheets API error: ${response.status}`);
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
