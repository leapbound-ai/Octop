import {
  App,
  Alert,
  Button,
  Input,
  InputNumber,
  Modal,
  Tooltip,
  theme,
} from "antd";
import { Calculator, CircleDot, History, Settings2 } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import {
  getBaseline,
  saveSnapshot,
  type Baseline,
  type Snapshot,
} from "../../api/modules/octopProfitCalculator";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useServerTimezone } from "../../hooks/useServerTimezone";
import PageShell from "../../layouts/PageShell";
import { formatServerDateTime } from "../../utils/formatMessageTime";
import { saveBlobAsFile } from "../../utils/saveBlobAsFile";
import {
  calculateProfit,
  demoInputs,
  engineVersion,
  exportTemplate,
  fieldGroups,
  fieldUnit,
  importTemplate,
  startInputs,
  storeFields,
  templateFields,
  type InputKey,
  type Inputs,
} from "../../utils/profitCalculator";
import DefaultsDrawer from "./DefaultsDrawer";
import HistoryDrawer from "./HistoryDrawer";
import Results from "./Results";
import styles from "./index.module.less";

interface Draft {
  inputs: Inputs;
  baselineVersion: number | null;
  dirty: boolean;
}

function withDefaults(baseline: Baseline | null): Draft {
  const inputs = { ...startInputs };
  for (const key of storeFields) {
    const value = baseline?.payload[key]?.value;
    if (value) inputs[key] = value;
  }
  return { inputs, baselineVersion: baseline?.version ?? null, dirty: false };
}

function readDraft(key: string): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as Draft | null;
  } catch {
    return null;
  }
}

export default function ProfitCalculatorPage() {
  const user = useCurrentUser();
  return user ? <CalculatorWorkspace key={user.id} userId={user.id} /> : null;
}

