export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_KEY  = process.env.GOOGLE_API_KEY;
  const SHEET_ID = '1s_8-7x5Sq9vnARg1myRKWHnjqjyoj-7QXelol0l8xwQ';

  // Map collection keys to sheet gids
  const GID_MAP = {
    'bulk':      0,
    'univ3rs3':  789048244,
    'gen2':      1708496918,
    'gen3':      1859541444,
    'thr33zi3s': 1969652791,
    'guest':     1819992164,
  };

  const key = req.query.sheet || 'bulk';
  const gid = GID_MAP[key];

  if (gid === undefined) {
    return res.status(400).json({ error: 'unknown sheet key: ' + key });
  }

  try {
    // Get spreadsheet metadata to resolve gid -> sheet title
    const metaRes  = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?key=${API_KEY}`);
    const metaData = await metaRes.json();
    const sheet    = (metaData.sheets || []).find(s => s.properties.sheetId === gid);
    if (!sheet) return res.status(404).json({ error: 'sheet not found for gid: ' + gid });

    const title    = sheet.properties.title;
    const range    = encodeURIComponent(`'${title}'!A:BF`);
    const dataUrl  = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${API_KEY}`;

    const dataRes  = await fetch(dataUrl);
    if (!dataRes.ok) {
      const text = await dataRes.text();
      return res.status(dataRes.status).json({ error: text, title });
    }
    const data = await dataRes.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
