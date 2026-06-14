export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_KEY  = process.env.GOOGLE_API_KEY;
  const SHEET_ID = '1s_8-7x5Sq9vnARg1myRKWHnjqjyoj-7QXelol0l8xwQ';

  const TAB_MAP = {
    'bulk':      'BASE-thr33som3s-Bulk-metadata',
    'univ3rs3':  'ETH-thr33som3s-univ3rs3-metadata',
    'gen2':      'generation-2-thr33zi3s-metadata',
    'gen3':      'generation-3-thr33zi3s',
    'thr33zi3s': 'thr33zi3s',
    'guest':     'x thr33som3s guest minter',
  };

  const key     = req.query.sheet || 'bulk';
  const tabName = TAB_MAP[key];

  if (!tabName) {
    return res.status(400).json({ error: 'unknown sheet key: ' + key });
  }

  // No quotes — just encode the range directly
  const range = tabName + '!A:BF';
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?key=${API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text, range });
    }
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