function CalculatorWorkspace({ userId }: { userId: number }) {
  const { t } = useTranslation();
  const tr = (key: string) => t("profitCalculator." + key);
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const timezone = useServerTimezone();
  const localKey = "octop:profit-calc:draft:" + userId;
  const [stored] = useState(() => readDraft(localKey));
  const [draft, setDraft] = useState(stored ?? withDefaults(null));
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [baselineError, setBaselineError] = useState(false);
  const [baselineAttempt, setBaselineAttempt] = useState(0);
  const [baselineReady, setBaselineReady] = useState(false);
  const [localIssue, setLocalIssue] = useState(false);
  const [panel, setPanel] = useState<
    "baseline" | "history" | "template" | "save" | null
  >(null);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState("");
  const [templateError, setTemplateError] = useState(false);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const { inputs, baselineVersion, dirty } = draft;
  const { result, missing, invalid } = useMemo(
    () => calculateProfit(inputs),
    [inputs],
  );

  useEffect(() => {
    const controller = new AbortController();
    void getBaseline(controller.signal)
      .then((record) => {
        if (controller.signal.aborted) return;
        setBaseline(record);
        setDraft((current) =>
          current.dirty || current.inputs.price
            ? current
            : withDefaults(record),
        );
        setBaselineReady(true);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setBaselineError(true);
        setBaselineReady(true);
      });
    return () => controller.abort();
  }, [baselineAttempt]);

  useEffect(() => {
    if (!baselineReady && !dirty && !stored) return;
    try {
      localStorage.setItem(localKey, JSON.stringify(draft));
      setLocalIssue(false);
    } catch {
      setLocalIssue(true);
    }
  }, [baselineReady, draft, dirty, localKey, stored]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const colors = {
    "--profit-text": token.colorText,
    "--profit-muted": token.colorTextSecondary,
    "--profit-border": token.colorBorderSecondary,
    "--profit-soft": token.colorFillQuaternary,
    "--profit-link": token.colorLink,
    "--profit-success": token.colorSuccessText,
    "--profit-success-bg": token.colorSuccessBg,
    "--profit-warning": token.colorWarningText,
    "--profit-warning-bg": token.colorWarningBg,
    "--profit-danger": token.colorErrorText,
    "--profit-danger-bg": token.colorErrorBg,
  } as CSSProperties;

  function edit(key: InputKey, value: string | null) {
    setDraft((current) => ({
      ...current,
      dirty: true,
      inputs: { ...current.inputs, [key]: value ?? "" },
    }));
  }

  function replace(next: Draft, onApplied?: () => void) {
    const apply = () => {
      setDraft(next);
      onApplied?.();
    };
    if (dirty) {
      modal.confirm({ title: tr("replaceDraft"), onOk: apply });
    } else {
      apply();
    }
  }

  function recalculate(snapshot: Snapshot) {
    replace(
      {
        inputs: snapshot.inputs,
        baselineVersion: snapshot.baseline_version,
        dirty: true,
      },
      () => setPanel(null),
    );
  }

  function nextField(input: HTMLInputElement) {
    const fields = Array.from(
      formRef.current?.querySelectorAll<HTMLInputElement>(
        "input[id^=profit-]",
      ) ?? [],
    ).filter((field) => field.offsetWidth > 0);
    fields[fields.indexOf(input) + 1]?.focus();
  }

  function field(key: InputKey) {
    const unit = fieldUnit(key);
    const optional =
      ["inbound", "insurance", "reserve", "monthly"].includes(key) ||
      (!Number(inputs.refund) &&
        (key === "returnShipping" || key === "residual"));
    const origin =
      baseline?.version === baselineVersion
        ? baseline?.payload[key]
        : undefined;
    return (
      <div className={styles.field} key={key}>
        <div className={styles.controlLabel}>
          <label htmlFor={"profit-" + key}>{tr("fields." + key)}</label>
          {origin && origin.value === inputs[key] ? (
            <Tooltip
              title={[tr("source." + origin.source), origin.source_note]
                .filter(Boolean)
                .join(" · ")}
            >
              <span
                tabIndex={0}
                className={styles.source}
                role="img"
                aria-label={tr("source." + origin.source)}
              >
                <CircleDot size={13} />
              </span>
            </Tooltip>
          ) : (
            optional && (
              <span className={styles.optional}>{tr("optional")}</span>
            )
          )}
        </div>
        <InputNumber<string>
          id={"profit-" + key}
          stringMode
          value={inputs[key] || null}
          onChange={(value) => edit(key, value)}
          onPressEnter={(event) => {
            event.preventDefault();
            if (event.target instanceof HTMLInputElement)
              nextField(event.target);
          }}
          min="0"
          max={
            unit === "%"
              ? "100"
              : unit === "quantity"
              ? "9999"
              : key === "monthly"
              ? "99999999.99"
              : "99999.99"
          }
          precision={unit === "quantity" ? 0 : 2}
          step={
            key === "price"
              ? "0.5"
              : ["unitPrice", "outbound", "ad"].includes(key)
              ? "0.1"
              : unit === "¥"
              ? "0.01"
              : "1"
          }
          status={invalid.includes(key) ? "error" : undefined}
          addonAfter={unit === "quantity" ? tr("pieces") : unit}
          inputMode={unit === "quantity" ? "numeric" : "decimal"}
          aria-invalid={invalid.includes(key)}
          aria-required={!optional}
          placeholder={optional && key !== "monthly" ? "0" : undefined}
        />
      </div>
    );
  }

  function openSave() {
    setTitle(
      t("profitCalculator.defaultTitle", {
        date: formatServerDateTime(Date.now() / 1000, timezone),
      }),
    );
    setPanel("save");
  }

  async function save() {
    if (!result || !title.trim()) return;
    setSaving(true);
    try {
      await saveSnapshot({
        title: title.trim(),
        inputs,
        results: result,
        engine_version: engineVersion,
        baseline_version: baselineVersion,
      });
      setDraft((current) =>
        current === draft ? { ...current, dirty: false } : current,
      );
      setPanel(null);
      message.success(tr("saved"));
    } catch {
      message.error(tr("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function applyTemplate() {
    const parsed = importTemplate(template);
    if (!parsed) {
      setTemplateError(true);
      return;
    }
    setDraft((current) => ({
      ...current,
      dirty: true,
      inputs: { ...current.inputs, ...parsed },
    }));
    setPanel(null);
  }

  return (
    <PageShell title={t("nav.profitCalculator")} subtitle={tr("subtitle")}>
      <div className={styles.workspace} style={colors}>
        <div className={styles.toolbar}>
          <div className={styles.actions}>
            <Button
              icon={<Settings2 size={15} />}
              disabled={!baselineReady}
              onClick={() => setPanel("baseline")}
            >
              {tr("defaults")}
            </Button>
            <Button
              icon={<History size={15} />}
              onClick={() => setPanel("history")}
            >
              {tr("history")}
            </Button>
            <Button
              type="text"
              onClick={() => {
                setTemplate("");
                setTemplateError(false);
                setPanel("template");
              }}
            >
              {tr("template")}
            </Button>
          </div>
          <div className={styles.actions}>
            {dirty && (
              <span className={styles.meta}>
                {tr(localIssue ? "storageFailed" : "draft")}
              </span>
            )}
            <Button type="primary" disabled={!result} onClick={openSave}>
              {tr("save")}
            </Button>
          </div>
        </div>
        {baselineError && (
          <Alert
            type="warning"
            message={tr("defaultsFailed")}
            action={
              <Button
                size="small"
                onClick={() => {
                  setBaselineError(false);
                  setBaselineReady(false);
                  setBaselineAttempt((attempt) => attempt + 1);
                }}
              >
                {tr("retry")}
              </Button>
            }
            style={{ marginBottom: 14 }}
          />
        )}
        <div className={styles.layout}>
          <form
            className={styles.form}
            ref={formRef}
            onSubmit={(event) => event.preventDefault()}
          >
            {(["sale", "sourcing", "fees", "returns", "overhead"] as const).map(
              (group) => (
                <fieldset className={styles.group} key={group}>
                  <legend>{tr("groups." + group)}</legend>
                  <div className={styles.fields}>
                    {fieldGroups[group].map(field)}
                  </div>
                  {group === "sourcing" && (
                    <details
                      className={styles.more}
                      open={
                        fieldGroups.pack.some(
                          (key) =>
                            missing.includes(key) || invalid.includes(key),
                        )
                          ? true
                          : undefined
                      }
                    >
                      <summary>{tr("packDetails")}</summary>
                      <div className={styles.fields}>
                        {fieldGroups.pack.map(field)}
                      </div>
                      <p className={styles.note}>{tr("packNote")}</p>
                    </details>
                  )}
                  {group === "returns" && (
                    <p className={styles.note}>{tr("returnsNote")}</p>
                  )}
                </fieldset>
              ),
            )}
            <div className={styles.actions}>
              <Button
                type="link"
                onClick={() =>
                  replace({
                    inputs: demoInputs,
                    baselineVersion: null,
                    dirty: true,
                  })
                }
              >
                {tr("example")}
              </Button>
              <Button
                type="link"
                onClick={() => replace(withDefaults(baseline))}
              >
                {tr("newScenario")}
              </Button>
              {result && (
                <Button
                  type="link"
                  onClick={() =>
                    resultsRef.current?.scrollIntoView({ block: "start" })
                  }
                >
                  {tr("viewResult")}
                </Button>
              )}
            </div>
          </form>
          <div className={styles.results} ref={resultsRef}>
            {result ? (
              <Results result={result} inputs={inputs} />
            ) : (
              <div className={styles.empty} role="status">
                <Calculator size={20} aria-hidden="true" />
                <div>
                  <strong>
                    {t("profitCalculator.pending", {
                      count: missing.length + invalid.length,
                    })}
                  </strong>
                </div>
                {missing.length > 0 && (
                  <p>
                    {tr("missing")}{" "}
                    {missing
                      .map((key) => tr("fields." + key))
                      .join(tr("separator"))}
                  </p>
                )}
                {invalid.length > 0 && (
                  <p>
                    {tr("invalid")}{" "}
                    {invalid
                      .map((key) => tr("fields." + key))
                      .join(tr("separator"))}
                  </p>
                )}
                <Button
                  type="link"
                  onClick={() =>
                    replace({
                      inputs: demoInputs,
                      baselineVersion: null,
                      dirty: true,
                    })
                  }
                >
                  {tr("example")}
                </Button>
              </div>
            )}
          </div>
        </div>
        {panel === "baseline" && (
          <DefaultsDrawer
            baseline={baseline}
            inputs={inputs}
            colors={colors}
            onClose={() => setPanel(null)}
            onSaved={(record) => {
              setBaseline(record);
              setBaselineError(false);
            }}
            onApply={(record) => {
              const next = Object.fromEntries(
                storeFields.flatMap((key) => {
                  const field = record.payload[key];
                  return field?.value ? [[key, field.value]] : [];
                }),
              );
              setDraft((current) => ({
                inputs: { ...current.inputs, ...next },
                dirty: true,
                baselineVersion: record.version,
              }));
              setPanel(null);
            }}
          />
        )}
        {panel === "history" && (
          <HistoryDrawer
            colors={colors}
            onClose={() => setPanel(null)}
            onEdit={recalculate}
          />
        )}
        <Modal
          open={panel === "save"}
          title={tr("save")}
          okText={tr("saveAction")}
          okButtonProps={{ disabled: !title.trim() }}
          confirmLoading={saving}
          closable={!saving}
          maskClosable={!saving}
          onCancel={() => {
            if (!saving) setPanel(null);
          }}
          onOk={() => void save()}
        >
          <label htmlFor="profit-title">{tr("scenarioName")}</label>
          <Input
            id="profit-title"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            onPressEnter={() => {
              if (!saving) void save();
            }}
          />
        </Modal>
        <Modal
          open={panel === "template"}
          title={tr("template")}
          okText={tr("import")}
          onCancel={() => setPanel(null)}
          onOk={applyTemplate}
          okButtonProps={{ disabled: !template.trim() }}
        >
          <p>{tr("templateHint")}</p>
          <p>
            {templateFields
              .map((key) => tr("fields." + key))
              .join(tr("separator"))}
          </p>
          <Input.TextArea
            aria-label={tr("template")}
            value={template}
            rows={4}
            status={templateError ? "error" : undefined}
            onChange={(event) => {
              setTemplate(event.target.value);
              setTemplateError(false);
            }}
          />
          {templateError && <p role="alert">{tr("templateInvalid")}</p>}
          <Button
            type="link"
            onClick={() =>
              void saveBlobAsFile(
                new Blob([exportTemplate(inputs)], {
                  type: "text/csv;charset=utf-8",
                }),
                "pdd-profit-template.csv",
              ).catch(() => message.error(tr("exportFailed")))
            }
          >
            {tr("exportTemplate")}
          </Button>
          <Button
            type="link"
            onClick={() => document.getElementById("profit-csv")?.click()}
          >
            {tr("chooseFile")}
          </Button>
          <input
            id="profit-csv"
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 4096) setTemplateError(true);
              else
                void file
                  .text()
                  .then((text) => {
                    setTemplate(text);
                    setTemplateError(false);
                  })
                  .catch(() => setTemplateError(true));
              event.target.value = "";
            }}
          />
        </Modal>
      </div>
    </PageShell>
  );
}
