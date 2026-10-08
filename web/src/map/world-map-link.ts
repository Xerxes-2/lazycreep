/**
 * World Map 与它的 Sidebar Section 之间的连接（#28）。MapAndRoom 建一个，同时交给 MapView 与区块：
 * - 房间搜索：区块调 `centerOn(text)`；地图挂载后用 `bindCenterOn` 提供实现（相机仍归地图管）。
 * - 指向房间：地图把鼠标悬停 / 点按的房间写进 `setPointed`，区块读 `pointed()`。
 */
import { createSignal, type Accessor } from "solid-js";

/** 鼠标悬停（触摸为点按）的房间 */
export interface PointedRoom {
  readonly shard: string;
  readonly room: string;
  /** 所有者（或预定者）用户名与 RCL（预定时 rcl 为 undefined）；无主或还不知道时缺省 */
  readonly owner?: { readonly username: string; readonly rcl: number | undefined };
}

/**
 * 居中结果：true 已居中；false 不是房间名或在世界之外；undefined 地图还没就绪（不提示）。
 */
export type CenterResult = boolean | undefined;

export interface WorldMapLink {
  centerOn(text: string): CenterResult;
  /** 地图端注册居中实现；返回注销函数 */
  bindCenterOn(impl: (text: string) => CenterResult): () => void;
  /** 从 Room View 回到地图时要居中的房间（保持缩放）；地图用户拖动 / 缩放后清除 */
  focusRoom(): string | undefined;
  setFocusRoom(room: string | undefined): void;
  readonly pointed: Accessor<PointedRoom | undefined>;
  setPointed(room: PointedRoom | undefined): void;
}

export function createWorldMapLink(): WorldMapLink {
  let impl: ((text: string) => CenterResult) | undefined;
  const [pointed, setPointed] = createSignal<PointedRoom>();
  const [focusRoom, setFocusRoom] = createSignal<string>();
  return {
    centerOn: (text) => impl?.(text),
    bindCenterOn(next) {
      impl = next;
      return () => {
        if (impl === next) impl = undefined;
      };
    },
    pointed,
    setPointed: (room) => setPointed(room),
    focusRoom,
    setFocusRoom: (room) => setFocusRoom(room),
  };
}
