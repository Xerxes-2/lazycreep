/**
 * 一键复制按钮：写剪贴板，短暂显示 ✓ / ✗；没有剪贴板 API 时退回 execCommand("copy")；按钮不带文字。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { I18nProvider } from "../i18n";
import { COPY_FEEDBACK_MS, CopyButton } from "./CopyButton.tsx";

let container: HTMLDivElement;
let dispose: (() => void) | undefined;
const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function mount(text: string) {
  dispose = render(
    () => (
      <I18nProvider>
        <span data-testid="host">
          {text}
          <CopyButton text={text} name="room" />
        </span>
      </I18nProvider>
    ),
    container,
  );
  return container.querySelector<HTMLButtonElement>("button[data-copy=room]")!;
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  container.remove();
  vi.useRealTimers();
  if (original) Object.defineProperty(navigator, "clipboard", original);
  else delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("一键复制", () => {
  it("点击写入剪贴板，短暂显示“已复制”后复原；按钮不带文字，不改变所在元素的文字", async () => {
    vi.useFakeTimers();
    const written: string[] = [];
    stubClipboard(async (text) => void written.push(text));
    const button = mount("W13S28");
    expect(container.querySelector("[data-testid=host]")!.textContent).toBe("W13S28");
    expect(button.getAttribute("aria-label")).toBe("复制 W13S28");
    button.click();
    await vi.waitFor(() => expect(button.dataset.state).toBe("copied"));
    expect(written).toEqual(["W13S28"]);
    expect(button.getAttribute("aria-label")).toBe("已复制");
    vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    expect(button.dataset.state).toBe("idle");
  });

  it("写入失败时显示“复制失败”", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    const button = mount("Xerxes_2");
    button.click();
    await vi.waitFor(() => expect(button.dataset.state).toBe("failed"));
    expect(button.title).toBe("复制失败");
  });

  it("没有剪贴板 API（非安全上下文）时退回 execCommand", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    const copied: string[] = [];
    const exec = vi.fn(() => {
      copied.push((document.activeElement as HTMLTextAreaElement | null)?.value ?? (document.querySelector("textarea")?.value ?? ""));
      return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
    const button = mount("3W 2C 5M");
    button.click();
    await vi.waitFor(() => expect(button.dataset.state).toBe("copied"));
    expect(exec).toHaveBeenCalledWith("copy");
    expect(copied).toEqual(["3W 2C 5M"]);
    expect(document.querySelector("textarea")).toBeNull();
  });
});
