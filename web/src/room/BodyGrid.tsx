/**
 * 对象详情的身体部件网格（#59），照官方对象面板（app.css `.object-properties .body .bodypart`）：
 * 圆形小格，按 body 顺序每行 10 格，只画实有的部件（官方不画空格）；颜色与 Room View 身体环同一张表；
 * 剩余血量从下往上填充（官方用黑色遮罩从上往下盖住损失的部分），0 HP 只剩彩色空框；强化加白色粗框。
 *
 * 单格的类型、血量、强化矿物显示在网格下方的说明行：鼠标悬停时显示、移开时收起；触屏按下（含长按）即显示，
 * 一直保留到按下别的格子。没有用 `title`：触屏看不到，长按还会弹出系统菜单（这里拦掉了 contextmenu）。
 */
import { createEffect, createMemo, createSignal, Index, on, Show } from "solid-js";
import { useI18n, type MessageKey } from "../i18n";
import type { BodyCell } from "./object-details.ts";

const KNOWN_PARTS = new Set(["tough", "work", "carry", "move", "attack", "ranged_attack", "heal", "claim"]);

export interface BodyGridProps {
  /** 选中对象的 id；换对象时收起说明行 */
  readonly objectId: string;
  readonly cells: readonly BodyCell[];
  /** 缩写汇总，例如 `5W 3C 8M` */
  readonly summary: string;
}

export function BodyGrid(props: BodyGridProps) {
  const { t } = useI18n();
  const [active, setActive] = createSignal<number>();
  const objectId = createMemo(() => props.objectId);
  createEffect(on(objectId, () => setActive(undefined), { defer: true }));

  const describe = (cell: BodyCell) => {
    const part = KNOWN_PARTS.has(cell.type) ? t(`roomDetails.part.${cell.type}` as MessageKey) : cell.type;
    const info = cell.hits === undefined ? part : t("roomDetails.partInfo", { part, hits: cell.hits });
    return cell.boost ? `${info} · ${t("roomDetails.partBoost", { boost: cell.boost })}` : info;
  };
  const activeCell = () => {
    const i = active();
    return i === undefined ? undefined : props.cells[i];
  };

  return (
    <>
      <div
        class="body-grid"
        role="group"
        aria-label={t("roomDetails.bodyGrid")}
        data-testid="body-grid"
        onContextMenu={(e) => e.preventDefault()}
      >
        <Index each={props.cells}>
          {(cell, i) => (
            <span
              class="body-grid__cell"
              role="img"
              aria-label={describe(cell())}
              data-part={cell().type}
              data-fill={cell().fill}
              data-boost={cell().boost}
              data-active={active() === i ? "" : undefined}
              style={{ "--part-color": cell().color, "--part-fill": `${cell().fill * 100}%` }}
              onPointerEnter={(e) => {
                if (e.pointerType !== "touch") setActive(i);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType !== "touch" && active() === i) setActive(undefined);
              }}
              onPointerDown={(e) => {
                if (e.pointerType === "touch") setActive(i);
              }}
            />
          )}
        </Index>
      </div>
      <div class="body-grid__summary" data-body-summary>
        {props.summary}
      </div>
      <Show when={activeCell()}>
        {(cell) => (
          <p class="body-grid__info" data-part-info role="status">
            {describe(cell())}
          </p>
        )}
      </Show>
    </>
  );
}
