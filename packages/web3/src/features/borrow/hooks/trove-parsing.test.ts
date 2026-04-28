import { describe, expect, it } from "vitest";
import { parseBorrowPositionSafe } from "./trove-parsing";

describe("parseBorrowPositionSafe", () => {
  it("maps raw trove status 4 to zombie", () => {
    const position = parseBorrowPositionSafe(
      255n,
      [100n, 200n, 3n, 4n, 5n, 95n, 6n, 0n, 7n, 123n],
      [
        0n,
        0n,
        0n,
        4n,
        0n,
        456n,
        0n,
        0n,
        "0x0000000000000000000000000000000000000000",
        0n,
      ],
    );

    expect(position.troveId).toBe("0xff");
    expect(position.status).toBe("zombie");
  });
});
