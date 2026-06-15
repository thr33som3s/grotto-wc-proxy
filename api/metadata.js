export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_KEY = process.env.GOOGLE_API_KEY;

  const SHEET_MAP = {
    'bulk':      '1s_8-7x5Sq9vnARg1myRKWHnjqjyoj-7QXelol0l8xwQ',
    'univ3rs3':  '1qnlN5EHwSn71bjMFKCu9y71DUdNnkvcVda6AA2HPi-s',
    'gen2':      '1fmYevh7PteIB8VD7u7MstffY8ZR6qK6BgKrgUEVVQRU',
    'gen3':      '1i15K-52jj4wMYMRWUcYrZuwxJQcAXcFPn-ocglmkxgg',
    'thr33zi3s': '1aWO-XB7n409h2_9xoVq9f8q72kU3t7L2PsVYWPK8S9o',
    'guest':     '1KQh5V76-jcTQxTAhAIHZvGQHNhbP6_yGKcnCutbmaJs',
  };

  const key     = req.query.sheet || 'bulk';
  const sheetId = SHEET_MAP[key];

  if (!sheetId) {
    return res.status(400).json({ error: 'unknown sheet key: ' + key });
  }

  // Get spreadsheet metadata to find the FIRST tab's title
  try {
    const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${API_KEY}`);
    if (!metaRes.ok) return res.status(metaRes.status).json({ error: await metaRes.text() });
    const meta = await metaRes.json();
    
    // Always use the first tab
    const firstSheet = meta.sheets[0];
    const title = firstSheet.properties.title;
    const range = encodeURIComponent(title + '!A:BF');
    
    const dataRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${API_KEY}`);
    if (!dataRes.ok) return res.status(dataRes.status).json({ error: await dataRes.text() });
    
    res.status(200).json(await dataRes.json());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
