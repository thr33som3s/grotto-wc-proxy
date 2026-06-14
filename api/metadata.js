export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_KEY  = process.env.GOOGLE_API_KEY;
  const SHEET_ID = '1s_8-7x5Sq9vnARg1myRKWHnjqjyoj-7QXelol0l8xwQ';

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

  // Use CSV export — works with gid, no tab name parsing needed
  // Returns raw CSV which we parse into rows/values format matching Sheets API response
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;

  try {
    const response = await fetch(csvUrl, {
      headers: { 'Authorization': `Bearer ${process.env.GOOGLE_ACCESS_TOKEN || ''}` }
    });

    // CSV export on public sheets doesn't need auth — try without
    const csvRes = await fetch(csvUrl);
    if (!csvRes.ok) {
      // Fall back: use Sheets API with numeric sheet index via batchGet
      // Get all sheet data and pick the right one by gid
      const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?key=${API_KEY}&includeGridData=true&ranges=A1:BF1000`;
      const apiRes = await fetch(apiUrl);
      const apiData = await apiRes.json();
      const sheet = (apiData.sheets || []).find(s => s.properties.sheetId === gid);
      if (!sheet) return res.status(404).json({ error: 'sheet not found' });
      // Convert grid data to values format
      const values = (sheet.data[0].rowData || []).map(row =>
        (row.values || []).map(cell => cell.formattedValue || '')
      );
      return res.status(200).json({ values });
    }

    // Parse CSV into values array
    const text = await csvRes.text();
    const values = parseCSV(text);
    res.status(200).json({ values });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function parseCSV(text) {
  const lines = text.split('\n');
  return lines.map(line => {
    const cells = [];
    let inQuote = false;
    let cell = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuote && line[i+1] === '"') { cell += '"'; i++; }
        else inQuote = !inQuote;
      } else if (c === ',' && !inQuote) {
        cells.push(cell); cell = '';
      } else {
        cell += c;
      }
    }
    cells.push(cell);
    return cells;
  }).filter(row => row.some(c => c.trim()));
}
