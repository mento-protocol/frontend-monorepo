import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env.mjs", () => ({
  env: {
    NEXT_PUBLIC_BLOCKSCOUT_API_URL: "https://blockscout.test",
    NEXT_PUBLIC_ETHERSCAN_API_URL: "https://celoscan.test",
  },
}));

import {
  fetchAbi,
  fetchFromBlockchainExplorer,
} from "./blockchain-explorer-service";

const addr = (digit: string) => `0x${digit.repeat(40)}`;
function response(
  data: unknown,
  options: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    text?: string;
    textReject?: boolean;
  } = {},
) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText ?? "OK",
    json: vi.fn().mockResolvedValue(data),
    text: options.textReject
      ? vi.fn().mockRejectedValue(new Error("text failed"))
      : vi.fn().mockResolvedValue(options.text ?? JSON.stringify(data)),
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe("blockchain explorer service", () => {
  it("fetches and caches Blockscout ABIs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ abi: [{ type: "function" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const address = addr("1");
    expect(
      await fetchFromBlockchainExplorer<{ abi: unknown[] }>(
        "getabi",
        address.toUpperCase(),
        "blockscout",
      ),
    ).toEqual({ abi: [{ type: "function" }] });
    expect(
      await fetchFromBlockchainExplorer(
        "getabi",
        address.toUpperCase(),
        "blockscout",
      ),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(address);
  });

  it("deduplicates pending requests", async () => {
    let finish: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const first = fetchFromBlockchainExplorer(
      "getabi",
      addr("2"),
      "blockscout",
    );
    const second = fetchFromBlockchainExplorer(
      "getabi",
      addr("2"),
      "blockscout",
    );
    finish?.(response({ abi: [] }));
    expect(await first).toEqual(await second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches Blockscout source code and rejects incomplete records", async () => {
    const valid = {
      name: "Contract",
      source_code: "code",
      abi: [],
      compiler_version: "",
      optimization_enabled: false,
      optimizations_runs: 0,
      evm_version: "",
      license_type: "",
      proxy_type: null,
      implementations: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(valid))
      .mockResolvedValueOnce(response({ message: "unverified" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await fetchFromBlockchainExplorer(
        "getsourcecode",
        addr("3"),
        "blockscout",
      ),
    ).toEqual(valid);
    expect(
      await fetchFromBlockchainExplorer(
        "getsourcecode",
        addr("4"),
        "blockscout",
      ),
    ).toBeNull();
  });

  it("rejects invalid Blockscout ABI data", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(response({ abi: "bad", message: "unverified" })),
    );
    expect(
      await fetchFromBlockchainExplorer("getabi", addr("5"), "blockscout"),
    ).toBeNull();
  });

  it("handles Blockscout HTTP error bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {},
          {
            ok: false,
            status: 400,
            text: '{"status":"0","message":"missing"}',
          },
        ),
      )
      .mockResolvedValueOnce(
        response(
          {},
          { ok: false, status: 500, text: '{"status":"2","message":"bad"}' },
        ),
      )
      .mockResolvedValueOnce(
        response({}, { ok: false, status: 500, text: "not json" }),
      )
      .mockResolvedValueOnce(
        response({}, { ok: false, status: 500, textReject: true }),
      );
    vi.stubGlobal("fetch", fetchMock);
    for (const digit of ["6", "7", "8", "9"])
      expect(
        await fetchFromBlockchainExplorer("getabi", addr(digit), "blockscout"),
      ).toBeNull();
  });

  it("requires a Celoscan API key", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect(
      await fetchFromBlockchainExplorer("getabi", addr("a"), "celoscan"),
    ).toBeNull();
  });

  it("handles successful and unsuccessful Celoscan payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ status: "1", result: "[]" }))
      .mockResolvedValueOnce(response({ status: "0", message: "NOTOK" }))
      .mockResolvedValueOnce(response({ status: "2", message: "odd" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await fetchFromBlockchainExplorer("getabi", addr("b"), "celoscan", "key"),
    ).toBeTruthy();
    expect(
      await fetchFromBlockchainExplorer("getabi", addr("c"), "celoscan", "key"),
    ).toBeNull();
    expect(
      await fetchFromBlockchainExplorer("getabi", addr("d"), "celoscan", "key"),
    ).toBeNull();
  });

  it("handles Celoscan HTTP errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {},
          { ok: false, status: 500, statusText: "Failed", text: "body" },
        ),
      )
      .mockResolvedValueOnce(
        response({}, { ok: false, status: 500, textReject: true }),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await fetchFromBlockchainExplorer("getabi", addr("e"), "celoscan", "key"),
    ).toBeNull();
    expect(
      await fetchFromBlockchainExplorer("getabi", "invalid", "celoscan", "key"),
    ).toBeNull();
  });

  it("extracts ABIs for both explorer formats", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ abi: [{ name: "one" }] }))
      .mockResolvedValueOnce(
        response({ status: "1", result: '[{"name":"two"}]' }),
      )
      .mockResolvedValueOnce(response({ status: "1", result: "bad" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAbi(addr("f"), "blockscout")).toEqual([{ name: "one" }]);
    expect(
      await fetchAbi(
        "0x1234567890123456789012345678901234567890",
        "celoscan",
        "key",
      ),
    ).toEqual([{ name: "two" }]);
    expect(
      await fetchAbi(
        "0x2234567890123456789012345678901234567890",
        "celoscan",
        "key",
      ),
    ).toBeNull();
  });

  it("returns null when an explorer has no ABI result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ abi: null }))
      .mockResolvedValueOnce(response({ status: "1", result: "" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await fetchAbi(
        "0x3234567890123456789012345678901234567890",
        "blockscout",
      ),
    ).toBeNull();
    expect(
      await fetchAbi(
        "0x4234567890123456789012345678901234567890",
        "celoscan",
        "key",
      ),
    ).toBeNull();
  });
});
