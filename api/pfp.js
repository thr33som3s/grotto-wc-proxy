// GET /api/pfp?id=thr33som3s -> a custom profile picture. Only thr33som3s has one.
import { THR33SOM3S_PFP } from "./_lib/pfp_thr33som3s.js";

const CUSTOM = { thr33som3s: THR33SOM3S_PFP };

export default function handler(req, res) {
  const b64 = CUSTOM[String(req.query.id || "")];
  if (!b64) return res.status(404).json({ error: "no such picture" });
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
  res.status(200).send(Buffer.from(b64, "base64"));
}
