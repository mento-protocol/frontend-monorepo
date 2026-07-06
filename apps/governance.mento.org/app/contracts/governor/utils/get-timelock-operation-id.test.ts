import { describe, expect, it } from "vitest";
import { getTimelockOperationId } from "./get-timelock-operation-id";

const TARGETS = ["0x1111111111111111111111111111111111111111"] as const;
const VALUES = [0n] as const;
const CALLDATAS = ["0xabcdef12"] as const;
const DESCRIPTION_HASH = `0x${"1".repeat(64)}` as `0x${string}`;
const OTHER_DESCRIPTION_HASH = `0x${"2".repeat(64)}` as `0x${string}`;

// Computed independently with viem's keccak256/encodePacked and the zero
// salt for the fixture above (not via getTimelockOperationId itself).
const EXPECTED_ID =
  "0x34a36e06462b90188a50a5233575b357140488a1f43706efb3171cf7f4e4fca1";

describe("getTimelockOperationId", () => {
  it("matches a hand-computed fixture", () => {
    expect(
      getTimelockOperationId(TARGETS, VALUES, CALLDATAS, DESCRIPTION_HASH),
    ).toBe(EXPECTED_ID);
  });

  it("returns a 66-char 0x-prefixed hex string", () => {
    const id = getTimelockOperationId(
      TARGETS,
      VALUES,
      CALLDATAS,
      DESCRIPTION_HASH,
    );
    expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(id).toHaveLength(66);
  });

  it("produces a different id for a different description hash", () => {
    const id = getTimelockOperationId(
      TARGETS,
      VALUES,
      CALLDATAS,
      DESCRIPTION_HASH,
    );
    const otherId = getTimelockOperationId(
      TARGETS,
      VALUES,
      CALLDATAS,
      OTHER_DESCRIPTION_HASH,
    );
    expect(otherId).not.toBe(id);
  });

  it("is deterministic for the same inputs", () => {
    const first = getTimelockOperationId(
      TARGETS,
      VALUES,
      CALLDATAS,
      DESCRIPTION_HASH,
    );
    const second = getTimelockOperationId(
      TARGETS,
      VALUES,
      CALLDATAS,
      DESCRIPTION_HASH,
    );
    expect(second).toBe(first);
  });
});
