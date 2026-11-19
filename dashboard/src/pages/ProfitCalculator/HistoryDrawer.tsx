import { Alert, App, Button, Checkbox, Drawer, Modal, Popconfirm } from "antd";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  deleteSnapshot,
  getSnapshot,
  listSnapshots,
  type Snapshot,
  type SnapshotSummary,
} from "../../api/modules/octopProfitCalculator";
import { useServerTimezone } from "../../hooks/useServerTimezone";
import { formatServerDateTime } from "../../utils/formatMessageTime";
import { saveBlobAsFile } from "../../utils/saveBlobAsFile";
import { fieldGroups, fieldUnit } from "../../utils/profitCalculator";
import Results, { money, percent } from "./Results";
import styles from "./index.module.less";

export default function HistoryDrawer({
  colors,
  onClose,
  onEdit,
}: {
  colors: CSSProperties;
  onClose: () => void;
  onEdit: (snapshot: Snapshot) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t("profitCalculator." + key);
  const { message } = App.useApp();
  const timezone = useServerTimezone();
  const [rows, setRows] = useState<SnapshotSummary[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<Snapshot | null>(null);
  const [comparison, setComparison] = useState<Snapshot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [failure, setFailure] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void listSnapshots()
      .then((items) => {
        if (mounted) {
          setRows(items);
          setMore(items.length === 20);
        }
      })
      .catch(() => {
        if (mounted) setFailure(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function loadMore() {
    setBusy(true);
    try {
      const items = await listSnapshots(rows?.[rows.length - 1]?.snapshot_id);
      setRows((current) => [...(current ?? []), ...items]);
      setMore(items.length === 20);
      setFailure(false);
    } catch {
      setFailure(true);
    } finally {
      setBusy(false);
    }
  }

  async function open(ids: string[], compare = false) {
    setBusy(true);
    try {
      const snapshots = await Promise.all(ids.map(getSnapshot));
      if (compare) setComparison(snapshots);
      else setDetail(snapshots[0]);
    } catch {
      message.error(tr("loadFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setDeleting(id);
    try {
      await deleteSnapshot(id);
      setRows(
        (current) => current?.filter((row) => row.snapshot_id !== id) ?? [],
      );
      setSelected((current) => current.filter((key) => key !== id));
      message.success(tr("deleted"));
    } catch {
      message.error(tr("deleteFailed"));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Drawer open title={tr("history")} width={560} onClose={onClose}>
      <div className={styles.workspace} style={colors}>
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
        {rows === null
          ? !failure && <p>{tr("loading")}</p>
          : rows.length === 0 && <p>{tr("noSnapshots")}</p>}
        {!!rows?.length && (
          <div className={styles.dialogActions}>
            <Button
              type="primary"
              disabled={selected.length < 2}
              loading={busy}
              onClick={() => void open(selected, true)}
            >
              {selected.length
                ? t("profitCalculator.compareCount", { count: selected.length })
                : tr("compare")}
            </Button>
            <span className={styles.meta}>{tr("compareHint")}</span>
          </div>
        )}
        {rows?.map((row) => (
          <div key={row.snapshot_id} className={styles.listRow}>
            <Checkbox
              aria-label={t("profitCalculator.selectScenario", {
                title: row.title,
              })}
              checked={selected.includes(row.snapshot_id)}
              disabled={
                busy ||
                (!selected.includes(row.snapshot_id) && selected.length >= 5)
              }
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, row.snapshot_id]
                    : current.filter((id) => id !== row.snapshot_id),
                )
              }
            />
            <div className={styles.listTitle}>
              <Button
                type="link"
                disabled={busy}
                onClick={() => void open([row.snapshot_id])}
              >
                {row.title}
              </Button>
              <span className={styles.meta}>
                {formatServerDateTime(row.created_at, timezone)}
              </span>
            </div>
            <Popconfirm
              title={tr("deleteConfirm")}
              onConfirm={() => remove(row.snapshot_id)}
            >
              <Button
                type="text"
                size="small"
                danger
                loading={deleting === row.snapshot_id}
              >
                {tr("delete")}
              </Button>
            </Popconfirm>
          </div>
        ))}
        {more && !failure && (
          <Button type="link" loading={busy} onClick={() => void loadMore()}>
            {tr("more")}
          </Button>
        )}
      </div>
      {detail && (
        <Modal
          open
          width={740}
          title={detail.title}
          onCancel={() => setDetail(null)}
          footer={[
            <Button
              key="export"
              onClick={() =>
                void saveBlobAsFile(
                  new Blob([JSON.stringify(detail, null, 2)], {
                    type: "application/json",
                  }),
                  "pdd-profit-" + detail.snapshot_id + ".json",
                ).catch(() => message.error(tr("exportFailed")))
              }
            >
              {tr("exportSnapshot")}
            </Button>,
            <Button key="edit" type="primary" onClick={() => onEdit(detail)}>
              {tr("editCopy")}
            </Button>,
          ]}
        >
          <div style={colors} className={styles.workspace}>
            <Results result={detail.results} inputs={detail.inputs} />
            <details className={styles.more}>
              <summary>{tr("savedInputs")}</summary>
              <div className={styles.scrollTable}>
                <table aria-label={tr("savedInputs")}>
                  <tbody>
                    {Object.values(fieldGroups)
                      .flat()
                      .map(
                        (key) =>
                          detail.inputs[key] && (
                            <tr key={key}>
                              <th scope="row">{tr("fields." + key)}</th>
                              <td>
                                {detail.inputs[key]}{" "}
                                {fieldUnit(key) === "quantity"
                                  ? tr("pieces")
                                  : fieldUnit(key)}
                              </td>
                            </tr>
                          ),
                      )}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </Modal>
      )}
      {comparison && (
        <Modal
          open
          width={1040}
          title={tr("compare")}
          onCancel={() => setComparison(null)}
          footer={null}
        >
          <Comparison snapshots={comparison} colors={colors} />
        </Modal>
      )}
    </Drawer>
  );
}

function Comparison({
  snapshots,
  colors,
}: {
  snapshots: Snapshot[];
  colors: CSSProperties;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t("profitCalculator." + key);
  const bestProfit = Math.max(
    ...snapshots.map(({ results }) => results.outcome.profit),
  );
  const metrics: [string, (snapshot: Snapshot) => ReactNode][] = [
    [
      "fields.price",
      (snapshot) => money(Math.round(Number(snapshot.inputs.price) * 100)),
    ],
    [
      "netShort",
      ({ results }) => (
        <strong
          className={
            results.outcome.profit === bestProfit ? styles.highlight : undefined
          }
        >
          {money(results.outcome.profit)}
        </strong>
      ),
    ],
    ["margin", ({ results }) => percent(results.outcome.margin)],
    ["before", ({ results }) => money(results.outcome.before)],
    ["refundLoss", ({ results }) => money(results.outcome.loss)],
    ["costs", ({ results }) => money(results.totalCost)],
    ["statusLabel", ({ results }) => tr("status." + results.outcome.status)],
    ["breakEven", ({ results }) => money(results.breakEven)],
    ["targetPrice", ({ results }) => money(results.targetPrice)],
    [
      "monthlyOrders",
      ({ results }) =>
        results.monthlyOrders === null
          ? "—"
          : BigInt(results.monthlyOrders).toLocaleString(),
    ],
  ];
  for (const key of ["outbound", "ad", "unitPrice", "refund"] as const) {
    metrics.push([
      "fields." + key,
      ({ results }) => {
        const upper =
          results.limits.find((limit) => limit.key === key)?.upper ?? null;
        return key === "refund" ? percent(upper) : money(upper);
      },
    ]);
  }
  return (
    <div className={styles.workspace} style={colors}>
      <div className={styles.scrollTable} tabIndex={0}>
        <table aria-label={tr("compare")}>
          <thead>
            <tr>
              <th scope="col">{tr("metric")}</th>
              {snapshots.map((item) => (
                <th
                  scope="col"
                  key={item.snapshot_id}
                  title={item.title}
                  style={{
                    maxWidth: 170,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map(([label, render], index) => (
              <tr key={label}>
                <th scope="row">
                  {index >= metrics.length - 4
                    ? t("profitCalculator.compareLimit", { field: tr(label) })
                    : tr(label)}
                </th>
                {snapshots.map((item) => (
                  <td key={item.snapshot_id}>{render(item)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
