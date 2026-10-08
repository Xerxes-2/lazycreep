/**
 * creep 的 say 气泡（#22）：照官方 `processors/say.js` 的几何（100 = 1 格），两种画风共用。
 * 数据是对象的 `actionLog.say = {message, isPublic}`；服务器在下一 Tick 把它置 null，
 * 所以气泡只在说话的那个 Tick 出现，不另做停留或淡出。
 *
 * 文字宽度在 Scene 里按 {@link estimateTextWidth} 估算，Scene 因此保持纯数据、可测；
 * say 最多 10 个字符，估算误差只让左右留白略有出入。
 */
import type { Color } from "../scene/scene.ts";
import { LAYER, center, type PrimitiveDraft } from "./room-paint.ts";
import type { RoomObject } from "./room-state.ts";
import { arcPoints } from "./official-sprite.ts";

/** 在对象、玩家名与选中框之上，RoomVisual 之下（官方：渲染器的 effects 图层，RoomVisual 是另一块叠加画布） */
export const SAY_LAYER = LAYER.label + 5;

const PRIVATE_FILL: Color = 0xcccccc;
const PUBLIC_FILL: Color = 0xdd8888;
const TEXT_COLOR: Color = 0x111111;
const OUTLINE: Color = 0x000000;

const FONT_SIZE = 0.6;
const PADDING = 0.6;
const RADIUS = 0.3;
const TOP = -1.7;
const BOTTOM = -0.7;
const TIP = -0.44;
const POINTER_HALF = 0.3;
const STROKE = 0.08;

const SAY_TYPES = new Set(["creep", "powerCreep"]);

/** 东亚宽字符（含全角）与 emoji 占 1 em，其余 0.6 em */
const WIDE = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|[ᄀ-ᅟ⺀-〾ぁ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{20000}-\u{3fffd}]/u;
const NARROW_EM = 0.6;

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;

function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return Array.from(text.normalize("NFC"));
}

/**
 * 文字宽度的估算（世界单位）：按字形（grapheme）计，东亚宽字符与 emoji 1 em，其余 0.6 em。
 * 组合 emoji、变体选择符、组合附加符号与前一个字符合成一个字形。
 */
export function estimateTextWidth(text: string, size: number): number {
  let em = 0;
  for (const g of graphemes(text)) em += WIDE.test(g) ? 1 : NARROW_EM;
  return em * size;
}

function sayOf(obj: RoomObject): { readonly message: string; readonly isPublic: boolean } | undefined {
  const log = obj["actionLog"];
  if (typeof log !== "object" || log === null) return undefined;
  const say = (log as Record<string, unknown>)["say"];
  if (typeof say !== "object" || say === null) return undefined;
  const { message, isPublic } = say as Record<string, unknown>;
  if (typeof message !== "string" || message === "") return undefined;
  return { message, isPublic: isPublic === true };
}

/** creep / power creep 本 Tick 的 say 气泡（外框 + 文字）；没说话时为空 */
export function sayBubble(obj: RoomObject): PrimitiveDraft[] {
  const type = obj["type"];
  if (typeof type !== "string" || !SAY_TYPES.has(type)) return [];
  const say = sayOf(obj);
  if (!say) return [];
  const { x, y } = center(obj);
  const width = Math.max(estimateTextWidth(say.message, FONT_SIZE) + PADDING, 2 * RADIUS + 2 * POINTER_HALF);
  const left = x - width / 2;
  const right = x + width / 2;
  const top = y + TOP;
  const bottom = y + BOTTOM;
  const points = [
    ...arcPoints(right - RADIUS, top + RADIUS, RADIUS, -Math.PI / 2, 0),
    ...arcPoints(right - RADIUS, bottom - RADIUS, RADIUS, 0, Math.PI / 2),
    x + POINTER_HALF, bottom,
    x, y + TIP,
    x - POINTER_HALF, bottom,
    ...arcPoints(left + RADIUS, bottom - RADIUS, RADIUS, Math.PI / 2, Math.PI),
    ...arcPoints(left + RADIUS, top + RADIUS, RADIUS, Math.PI, (Math.PI * 3) / 2),
  ];
  return [
    {
      part: "say",
      kind: "polygon",
      layer: SAY_LAYER,
      points,
      fill: say.isPublic ? PUBLIC_FILL : PRIVATE_FILL,
      stroke: { color: OUTLINE, width: STROKE },
    },
    {
      part: "say-text",
      kind: "text",
      layer: SAY_LAYER,
      x,
      y: (top + bottom) / 2,
      text: say.message,
      size: FONT_SIZE,
      color: TEXT_COLOR,
    },
  ];
}
