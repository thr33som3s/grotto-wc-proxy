export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_KEY  = process.env.GOOGLE_API_KEY;
  const SHEET_ID = '1s_8-7x5Sq9vnARg1myRKWHnjqjyoj-7QXelol0l8xwQ';

  // Sheet index (0-based position in the spreadsheet tab order)
  // Verify these match the left-to-right tab order in your sheet
  const INDEX_MAP = {
    'bulk':      0,
    'univ3rs3':  1,
    'gen2':      2,
    'gen3':      3,
    'thr33zi3s': 4,
    'guest':     5,
  };

  const key   = req.query.sheet || 'bulk';
  const index = INDEX_MAP[key];

  if (index === undefined) {
    return res.status(400).json({ error: 'unknown sheet key: ' + key });
  }

  try {
    // First get spreadsheet metadata to find all sheet titles
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?key=${API_KEY}`;
    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) {
      return res.status(500).json({ error: 'metadata fetch failed: ' + metaRes.status });
    }
    const meta   = await metaRes.json();
    const sheets = meta.sheets || [];

    if (index >= sheets.length) {
      return res.status(404).json({
        error: 'index out of range',
        available: sheets.map((s,i) => ({ i, title: s.properties.title, gid: s.properties.sheetId }))
      });
    }

    const title  = sheets[index].properties.title;
    const gid    = sheets[index].properties.sheetId;

    // Now fetch values using the sheet title — but use the sheetId in ranges param
    // The v4 API accepts ranges like "SheetTitle!A:BF" but also accepts numeric ids
    // via the spreadsheets.values.get with the sheet's actual title
    const safeTitle = title; // use as-is, encode in URL
    const rangeStr  = safeTitle + '!A:BF';
    const valUrl    = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(rangeStr)}?key=${API_KEY}`;

    const valRes  = await fetch(valUrl);
    if (!valRes.ok) {
      const errText = await valRes.text();
      // Return debug info
      return res.status(valRes.status).json({
        error: errText,
        tried: rangeStr,
        title,
        gid,
        allSheets: sheets.map((s,i) => ({ i, title: s.properties.title, gid: s.properties.sheetId }))
      });
    }

    const data = await valRes.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
