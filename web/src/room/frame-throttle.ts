/**
 * 每个动画帧至多提交一次：这一帧还没提交过就立即提交（低速服务器与现在一样即时），
 * 同一帧里后来的只留最新的，到下一帧再提交。
 *
 * 私服可以几毫秒一个 Tick（fabot sim `--tick-ms 0` 实测每个房间每秒约 100 帧），每帧都要重建 Room Scene
 * 并让 Pixi 逐个比较上千个图元；屏幕一秒只画 60 帧左右，多出来的构建画不出来，只占主线程。
 */
import type { FlushScheduler } from "../source/room-map-hub.ts";

export interface FrameThrottle<T> {
  push(value: T): void;
  /** 丢掉没提交的，不再提交 */
  dispose(): void;
}

export function createFrameThrottle<T>(schedule: FlushScheduler, commit: (value: T) => void): FrameThrottle<T> {
  /** 这一帧已提交过：等到下一帧前来的都先留着 */
  let cancel: (() => void) | undefined;
  let pending: { readonly value: T } | undefined;
  const hold = () => {
    cancel = schedule(() => {
      cancel = undefined;
      if (!pending) return;
      const { value } = pending;
      pending = undefined;
      commit(value);
      hold();
    });
  };
  return {
    push(value) {
      if (cancel) {
        pending = { value };
        return;
      }
      commit(value);
      hold();
    },
    dispose() {
      cancel?.();
      cancel = undefined;
      pending = undefined;
    },
  };
}
