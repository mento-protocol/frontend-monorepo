import { describe, expect, it, vi } from "vitest";

import type { config } from "@wormhole-foundation/wormhole-connect";

import {
  BLOCKED,
  UNVERIFIED,
  createBridgeTransferValidator,
  screenAddress,
} from "./transfer-screening";

type TransferDetails = Parameters<
  NonNullable<config.WormholeConnectConfig["validateTransferHandler"]>
>[0];

const SOURCE = "0x1111111111111111111111111111111111111111";
const DESTINATION = "0x2222222222222222222222222222222222222222";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeFetch(respond: (address: string) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    return respond(url.searchParams.get("address") ?? "");
  });
}

function transfer(
  fromWalletAddress: string,
  toWalletAddress: string,
): TransferDetails {
  return { fromWalletAddress, toWalletAddress } as TransferDetails;
}

describe("createBridgeTransferValidator", () => {
  it("allows the transfer when both wallets are cleared", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ isSanctioned: false }));
    const validate = createBridgeTransferValidator(fetchImpl);

    await expect(validate(transfer(SOURCE, DESTINATION))).resolves.toEqual({
      isValid: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects the transfer when the source wallet is not eligible", async () => {
    const fetchImpl = fakeFetch((address) =>
      jsonResponse({ isSanctioned: address === SOURCE }),
    );
    const validate = createBridgeTransferValidator(fetchImpl);

    await expect(validate(transfer(SOURCE, DESTINATION))).resolves.toEqual({
      isValid: false,
      error: BLOCKED,
    });
  });

  it("rejects the transfer when the destination wallet is not eligible", async () => {
    const fetchImpl = fakeFetch((address) =>
      jsonResponse({ isSanctioned: address === DESTINATION }),
    );
    const validate = createBridgeTransferValidator(fetchImpl);

    await expect(validate(transfer(SOURCE, DESTINATION))).resolves.toEqual({
      isValid: false,
      error: BLOCKED,
    });
  });

  it("rejects the transfer when the check returns 502", async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({ isSanctioned: null, error: "check_failed" }, 502),
    );
    const validate = createBridgeTransferValidator(fetchImpl);

    await expect(validate(transfer(SOURCE, DESTINATION))).resolves.toEqual({
      isValid: false,
      error: UNVERIFIED,
    });
  });

  it("rejects the transfer when a non-2xx response reports the wallet as cleared", async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({ isSanctioned: false }, 503),
    );
    const validate = createBridgeTransferValidator(fetchImpl);

    await expect(validate(transfer(SOURCE, DESTINATION))).resolves.toEqual({
      isValid: false,
      error: UNVERIFIED,
    });
  });

  it("reports the ineligible message when one wallet is ineligible and the other unverified", async () => {
    const fetchImpl = fakeFetch((address) =>
      address === SOURCE
        ? jsonResponse({ isSanctioned: true })
        : jsonResponse({ isSanctioned: null, error: "check_failed" }, 502),
    );
    const validate = createBridgeTransferValidator(fetchImpl);

    await expect(validate(transfer(SOURCE, DESTINATION))).resolves.toEqual({
      isValid: false,
      error: BLOCKED,
    });
  });

  it("rejects the transfer when the check is rate limited", async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({ error: "Too many requests" }, 429),
    );
    const validate = createBridgeTransferValidator(fetchImpl);

    await expect(validate(transfer(SOURCE, DESTINATION))).resolves.toEqual({
      isValid: false,
      error: UNVERIFIED,
    });
  });

  it("rejects the transfer when the request throws", async () => {
    const fetchImpl = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const validate = createBridgeTransferValidator(fetchImpl);

    await expect(validate(transfer(SOURCE, DESTINATION))).resolves.toEqual({
      isValid: false,
      error: UNVERIFIED,
    });
  });

  it("rejects the transfer when the response is not valid JSON", async () => {
    const fetchImpl = fakeFetch(() => new Response("<html>", { status: 200 }));
    const validate = createBridgeTransferValidator(fetchImpl);

    await expect(validate(transfer(SOURCE, DESTINATION))).resolves.toEqual({
      isValid: false,
      error: UNVERIFIED,
    });
  });

  it("rejects the transfer when the result is not a boolean", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ isSanctioned: null }));
    const validate = createBridgeTransferValidator(fetchImpl);

    await expect(validate(transfer(SOURCE, DESTINATION))).resolves.toEqual({
      isValid: false,
      error: UNVERIFIED,
    });
  });

  it("allows the transfer on the route's degraded pass", async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse({ isSanctioned: false, degraded: true }),
    );
    const validate = createBridgeTransferValidator(fetchImpl);

    await expect(validate(transfer(SOURCE, DESTINATION))).resolves.toEqual({
      isValid: true,
    });
  });

  it("checks the same wallet only once regardless of case", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ isSanctioned: false }));
    const validate = createBridgeTransferValidator(fetchImpl);
    const mixedCase = "0xAbCdEf0123456789abcdef0123456789ABCDEF01";

    await expect(
      validate(transfer(mixedCase, mixedCase.toLowerCase())),
    ).resolves.toEqual({ isValid: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects the transfer without a request when a wallet is missing", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ isSanctioned: false }));
    const validate = createBridgeTransferValidator(fetchImpl);

    await expect(validate(transfer(SOURCE, ""))).resolves.toEqual({
      isValid: false,
      error: UNVERIFIED,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("screenAddress", () => {
  it("URL-encodes the address", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ isSanctioned: false }));

    await expect(screenAddress("0xabc&x=1 #", fetchImpl)).resolves.toBe(
      "cleared",
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/sanctions?address=0xabc%26x%3D1%20%23",
    );
  });
});
