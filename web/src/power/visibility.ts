/**
 * 页面可见性信号：省电规则的公共入口（#14）。
 * 页面不可见时暂停渲染、退订非必要频道、暂停轮询；回到前台后恢复。
 * 需要这些行为的模块都订阅同一个 VisibilitySignal，测试里换成 manualVisibility。
 */

export type Unsubscribe = () => void;

export interface VisibilitySignal {
  /** 当前是否可见 */
  visible(): boolean;
  /** 可见性变化时通知（订阅时不立即回调）。 */
  subscribe(listener: (visible: boolean) => void): Unsubscribe;
}

/** 手动控制的信号：测试用，或嵌入没有 document 的环境。 */
export interface ManualVisibility extends VisibilitySignal {
  set(visible: boolean): void;
}

export function manualVisibility(initial = true): ManualVisibility {
  let visible = initial;
  const listeners = new Set<(visible: boolean) => void>();
  return {
    visible: () => visible,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(next) {
      if (next === visible) return;
      visible = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}

/** 文档可见性需要的最小能力。 */
export type VisibilityDocument = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

/** 跟随 `document.visibilitychange` 的信号。 */
export function documentVisibility(doc: VisibilityDocument): VisibilitySignal {
  const visible = () => doc.visibilityState !== "hidden";
  return {
    visible,
    subscribe(listener) {
      // 每个订阅各挂一个监听：没人订阅时不留监听器
      let last = visible();
      const update = () => {
        const next = visible();
        if (next === last) return;
        last = next;
        listener(next);
      };
      doc.addEventListener("visibilitychange", update);
      return () => doc.removeEventListener("visibilitychange", update);
    },
  };
}

/** 恒为可见的信号：给不随页面隐藏暂停的活动用（例如告警依赖的轮询） */
export const ALWAYS_VISIBLE: VisibilitySignal = {
  visible: () => true,
  subscribe: () => () => {},
};

let page: VisibilitySignal | undefined;

/** 当前页面的可见性；没有 document（Node）时视为一直可见。 */
export function pageVisibility(): VisibilitySignal {
  page ??= typeof document === "undefined" ? manualVisibility(true) : documentVisibility(document);
  return page;
}

/**
 * 可见期间保持 `start` 启动的活动：可见时调用 `start`，隐藏时调用它返回的停止函数，
 * 回到前台再调用 `start`。返回的函数彻底退订（若正在运行则先停止）。
 */
export function whileVisible(signal: VisibilitySignal, start: () => (() => void) | void): Unsubscribe {
  let stop: (() => void) | void | undefined;
  let running = false;
  const apply = (visible: boolean) => {
    if (visible && !running) {
      running = true;
      stop = start();
    } else if (!visible && running) {
      running = false;
      const s = stop;
      stop = undefined;
      s?.();
    }
  };
  const off = signal.subscribe(apply);
  apply(signal.visible());
  return () => {
    off();
    apply(false);
  };
}

/**
 * 可见期间轮询：可见时立即执行一次，每次完成后隔 `intervalMs` 再执行；
 * 隐藏期间不执行也不留定时器，回到前台立即补一次。任务失败不影响后续轮询。
 */
export function pollWhileVisible(
  signal: VisibilitySignal,
  task: () => Promise<unknown> | unknown,
  intervalMs: number,
): Unsubscribe {
  return whileVisible(signal, () => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      timer = undefined;
      let result: Promise<unknown>;
      try {
        result = Promise.resolve(task());
      } catch (error) {
        result = Promise.reject(error);
      }
      result
        .catch(() => {})
        .then(() => {
          if (active) timer = setTimeout(run, intervalMs);
        });
    };
    run();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  });
}
