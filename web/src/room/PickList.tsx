/**
 * 同格多个对象时的选择列表（#60，照官方客户端）：浮在 Room View 画布上点击处旁边，夹在画布之内。
 * 点一行选中该对象；Esc、点列表外关闭（平移 / 缩放由 room-controls 关闭）。
 * 键盘：上下移动、Home / End、回车或空格确认。条目与位置的规则在 pick-list.ts。
 */
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useI18n } from "../i18n";
import { placePickList, type PickEntry } from "./pick-list.ts";

export interface PickListProps {
  readonly entries: readonly PickEntry[];
  /** 点击处（画布 CSS 像素） */
  readonly anchor: { readonly x: number; readonly y: number };
  /** 画布尺寸（CSS 像素） */
  readonly frame: { readonly width: number; readonly height: number };
  readonly onPick: (id: string) => void;
  readonly onClose: () => void;
}

const hex = (color: number) => `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;

export function PickList(props: PickListProps) {
  const { t } = useI18n();
  let list!: HTMLUListElement;
  const [active, setActive] = createSignal(0);
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const place = () => placePickList(props.anchor, size(), props.frame);
  const current = () => Math.min(active(), props.entries.length - 1);

  onMount(() => {
    setSize({ width: list.offsetWidth, height: list.offsetHeight });
    list.focus({ preventScroll: true });
    // 捕获阶段：先于快捷键（Esc 原本是 shell.close）与画布手势
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !list.contains(event.target)) props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    });
  });

  const onKeyDown = (event: KeyboardEvent) => {
    const count = props.entries.length;
    if (count === 0) return;
    let next: number | undefined;
    switch (event.key) {
      case "ArrowDown":
        next = (current() + 1) % count;
        break;
      case "ArrowUp":
        next = (current() - 1 + count) % count;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = count - 1;
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        props.onPick(props.entries[current()]!.id);
        return;
      default:
        return;
    }
    event.preventDefault();
    setActive(next);
    document.getElementById(optionId(props.entries[next]!.id))?.scrollIntoView?.({ block: "nearest" });
  };

  const optionId = (id: string) => `pick-list-${id}`;

  return (
    <ul
      ref={list}
      class="pick-list"
      data-testid="pick-list"
      role="listbox"
      tabIndex={-1}
      aria-label={t("pickList.label")}
      aria-activedescendant={props.entries[current()] ? optionId(props.entries[current()]!.id) : undefined}
      style={{ left: `${place().left}px`, top: `${place().top}px` }}
      onKeyDown={onKeyDown}
    >
      <For each={props.entries}>
        {(entry, index) => (
          <li
            id={optionId(entry.id)}
            class="pick-list__item"
            role="option"
            data-object-id={entry.id}
            aria-selected={index() === current()}
            onPointerEnter={() => setActive(index())}
            onClick={() => props.onPick(entry.id)}
          >
            <span
              class="pick-list__mark"
              aria-hidden="true"
              style={entry.color === undefined ? undefined : { background: hex(entry.color) }}
            />
            <span class="pick-list__label">{entry.name ?? entry.type}</span>
            <Show when={entry.owner}>{(owner) => <span class="pick-list__owner">{owner()}</span>}</Show>
          </li>
        )}
      </For>
    </ul>
  );
}
