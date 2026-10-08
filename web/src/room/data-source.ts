/**
 * Room View 的数据来源（#51）：服务器（经共享 Source），或开发构建里的录制数据（FixtureSource）。
 * 只在开发构建里由 Menu 的原始读数项切换；不持久化，刷新后回到服务器。
 */
import { createSignal, type Accessor } from "solid-js";

export type DataSource = "server" | "recording";

export interface DataSourceChoice {
  readonly source: Accessor<DataSource>;
  readonly set: (source: DataSource) => void;
}

export function createDataSourceChoice(): DataSourceChoice {
  const [source, set] = createSignal<DataSource>("server");
  return { source, set };
}
