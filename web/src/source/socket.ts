/**
 * 官方 WebSocket 的一条连接：认证、gzip、频道订阅、断线重连与重订阅。
 * 频道名、帧格式见 docs/research/screeps-api-facts.md 第 2 节。不关心频道的语义，
 * 单房间约束与 payload 转换由 LiveSource 负责。
 */
import type { ConnectionState, Unsubscribe } from "./source.ts";

export interface SocketHandlers {
  open(): void;
  /** 一条文本帧 */
  message(data: string): void;
  /** 连接已关闭（无论原因）；出错时也只报关闭 */
  close(): void;
}

/** 一条原始连接；默认是浏览器（或 Node 22）的 WebSocket。 */
export interface RawSocket {
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string, handlers: SocketHandlers) => RawSocket;

export const browserSocket: SocketFactory = (url, handlers) => {
  const ws = new WebSocket(url);
  ws.onopen = () => handlers.open();
  ws.onmessage = (event) => handlers.message(typeof event.data === "string" ? event.data : String(event.data));
  ws.onclose = () => handlers.close();
  return ws;
};

export interface ReconnectOptions {
  /** 第一次重连前的等待，之后每次翻倍 */
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
}

export interface ChannelHandler {
  data(payload: unknown): void;
  error(message: string): void;
}

/** `gz:` 之后是 base64 的 zlib 数据。 */
async function inflate(base64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const body = new Response(bytes).body;
  if (!body) throw new Error("空的 gz 帧");
  const stream = body.pipeThrough(new DecompressionStream("deflate"));
  return new Response(stream).text();
}

export class ChannelSocket {
  private state: ConnectionState = "disconnected";
  private readonly stateListeners = new Set<(state: ConnectionState) => void>();
  private readonly channels = new Map<string, Set<ChannelHandler>>();
  private socket: RawSocket | undefined;
  /** 每建一条连接加一；旧连接的回调据此作废。 */
  private generation = 0;
  private authenticated = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  /** gz 帧解码是异步的：有未完成的解码时，后续帧排队以保持顺序。 */
  private inbox: Promise<void> = Promise.resolve();
  private pending = 0;
  private readonly initialDelay: number;
  private readonly maxDelay: number;

  constructor(
    private readonly url: string,
    private readonly token: string | undefined,
    private readonly factory: SocketFactory,
    reconnect: ReconnectOptions = {},
  ) {
    this.initialDelay = reconnect.initialDelayMs ?? 1000;
    this.maxDelay = reconnect.maxDelayMs ?? 30_000;
  }

  onState(listener: (state: ConnectionState) => void): Unsubscribe {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  /** 订阅一个频道；第一次订阅时建立连接。 */
  subscribe(channel: string, handler: ChannelHandler): Unsubscribe {
    let handlers = this.channels.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.channels.set(channel, handlers);
      if (this.authenticated) this.socket?.send(`subscribe ${channel}`);
    }
    handlers.add(handler);
    this.ensureConnected();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.channels.get(channel);
      if (!current?.delete(handler) || current.size > 0) return;
      this.channels.delete(channel);
      if (this.authenticated) this.socket?.send(`unsubscribe ${channel}`);
    };
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.drop();
    this.channels.clear();
    this.setState("disconnected");
  }

  private setState(state: ConnectionState) {
    if (state === this.state) return;
    this.state = state;
    for (const listener of [...this.stateListeners]) listener(state);
  }

  private ensureConnected() {
    if (this.closed || this.socket || this.retryTimer !== undefined || this.state === "unauthorized") return;
    if (this.token === undefined) {
      this.setState("unauthorized");
      return;
    }
    this.connect();
  }

  private connect() {
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    if (this.state !== "reconnecting") this.setState("connecting");
    this.socket = this.factory(this.url, {
      open: () => {
        if (!current()) return;
        this.socket?.send("gzip on");
        this.socket?.send(`auth ${this.token}`);
      },
      message: (data) => current() && this.receive(data, current),
      close: () => current() && this.lost(),
    });
  }

  /** 丢弃当前连接，之后它的回调都不再生效。 */
  private drop() {
    this.generation += 1;
    this.authenticated = false;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }

  private lost() {
    this.drop();
    if (this.closed) return;
    this.setState("reconnecting");
    const delay = Math.min(this.initialDelay * 2 ** this.attempts, this.maxDelay);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }

  private receive(data: string, current: () => boolean) {
    const gz = data.startsWith("gz:");
    if (!gz && this.pending === 0) {
      this.handle(data);
      return;
    }
    this.pending += 1;
    const text = gz ? inflate(data.slice(3)) : Promise.resolve(data);
    this.inbox = this.inbox
      .then(() => text)
      .then(
        (decoded) => {
          if (current()) this.handle(decoded);
        },
        () => {
          // 解不开的帧丢弃
        },
      )
      .finally(() => {
        this.pending -= 1;
      });
  }

  private handle(text: string) {
    if (text.startsWith("auth ")) {
      if (text.startsWith("auth ok")) this.authOk();
      else this.authFailed();
      return;
    }
    if (!text.startsWith("[")) return; // time / protocol / package 等
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(frame) || typeof frame[0] !== "string") return;
    const [channel, payload] = frame as [string, unknown];
    if (channel.startsWith("err@")) {
      const message = typeof payload === "string" ? payload : JSON.stringify(payload);
      for (const handler of [...(this.channels.get(channel.slice(4)) ?? [])]) handler.error(message);
      return;
    }
    for (const handler of [...(this.channels.get(channel) ?? [])]) handler.data(payload);
  }

  private authOk() {
    this.authenticated = true;
    this.attempts = 0;
    for (const channel of this.channels.keys()) this.socket?.send(`subscribe ${channel}`);
    this.setState("authenticated");
  }

  private authFailed() {
    this.drop();
    this.setState("unauthorized");
  }
}
