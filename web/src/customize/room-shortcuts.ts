/**
 * Room View 的快捷键执行者（#5）：Live / Replay 切换、Replay 播放暂停与单步。
 * 没打开房间、或不在 Replay 里时返回 false（不拦截按键）。随调用处的 Solid owner 注销。
 */
import { onCleanup, type Accessor } from "solid-js";
import type { ReplayController } from "../replay/replay-controller.ts";
import type { ShortcutCommands } from "./keybindings.ts";

export interface RoomShortcutTarget {
  readonly replay: ReplayController;
  readonly target: Accessor<{ readonly shard: string; readonly room: string } | undefined>;
  /** Live 当前 Tick（进入 Replay 的起点） */
  readonly liveTick: Accessor<number | undefined>;
}

export function registerRoomShortcuts(commands: ShortcutCommands | undefined, room: RoomShortcutTarget): void {
  if (!commands) return;
  const { replay } = room;
  const step = (delta: number) => () => {
    const engine = replay.engine();
    if (!engine) return false;
    engine.step(delta);
    return true;
  };
  onCleanup(
    commands.register({
      "replay.toggle": () => {
        if (replay.active()) return void replay.close();
        const current = room.target();
        if (!current) return false;
        replay.enterFromLive(current.shard, current.room, room.liveTick());
        return true;
      },
      "replay.playPause": () => {
        const engine = replay.engine();
        const snapshot = replay.snapshot();
        if (!engine || !snapshot) return false;
        if (snapshot.playing) engine.pause();
        else engine.play();
        return true;
      },
      "replay.stepBack": step(-1),
      "replay.stepForward": step(1),
    }),
  );
}
