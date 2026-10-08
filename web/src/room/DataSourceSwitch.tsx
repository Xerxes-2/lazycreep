/** 开发用的数据来源开关（#51）：App 只在 import.meta.env.DEV 时把它放进 Menu 的原始读数项，生产构建不打包。 */
import { useI18n } from "../i18n";
import type { DataSource, DataSourceChoice } from "./data-source.ts";

export function DataSourceSwitch(props: { choice: DataSourceChoice }) {
  const { t } = useI18n();
  return (
    <label>
      {t("roomView.source")}
      <select
        name="room-view-source"
        value={props.choice.source()}
        onChange={(e) => props.choice.set(e.currentTarget.value as DataSource)}
      >
        <option value="server">{t("roomView.source.server")}</option>
        <option value="recording">{t("roomView.source.recording")}</option>
      </select>
    </label>
  );
}
