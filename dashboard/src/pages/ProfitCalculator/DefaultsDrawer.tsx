import { Alert, App, Button, Drawer, Input, Select, Tabs } from "antd";
import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
  listBaselines,
  restoreBaseline,
  saveBaseline,
  type Baseline,
  type BaselinePayload,
  type Source,
} from "../../api/modules/octopProfitCalculator";
import { useServerTimezone } from "../../hooks/useServerTimezone";
import { formatServerDateTime } from "../../utils/formatMessageTime";
import {
  fieldUnit,
  isValidInput,
  storeFields,
  type Inputs,
} from "../../utils/profitCalculator";
import styles from "./index.module.less";

const sources: Source[] = ["empty", "actual", "public", "seller", "model"];

export default function DefaultsDrawer({
  baseline,
  inputs,
  colors,
  onClose,
  onSaved,
  onApply,
}: {
  baseline: Baseline | null;
  inputs: Inputs;
  colors: CSSProperties;
  onClose: () => void;
  onSaved: (row: Baseline) => void;
  onApply: (row: Baseline) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t("profitCalculator." + key);
  const { message } = App.useApp();
  const timezone = useServerTimezone();
  const [payload, setPayload] = useState<BaselinePayload>(
    baseline?.payload ?? {},
  );
  const [history, setHistory] = useState<Baseline[] | null>(null);
  const [selected, setSelected] = useState<Baseline | null>(null);
  const [failure, setFailure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let mounted = true;
    void listBaselines()
      .then((rows) => {
        if (mounted) {
          setHistory(rows);
          setMore(rows.length === 20);
        }
      })
      .catch(() => {
        if (mounted) setFailure(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const valid = storeFields.every(
    (key) => !payload[key]?.value || isValidInput(key, payload[key]!.value),
  );

  async function mutate(restore?: number) {
    setBusy(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const normalized = Object.fromEntries(
        storeFields.flatMap((key) => {
          const field = payload[key];
          if (!field?.value) return [];
          const previous = baseline?.payload[key];
          const unchanged =
            previous?.value === field.value &&
            previous.source === field.source &&
            previous.source_note === field.source_note;
          return [
            [
              key,
              { ...field, updated_at: unchanged ? previous.updated_at : now },
            ],
          ];
        }),
      );
      const row = restore
        ? await restoreBaseline(restore)
        : await saveBaseline(normalized);
      onSaved(row);
      setPayload(row.payload);
      setSelected(null);
      setHistory((current) => [row, ...(current ?? [])]);
      message.success(tr(restore ? "restored" : "defaultsSaved"));
    } catch {
      message.error(tr("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    setBusy(true);
    try {
      const rows = await listBaselines(history?.[history.length - 1]?.version);
      setHistory((current) => [...(current ?? []), ...rows]);
      setMore(rows.length === 20);
      setFailure(false);
    } catch {
      setFailure(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open title={tr("defaults")} width={540} onClose={onClose}>
      <div className={styles.workspace} style={colors}>
        <Tabs
          items={[
            {
              key: "current",
              label: tr("currentDefaults"),
              children: (
                <>
                  <p className={styles.dialogText}>{tr("defaultsHint")}</p>
                  <div className={styles.dialogActions}>
                    <Button
                      onClick={() =>
                        setPayload(
                          Object.fromEntries(
                            storeFields.flatMap((key) => {
                              const value = inputs[key];
                              if (!value) return [];
                              const previous = payload[key];
                              return [
                                [
                                  key,
                                  previous?.value === value
                                    ? previous
                                    : {
                                        value,
                                        source: "empty",
                                        source_note: "",
                                        updated_at: 0,
                                      },
                                ],
                              ];
                            }),
                          ),
                        )
                      }
                    >
                      {tr("copyInputs")}
                    </Button>
                    {baseline && (
                      <Button onClick={() => onApply(baseline)}>
                        {tr("applyDefaults")}
                      </Button>
                    )}
                  </div>
                  <div className={styles.defaults}>
                    {storeFields.map((key) => {
                      const current = payload[key] ?? {
                        value: "",
                        source: "empty" as const,
                        source_note: "",
                        updated_at: 0,
                      };
                      const update = (patch: Partial<typeof current>) =>
                        setPayload((previous) => ({
                          ...previous,
                          [key]: { ...current, ...patch },
                        }));
                      const label = tr("fields." + key);
                      return (
                        <div className={styles.defaultsRow} key={key}>
                          <div className={styles.field}>
                            <label htmlFor={"profit-default-" + key}>
                              {label}
                            </label>
                            <Input
                              id={"profit-default-" + key}
                              inputMode="decimal"
                              addonAfter={fieldUnit(key)}
                              value={current.value}
                              status={
                                current.value &&
                                !isValidInput(key, current.value)
                                  ? "error"
                                  : undefined
                              }
                              onChange={(event) =>
                                update({ value: event.target.value.trim() })
                              }
                            />
                          </div>
                          <Select
                            aria-label={label + " · " + tr("sourceLabel")}
                            value={current.source}
                            options={sources.map((source) => ({
                              value: source,
                              label: tr("source." + source),
                            }))}
                            onChange={(source) => update({ source })}
                          />
                          {current.source !== "empty" && (
                            <Input
                              aria-label={label + " · " + tr("sourceNote")}
                              placeholder={tr("sourceNote")}
                              value={current.source_note}
                              maxLength={200}
                              onChange={(event) =>
                                update({ source_note: event.target.value })
                              }
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div
                    className={styles.dialogActions}
                    style={{ marginTop: 16 }}
                  >
                    <Button
                      type="primary"
                      loading={busy}
                      disabled={!valid}
                      onClick={() => void mutate()}
                    >
                      {tr("saveDefaults")}
                    </Button>
                  </div>
                </>
              ),
            },
            {
              key: "history",
              label: tr("versions"),
              children: (
                <>
                  {failure && (
                    <Alert
                      type="warning"
                      message={tr("loadFailed")}
                      action={
                        <Button size="small" onClick={() => void loadMore()}>
                          {tr("retry")}
                        </Button>
                      }
                    />
                  )}
                  {history === null
                    ? !failure && <p>{tr("loading")}</p>
                    : history.length === 0 && <p>{tr("noVersions")}</p>}
                  {history?.map((row) => (
                    <div key={row.version} className={styles.listRow}>
                      <div className={styles.listTitle}>
                        <Button
                          type="link"
                          onClick={() =>
                            setSelected(
                              selected?.version === row.version ? null : row,
                            )
                          }
                        >
                          {t("profitCalculator.version", {
                            version: row.version,
                          })}
                        </Button>
                        <span className={styles.meta}>
                          {formatServerDateTime(row.created_at, timezone)}
                        </span>
                      </div>
                      {row.version === baseline?.version && (
                        <span className={styles.meta}>
                          {tr("currentDefaults")}
                        </span>
                      )}
                    </div>
                  ))}
                  {more && !failure && (
                    <Button
                      type="link"
                      loading={busy}
                      onClick={() => void loadMore()}
                    >
                      {tr("more")}
                    </Button>
                  )}
                  {selected && (
                    <section className={styles.resultsSection}>
                      <h3>
                        {t("profitCalculator.version", {
                          version: selected.version,
                        })}
                      </h3>
                      <div className={styles.scrollTable}>
                        <table aria-label={tr("versionValues")}>
                          <tbody>
                            {storeFields.map((key) => {
                              const item = selected.payload[key];
                              return (
                                item?.value && (
                                  <tr key={key}>
                                    <th scope="row">{tr("fields." + key)}</th>
                                    <td>
                                      {item.value} {fieldUnit(key)}
                                    </td>
                                    <td title={item.source_note}>
                                      {tr("source." + item.source)}
                                    </td>
                                  </tr>
                                )
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {selected.version !== baseline?.version && (
                        <Button
                          loading={busy}
                          style={{ marginTop: 10 }}
                          onClick={() => void mutate(selected.version)}
                        >
                          {tr("restore")}
                        </Button>
                      )}
                    </section>
                  )}
                </>
              ),
            },
          ]}
        />
      </div>
    </Drawer>
  );
}
