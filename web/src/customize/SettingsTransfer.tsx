/**
 * 设置里的“导出 / 导入”（#5）：导出为 JSON 文件下载；从文件导入后由 onImported 让页面生效（App 重建界面）。
 */
import { createSignal, Show } from "solid-js";
import { useI18n } from "../i18n";
import { exportSettings, importSettings, SettingsImportError, type ImportReport, type TransferStorage } from "./settings-transfer.ts";

export interface SettingsTransferProps {
  readonly storage: TransferStorage | undefined;
  /** 导入成功后调用（存储已写好） */
  readonly onImported: (report: ImportReport) => void;
  /** 上一次导入的结果（重建界面后显示） */
  readonly lastImport?: ImportReport | undefined;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function SettingsTransfer(props: SettingsTransferProps) {
  const { t } = useI18n();
  const [error, setError] = createSignal<string>();

  const doExport = () => {
    if (!props.storage) return setError(t("transfer.error.noStorage"));
    const file = exportSettings(props.storage);
    download(`screeps-client-settings-${file.exportedAt.slice(0, 10)}.json`, JSON.stringify(file, null, 2));
  };

  const doImport = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    input.value = "";
    if (!chosen) return;
    setError(undefined);
    if (!props.storage) return setError(t("transfer.error.noStorage"));
    let parsed: unknown;
    try {
      parsed = JSON.parse(await chosen.text());
    } catch {
      return setError(t("transfer.error.notJson"));
    }
    try {
      props.onImported(importSettings(props.storage, parsed));
    } catch (failure) {
      setError(
        failure instanceof SettingsImportError && failure.reason === "newerVersion"
          ? t("transfer.error.newerVersion")
          : t("transfer.error.notSettings"),
      );
    }
  };

  return (
    <section class="settings" aria-labelledby="transfer-title" data-testid="settings-transfer">
      <h2 id="transfer-title">{t("transfer.title")}</h2>
      <p class="settings__muted">{t("transfer.hint")}</p>
      <div class="settings__inline">
        <button type="button" data-action="export-settings" onClick={doExport}>
          {t("transfer.export")}
        </button>
        <label class="customize__file">
          {t("transfer.import")}
          <input
            type="file"
            name="import-settings"
            accept="application/json,.json"
            onChange={(e) => void doImport(e.currentTarget)}
          />
        </label>
      </div>
      <Show when={props.lastImport}>
        {(report) => (
          <p role="status" data-testid="import-result">
            {t("transfer.imported", { count: report().applied.length })}
            <Show when={report().ignored.length > 0}>
              {" "}
              {t("transfer.ignored", { keys: report().ignored.join(", ") })}
            </Show>
          </p>
        )}
      </Show>
      <Show when={error()}>
        {(message) => (
          <p class="settings__error" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </section>
  );
}
