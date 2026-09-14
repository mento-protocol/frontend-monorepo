import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { test } from "node:test";

const appRequire = createRequire(
  new URL("../apps/app.mento.org/package.json", import.meta.url),
);
const wormholeRequire = createRequire(
  appRequire.resolve("@wormhole-foundation/wormhole-connect"),
);
const walletAggregatorRequire = createRequire(
  wormholeRequire.resolve("@wormhole-labs/wallet-aggregator-sui"),
);
const suiRequire = createRequire(
  walletAggregatorRequire.resolve("@mysten/sui.js"),
);
const jaysonUtils = suiRequire("jayson/lib/utils");

test("Jayson parses streamed JSON-RPC requests with stream-json 3", async () => {
  const requests = [
    {
      jsonrpc: "2.0",
      method: "getBalance",
      params: ["11111111111111111111111111111111"],
      id: 1,
    },
    {
      jsonrpc: "2.0",
      method: "getSlot",
      params: [],
      id: 2,
    },
  ];
  const serialized = requests.map(JSON.stringify).join("");
  const chunks = [
    serialized.slice(0, 17),
    serialized.slice(17, 61),
    serialized.slice(61),
  ];

  const parsed = await new Promise((resolve, reject) => {
    const values = [];
    jaysonUtils.parseStream(Readable.from(chunks), {}, (error, value) => {
      if (error) {
        reject(error);
        return;
      }
      values.push(value);
      if (values.length === requests.length) {
        resolve(values);
      }
    });
  });

  assert.deepEqual(parsed, requests);
});
