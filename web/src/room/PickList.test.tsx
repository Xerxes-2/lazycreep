/**
 * #60 选择列表：每 Tick 条目重建成新对象时行不重建，否则按下与松开落在不同元素上会丢 click。
 */
import { afterEach, expect, it } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { I18nProvider } from "../i18n";
import { PickList } from "./PickList.tsx";
import type { PickEntry } from "./pick-list.ts";

const entries = (): PickEntry[] => [
  { id: "a", type: "creep", name: "a", owner: undefined, color: undefined },
  { id: "b", type: "road", name: undefined, owner: undefined, color: undefined },
];

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

it("条目换成新对象时行元素保持不变", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const [list, setList] = createSignal(entries());
  dispose = render(
    () => (
      <I18nProvider>
        <PickList entries={list()} anchor={{ x: 0, y: 0 }} frame={{ width: 500, height: 500 }} onPick={() => {}} onClose={() => {}} />
      </I18nProvider>
    ),
    container,
  );
  const row = container.querySelector('[data-object-id="b"]');
  setList(entries());
  expect(container.querySelector('[data-object-id="b"]')).toBe(row);
  container.remove();
});
