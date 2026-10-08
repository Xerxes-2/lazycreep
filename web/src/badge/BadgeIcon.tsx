/**
 * DOM 里的徽章（#43）：Top Bar 自己的徽章、PvP 卡片参战者名字旁。
 * 没有徽章（如 Source Keeper）或资料未到时显示中性占位，尺寸不变、布局不跳动。
 * 用 <img> 加载 SVG data URL：每个徽章是独立文档，官方 SVG 里固定的 clipPath id 不会互相冲突。
 */
import type { Badge } from "./badge.ts";
import { badgeSvgUrl } from "./badge-image.ts";

export function BadgeIcon(props: { readonly badge: Badge | undefined; readonly title?: string | undefined }) {
  return (
    <img
      class="badge-icon"
      src={badgeSvgUrl(props.badge)}
      data-badge={props.badge ? "set" : "none"}
      alt=""
      title={props.title}
      aria-hidden={props.title === undefined ? "true" : undefined}
      draggable={false}
    />
  );
}
