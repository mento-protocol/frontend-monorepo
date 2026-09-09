// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  context: vi.fn(),
  tag: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.capture,
  withScope: (
    callback: (scope: {
      setTag: typeof mocks.tag;
      setContext: typeof mocks.context;
    }) => void,
  ) => callback({ setTag: mocks.tag, setContext: mocks.context }),
}));

import { ContractAPIService } from "./contract-api-service";

const address = "0x1111111111111111111111111111111111111111";
const response = (data: unknown, ok = true, status = 200, statusText = "OK") =>
  ({
    ok,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(data),
  }) as unknown as Response;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("ContractAPIService", () => {
  it("fetches, caches, and persists an ABI", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response({ abi: [{ type: "function" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new ContractAPIService();
    expect(await service.getContractABI(address)).toEqual([
      { type: "function" },
    ]);
    expect(await service.getContractABI(address.toUpperCase())).toEqual([
      { type: "function" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(1);
  });

  it("deduplicates pending ABI requests", async () => {
    let finish: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new ContractAPIService();
    const first = service.getContractABI(address);
    const second = service.getContractABI(address);
    finish?.(response({ abi: [] }));
    expect(await first).toEqual(await second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handles missing and failed ABI responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({}, false, 404, "Not Found"))
      .mockResolvedValueOnce(response({}, false, 500, "Failed"))
      .mockResolvedValueOnce(response({ abi: "invalid" }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new ContractAPIService();
    expect(await service.getContractABI(address)).toBeNull();
    expect(
      await service.getContractABI(
        "0x2222222222222222222222222222222222222222",
      ),
    ).toBeNull();
    expect(
      await service.getContractABI(
        "0x3333333333333333333333333333333333333333",
      ),
    ).toBeNull();
  });

  it("fetches, caches, and persists contract information", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ name: "Governor" }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new ContractAPIService();
    expect(await service.getContractInfo(address)).toEqual({
      name: "Governor",
    });
    expect(await service.getContractInfo(address)).toEqual({
      name: "Governor",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates and handles missing contract information", async () => {
    let finish: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new ContractAPIService();
    const first = service.getContractInfo(address);
    const second = service.getContractInfo(address);
    finish?.(response({}));
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handles 404 and server errors for contract information", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({}, false, 404, "Not Found"))
      .mockResolvedValueOnce(response({}, false, 500, "Failed"));
    vi.stubGlobal("fetch", fetchMock);
    const service = new ContractAPIService();
    expect(await service.getContractInfo(address)).toBeNull();
    expect(
      await service.getContractInfo(
        "0x2222222222222222222222222222222222222222",
      ),
    ).toBeNull();
  });

  it("clears only contract caches from memory and storage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ abi: [] })));
    const service = new ContractAPIService();
    localStorage.setItem("contract_abi_old", "value");
    localStorage.setItem("contract_info_old", "value");
    localStorage.setItem("other", "value");
    service.clearCaches();
    expect(localStorage.getItem("contract_abi_old")).toBeNull();
    expect(localStorage.getItem("contract_info_old")).toBeNull();
    expect(localStorage.getItem("other")).toBe("value");
  });
});
