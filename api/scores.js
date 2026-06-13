export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_KEY = process.env.FOOTBALL_API_KEY;

  // football-data.org v4 — FIFA World Cup 2026 uses competition code "WC"
  // Fetch today's matches + live matches
  const url = 'https://api.football-data.org/v4/competitions/WC/matches?status=LIVE,IN_PLAY,PAUSED,FINISHED';

  try {
    const response = await fetch(url, {
      headers: { 'X-Auth-Token': API_KEY }
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error('API error: ' + response.status + ' ' + text);
    }
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
