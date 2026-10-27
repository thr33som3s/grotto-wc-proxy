// Signed sign-in and 90-minute sessions.
// A collector signs a short sign-in message (free, no transaction). The proxy checks the signature,
// then hands back a session token: the wallet and an expiry, sealed with an HMAC only the proxy can
// make. No session state is stored; logging out just means the browser discards the token.
import crypto from "node:crypto";
import { ethers } from "ethers";

export const SESSION_MINUTES = 90;
const SIGNIN_MAX_AGE_MS = 10 * 60 * 1000;
const key = () => crypto.createHash("sha256").update("thr33som3s-session:" + (process.env.STORE_SECRET || "")).digest();
const b64 = (s) => Buffer.from(s).toString("base64url");
export const isAddress = (w) => /^0x[0-9a-fA-F]{40}$/.test(w || "");

export function signInMessage(wallet, issuedAt) {
  return `thr33som3s sign-in\n\nwallet: ${wallet.toLowerCase()}\nissued: ${issuedAt}\n\nSigning is free and does not move any tokens.`;
}

// Returns the wallet if the signature over the message is valid, the message is the sign-in text
// for that wallet, and it was issued in the last 10 minutes.
export function verifySignIn({ wallet, issuedAt, signature }) {
  if (!isAddress(wallet)) throw new Error("wallet must be a 0x address");
  const age = Date.now() - Date.parse(issuedAt);
  if (!(age >= -60000 && age <= SIGNIN_MAX_AGE_MS)) throw new Error("sign-in expired; sign again");
  const signer = ethers.utils.verifyMessage(signInMessage(wallet, issuedAt), signature).toLowerCase();
  if (signer !== wallet.toLowerCase()) throw new Error("signature does not match the wallet");
  return signer;
}

export function issueToken(wallet) {
  const body = b64(JSON.stringify({ w: wallet.toLowerCase(), exp: Date.now() + SESSION_MINUTES * 60000 }));
  const mac = crypto.createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

// Wallet from a valid, unexpired token; otherwise null.
export function walletFromToken(token) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const good = crypto.createHmac("sha256", key()).update(body).digest("base64url");
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  try { const { w, exp } = JSON.parse(Buffer.from(body, "base64url").toString()); return Date.now() < exp ? w : null; } catch { return null; }
}
export const walletFromReq = (req) => walletFromToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));

// Verifies a wallet signature over an exact message (used for commitments).
export function signerOf(message, signature) { return ethers.utils.verifyMessage(message, signature).toLowerCase(); }

export function cors(res, methods = "GET, POST") {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods + ", OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
}
export const body = (req) => (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {});
