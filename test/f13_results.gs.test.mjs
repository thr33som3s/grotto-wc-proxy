// Runs store/f13_results.gs against saved real data (Nov 13, 1:55pm EST ledger run) and checks it reproduces the hand-written sheet.
import fs from "fs"; import vm from "vm"; import assert from "assert/strict";
const csv = (text) => { const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f.replace(/\r$/, "")); rows.push(row); row = []; f = ""; } else f += c; }
  if (f || row.length) { row.push(f); rows.push(row); } return rows; };
const meta = { "1qnlN5EHwSn71bjMFKCu9y71DUdNnkvcVda6AA2HPi-s": "toolu_01Fcam64ZgZqPDm6S9Vmaz1q/ETH-thr33som3s-univ3rs3-metadata.csv", "1s_8-7x5Sq9vnARg1myRKWHnjqjyoj-7QXelol0l8xwQ": "toolu_01TJ1ahEqfTuwH6TsAFzQPpq/BASE-thr33som3s-Bulk-metadata.csv",
  "1fmYevh7PteIB8VD7u7MstffY8ZR6qK6BgKrgUEVVQRU": "toolu_01NGsFq7BXsGmTEG9Ph9wa7f/generation-2-thr33zi3s-metadata.csv", "1i15K-52jj4wMYMRWUcYrZuwxJQcAXcFPn-ocglmkxgg": "toolu_01Tsnudd8a1wJxBEgs9vMzkC/generation-3-thr33zi3s.csv" };
const P = (w, u) => [w, "", "", JSON.stringify({ username: u })];
const profiles = [["wallet"], P("0x3d373231a0a60bb6203fd1a91e3f058100c2244d","333burn"),P("0x973d285299e2ee2305f9898c9d0f2740f1d139a9","crouton"),P("0xfe917312344b4ed3283c5e142868cd3eaa782933","thr33som3s"),P("0x7a0368c9a92c2cb42eb56038d8a93fd7de3b6ae8","danwilliamsart"),P("0x4bd5f2c91f11adc363adc91715fec80621c4d7be","Blu30rgy"),P("0xe22a212e67d826cad8c6050620e3d93e15118d40","Brendan2288"),P("0xb552fcea4151bd6c6ee78e2adc9683074dd91c38","Tayd3rtot"),P("0xb090d68029c6d422a5482d881d4d35c18158008d","JSON"),P("0x35cd6404a0ae7d84bf7dabc3681af9aadca10457","chris trueman"),P("0xb01537fc6256ada474bae2e26d0f5ffde559f62f","NezTheGreat"),P("0xd629701319dd1d99b39136bb3752cf251594dfd2","DickSlay3r"),P("0x46eae0422aa0139c169d1bae3070d77c9291a574","Deano"),P("0x37d0c5c8c7ade23cb5e32f5a6ceb136f639b1913","SuboshiNakasoto"),P("0xb1f9da6b807953d90042feb76d369f255a625a37","Rattro"),P("0x173dee1da0a84a122c7b24e81b10653e146e11cd","razr")];
const C = (ph, w, at, p) => [ph, w, at, JSON.stringify(p)];
const commitments = [["phase"], C("voting","0x4bd5f2c91f11adc363adc91715fec80621c4d7be","2026-11-01T20:18:25.733Z",{votes:[]}), C("f13-test","0xfe917312344b4ed3283c5e142868cd3eaa782933","2026-11-13T17:27:54.822Z",{holds:["gen2:1092"],burns:[]}),
  C("f13","0x35cd6404a0ae7d84bf7dabc3681af9aadca10457","2026-11-13T17:41:11.540Z",{holds:["univ3rs3:34235","univ3rs3:93009"],burns:[{key:"univ3rs3:70069",qty:1},{key:"bulk:319027",qty:1}]}),
  C("f13","0x46eae0422aa0139c169d1bae3070d77c9291a574","2026-11-13T17:44:45.496Z",{holds:["univ3rs3:3009","univ3rs3:93009"],burns:[{key:"bulk:319027",qty:3}]}),
  C("f13","0xe22a212e67d826cad8c6050620e3d93e15118d40","2026-11-13T17:53:47.354Z",{holds:["univ3rs3:3009","univ3rs3:93009"],burns:[]}),
  C("f13","0x37d0c5c8c7ade23cb5e32f5a6ceb136f639b1913","2026-11-13T18:56:02.703Z",{holds:["univ3rs3:93009"],burns:[{key:"univ3rs3:70071",qty:1},{key:"univ3rs3:317004",qty:1},{key:"bulk:9",qty:1},{key:"bulk:319027",qty:1}]})];
const tabs = {
  "10hplc8h_AOXz_w9VOxVc9Fg_Tp97Gqg-tNi-dpCzbaQ": { profiles, commitments },
  "1vDH6lXF_xegq8pWzGdDgHJPwnmpmoDXZoMaWj967UtM": { transfers: [["h"], ...JSON.parse(fs.readFileSync("/tmp/transfers2.json"))], state: [["chain"], ["ethereum", "26407959", "2026-11-13T17:45:22.539Z", "2026-11-13T18:55:17.919Z"], ["base", "57028681", "2026-11-13T17:45:23.179Z", "2026-11-13T18:55:17.919Z"]],
    "snapshot-f13": [["h"], ...JSON.parse(fs.readFileSync("/tmp/snapf13.json"))] },
};
const sheetOf = (values) => ({ getDataRange: () => ({ getValues: () => values }) });
const written = {};
const results = { getSheetByName: (n) => ({ clearContents() {}, getRange: (r, c, h, w) => ({ setNumberFormat() { return this; }, setValues: (v) => { written[n] = v; } }), setFrozenRows() {} }), insertSheet() {} };
const ctx = {
  SpreadsheetApp: { openById: (id) => meta[id] ? { getSheets: () => [sheetOf(csv(fs.readFileSync("/mnt/user-data/tool_results/drive_files/" + meta[id], "utf8")))] } : { getSheetByName: (t) => tabs[id][t] ? sheetOf(tabs[id][t]) : null }, getActiveSpreadsheet: () => results },
  Utilities: { formatDate: (d) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: true, timeZoneName: "short" }).formatToParts(d).map(x => [x.type, x.value])); return `${p.month} ${p.day} ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`; } },
  ScriptApp: {}, console, JSON, Math, Date, Object, Number, String, Set, Array,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("/home/claude/repo/store/f13_results.gs", "utf8") + "\nrefreshResults();", ctx);
// compare with what was written to the sheet by hand at 1:55pm (header lines aside)
const want = JSON.parse(fs.readFileSync("/tmp/sheet_all.json"));
const norm = (rows) => JSON.parse(JSON.stringify(rows)).map(r => r.map(v => typeof v === "number" ? String(v) : v)).map(r => { while (r.length && r.at(-1) === "") r.pop(); return r; });
const cmp = (got, exp, label) => { const g = norm(got).slice(1), e = norm(exp).slice(1);
  assert.equal(g.length, e.length, label + " rows"); g.forEach((r, i) => assert.equal(JSON.stringify(r), JSON.stringify(e[i]), `${label} row ${i + 2}`)); console.log(label + ": matches the sheet,", g.length, "rows"); };
cmp(written["By collector"], want.summ, "By collector");
cmp(written["Detail"], want.det, "Detail");
cmp(written["Snapshot"], want.snap, "Snapshot");
console.log("header:", written["By collector"][0][0].slice(0, 90));
