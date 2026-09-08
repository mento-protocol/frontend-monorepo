import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CoinInput } from "./coin-input.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CoinInput", () => {
  it.each([
    ["", ""],
    ["12", "12"],
    ["0012", "0012"],
    ["12.5", "12.5"],
    ["12,5", "12.5"],
    [".5", "0.5"],
    [",5", "0.5"],
  ])("accepts %s as %s", (enteredValue, callbackValue) => {
    const onChange = vi.fn();
    render(
      <CoinInput
        aria-label="Amount"
        defaultValue={enteredValue === "" ? "1" : undefined}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: enteredValue },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].target.value).toBe(callbackValue);
  });

  it.each(["1.2.3", "1,2,3", "12x", "-"])(
    "rejects invalid value %s",
    (enteredValue) => {
      vi.useFakeTimers();
      const onChange = vi.fn();
      render(
        <CoinInput
          aria-label="Amount"
          value="7"
          onChange={onChange}
          readOnly
        />,
      );
      const input = screen.getByLabelText<HTMLInputElement>("Amount");

      fireEvent.change(input, { target: { value: enteredValue } });
      vi.runAllTimers();

      expect(onChange).not.toHaveBeenCalled();
      expect(input.value).toBe("7");
    },
  );

  it("rejects values longer than 100 characters", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <CoinInput aria-label="Amount" value="9" onChange={onChange} readOnly />,
    );
    const input = screen.getByLabelText<HTMLInputElement>("Amount");

    fireEvent.change(input, { target: { value: "1".repeat(101) } });
    vi.runAllTimers();

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("9");
  });

  it("allows editing keys and clipboard shortcuts", () => {
    render(<CoinInput aria-label="Amount" defaultValue="12" />);
    const input = screen.getByLabelText("Amount");

    for (const key of [
      "Backspace",
      "Delete",
      "ArrowLeft",
      "ArrowRight",
      "Tab",
      "Home",
      "End",
      "0",
      "9",
      ".",
      ",",
    ]) {
      expect(fireEvent.keyDown(input, { key })).toBe(true);
    }
    for (const key of ["a", "c", "v", "x"]) {
      expect(fireEvent.keyDown(input, { key, ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(input, { key, metaKey: true })).toBe(true);
    }
  });

  it("blocks invalid keys and a second decimal separator", () => {
    render(<CoinInput aria-label="Amount" defaultValue="1.2" />);
    const input = screen.getByLabelText("Amount");

    expect(fireEvent.keyDown(input, { key: "e" })).toBe(false);
    expect(fireEvent.keyDown(input, { key: "." })).toBe(false);
    expect(fireEvent.keyDown(input, { key: "," })).toBe(false);
  });

  it("supports a custom input type and omitted change callback", () => {
    render(<CoinInput aria-label="Amount" type="number" />);
    const input = screen.getByLabelText<HTMLInputElement>("Amount");

    fireEvent.change(input, { target: { value: "1" } });

    expect(input.type).toBe("number");
  });
});
