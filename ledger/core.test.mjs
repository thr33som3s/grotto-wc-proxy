import { test } from "node:test"; import assert from "node:assert/strict";
import { rowsFromTransfer, derive, ZERO } from "./core.mjs";
const U = "0xb20b9fb2657bc527cc8a5cb707071095113cab3b", B = "0x2e199bc11fa4c8918792da731328412eed861ab2";
const A = "0x00000000000000000000000000000000000000aa", Bw = "0x00000000000000000000000000000000000000bb";
const ev = (o) => ({ blockNum: "0x10", hash: "0xh", uniqueId: o.u || "0xh:log:1", metadata: { blockTimestamp: "2026-01-01T00:00:00Z" }, rawContract: { address: o.c || U }, ...o });
test("1155 batch -> one row per token; mint/transfer/burn typed", () => {
  const mint = rowsFromTransfer("ethereum", ev({ from: ZERO, to: A, erc1155Metadata: [{ tokenId: "0x4ca91", value: "0xa" }, { tokenId: "0x4ca92", value: "0x5" }] }));
  assert.equal(mint.length, 2); assert.equal(mint[0][3], "314001"); assert.equal(mint[0][6], "10"); assert.equal(mint[0][7], "mint");
  const burn = rowsFromTransfer("ethereum", ev({ from: A, to: "0x000000000000000000000000000000000000dEaD", erc1155Metadata: [{ tokenId: "0x4ca91", value: "0x2" }] }));
  assert.equal(burn[0][7], "burn");
  assert.deepEqual(rowsFromTransfer("ethereum", ev({ c: "0x1111111111111111111111111111111111111111", from: A, to: Bw, erc721TokenId: "0x1" })), []);
});
test("derive: balances, burns excluded from holdings, supply counts", () => {
  const rows = [
    ...rowsFromTransfer("ethereum", ev({ from: ZERO, to: A, erc1155Metadata: [{ tokenId: "0x4ca91", value: "0xa" }] })),
    ...rowsFromTransfer("ethereum", ev({ from: A, to: Bw, erc1155Metadata: [{ tokenId: "0x4ca91", value: "0x3" }] })),
    ...rowsFromTransfer("ethereum", ev({ from: A, to: "0x000000000000000000000000000000000000dead", erc1155Metadata: [{ tokenId: "0x4ca91", value: "0x2" }] })),
    ...rowsFromTransfer("base", ev({ c: B, from: ZERO, to: Bw, erc1155Metadata: [{ tokenId: "0x1ee241", value: "0x1" }] })),
    ...rowsFromTransfer("base", ev({ c: B, from: Bw, to: ZERO, erc1155Metadata: [{ tokenId: "0x1ee241", value: "0x1" }] })),
  ];
  const { holdings, supply } = derive(rows);
  assert.deepEqual(holdings, [["univ3rs3", "314001", A, "5"], ["univ3rs3", "314001", Bw, "3"]]);
  assert.deepEqual(supply, [["univ3rs3", "314001", "10", "2", "8", 2], ["bulk", "2024001", "1", "1", "0", 0]]);
});
