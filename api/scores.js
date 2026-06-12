export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_KEY = process.env.FOOTBALL_API_KEY;

  // 2026 World Cup competition ID on football-data.org is 2000 (FIFA World Cup)
  // We fetch current matches to get live + today's scores
  const url = 'https://api.football-data.org/v4/competitions/2000/matches?status=LIVE,FINISHED,IN_PLAY,PAUSED';

  try {
    const response = await fetch(url, {
      headers: { 'X-Auth-Token': API_KEY }
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
