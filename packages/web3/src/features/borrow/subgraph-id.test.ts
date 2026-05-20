import { describe, expect, it } from "vitest";
import { formatSubgraphTroveId } from "./subgraph-id";

// ---------------------------------------------------------------------------
// formatSubgraphTroveId — single source of truth for the subgraph entity-id
// shape. Pins the contract:
//
//   <troveManager-lowercase>:<collIndex>:<troveId-as-canonical-hex>
//
// where the troveId hex is the AssemblyScript `BigInt.toHexString()` shape
// the subgraph mappings actually persist (lowercase, 0x-prefixed, no
// leading zeros).
//
// Different URL producers in the app emit the route id differently —
// `buildOpenTroveSuccessHref` uses decimal (`BigInt.toString()`), other
// flows already use hex. The helper has to handle both transparently;
// otherwise the panel would query a non-existent entity for newly-opened
// troves and surface a false "No on-chain activity yet" empty state.
// ---------------------------------------------------------------------------

const TROVE_MANAGER = "0xb38aEf2bF4e34B997330D626EBCd7629De3885C9";
const TROVE_HEX =
  "0x4a07e483cd55ef8406edb7a42d840333213f38611f9c0294faedd4345000aeb1";

describe("formatSubgraphTroveId", () => {
  it("produces the canonical id when given a 0x-hex trove id", () => {
    const id = formatSubgraphTroveId(TROVE_MANAGER, TROVE_HEX);
    expect(id).toBe(
      "0xb38aef2bf4e34b997330d626ebcd7629de3885c9:0:0x4a07e483cd55ef8406edb7a42d840333213f38611f9c0294faedd4345000aeb1",
    );
  });

  it("produces the same canonical id when given the decimal representation of the same trove id", () => {
    // Same trove, expressed as a decimal — this is the format
    // `buildOpenTroveSuccessHref()` currently pushes to the URL.
    const decimal = BigInt(TROVE_HEX).toString();
    const id = formatSubgraphTroveId(TROVE_MANAGER, decimal);
    expect(id).toBe(
      "0xb38aef2bf4e34b997330d626ebcd7629de3885c9:0:0x4a07e483cd55ef8406edb7a42d840333213f38611f9c0294faedd4345000aeb1",
    );
  });

  it("decimal and hex inputs yield identical output", () => {
    const fromHex = formatSubgraphTroveId(TROVE_MANAGER, TROVE_HEX);
    const fromDecimal = formatSubgraphTroveId(
      TROVE_MANAGER,
      BigInt(TROVE_HEX).toString(),
    );
    expect(fromHex).toBe(fromDecimal);
  });

  it("lowercases the TroveManager address regardless of input casing", () => {
    const upper = formatSubgraphTroveId(TROVE_MANAGER.toUpperCase(), TROVE_HEX);
    const lower = formatSubgraphTroveId(TROVE_MANAGER.toLowerCase(), TROVE_HEX);
    expect(upper).toBe(lower);
    expect(upper.startsWith("0x")).toBe(true);
    expect(upper).toMatch(/^0x[0-9a-f]+:/);
  });

  it("emits hex without leading zeros (matching AssemblyScript BigInt.toHexString)", () => {
    // troveId = 1 must render as 0x1, not 0x0000…0001
    const id = formatSubgraphTroveId(TROVE_MANAGER, "1");
    expect(id.endsWith(":0:0x1")).toBe(true);
    // And the same when given the hex literal
    const hexEquivalent = formatSubgraphTroveId(TROVE_MANAGER, "0x1");
    expect(hexEquivalent.endsWith(":0:0x1")).toBe(true);
  });

  it("respects an explicit collIndex other than 0", () => {
    const id = formatSubgraphTroveId(TROVE_MANAGER, TROVE_HEX, 3);
    expect(id).toContain(":3:0x");
  });
});
