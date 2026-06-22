export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  const SHEET_ID = '10H8y7j8qnvkbeVLU6F39HrtKktijz0EOZM8gdC_zJRQ';
  const API_KEY  = process.env.GOOGLE_API_KEY;
  const RANGE    = encodeURIComponent('Sheet1!A:Z');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Sheets API error: ${response.status}`);
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
