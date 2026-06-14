export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_KEY = process.env.GOOGLE_API_KEY;

  // One standalone spreadsheet per collection
  const SHEET_MAP = {
    'bulk':      '1s_8-7x5Sq9vnARg1myRKWHnjqjyoj-7QXelol0l8xwQ',
    'univ3rs3':  '1KQh5V76-jcTQxTAhAIHZvGQHNhbP6_yGKcnCutbmaJs',
    'gen2':      '1aWO-XB7n409h2_9xoVq9f8q72kU3t7L2PsVYWPK8S9o',
    'gen3':      '1i15K-52jj4wMYMRWUcYrZuwxJQcAXcFPn-ocglmkxgg',
    'thr33zi3s': '1fmYevh7PteIB8VD7u7MstffY8ZR6qK6BgKrgUEVVQRU',
    'guest':     '1qnlN5EHwSn71bjMFKCu9y71DUdNnkvcVda6AA2HPi-s',
  };

  const key     = req.query.sheet || 'bulk';
  const sheetId = SHEET_MAP[key];

  if (!sheetId) {
    return res.status(400).json({ error: 'unknown sheet key: ' + key });
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:BF?key=${API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
