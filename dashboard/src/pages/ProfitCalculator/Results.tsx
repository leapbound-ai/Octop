import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Inputs, ProfitResult } from "../../utils/profitCalculator";
import styles from "./index.module.less";

export function money(value: number | null) {
  if (value === null) return "—";
  return (
    (value < 0 ? "−¥" : "¥") +
    (Math.abs(value) / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
export const percent = (value: number | null) =>
  value === null ? "—" : (value / 100).toFixed(2) + "%";
const costColors = [
  "#527c91",
  "#6893a4",
  "#5b8f84",
  "#82aaa0",
  "#a2936e",
  "#b68b68",
  "#907f9e",
  "#818991",
  "#c26e6b",
];

function ResultTable({
  title,
  columns,
  children,
  note,
}: {
  title: string;
  columns: string[];
  children: ReactNode;
  note?: string;
}) {
  return (
    <section className={styles.resultsSection}>
      <h3>{title}</h3>
      <div className={styles.scrollTable}>
        <table aria-label={title}>
          <thead>
            <tr>
              {columns.map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {note && <p className={styles.note}>{note}</p>}
    </section>
  );
}

export function ResultSummary({
  result,
  inputs,
}: {
  result: ProfitResult;
  inputs: Inputs;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t("profitCalculator." + key);
  const { outcome, breakEven, targetPrice, monthlyOrders } = result;
  const monthly = inputs.monthly !== undefined && inputs.monthly !== "";
  return (
    <>
      <section className={styles.hero} aria-label={tr("net")}>
        <div className={styles.heroTitle}>
          {tr("net")}{" "}
          <span className={styles[outcome.status]}>
            {tr("status." + outcome.status)}
          </span>
        </div>
        <div className={styles.heroNumber}>{money(outcome.profit)}</div>
        <div className={styles.heroMargin}>
          {tr("margin")} <strong>{percent(outcome.margin)}</strong>
        </div>
        <div className={styles.heroContext}>
          <span>
            {tr("before")} <b>{money(outcome.before)}</b>
          </span>
          <span>
            {tr("refundLoss")} <b>{money(outcome.loss)}</b>
          </span>
        </div>
      </section>
      <dl className={styles.keyPrices}>
        <div>
          <dt>{tr("breakEven")}</dt>
          <dd>{money(breakEven)}</dd>
        </div>
        <div>
          <dt>{tr("targetPrice")}</dt>
          <dd>{money(targetPrice)}</dd>
        </div>
        {monthly && (
          <div>
            <dt>{tr("monthlyOrders")}</dt>
            <dd>
              {monthlyOrders === null
                ? "—"
                : t("profitCalculator.orders", {
                    count: Number(monthlyOrders),
                    orders: BigInt(monthlyOrders).toLocaleString(),
                  })}
            </dd>
          </div>
        )}
      </dl>
      {(breakEven === null ||
        targetPrice === null ||
        (monthly && monthlyOrders === null)) && (
        <p className={styles.note}>
          <Info size={14} />{" "}
          {tr(
            monthly && monthlyOrders === null
              ? "monthlyImpossible"
              : "priceImpossible",
          )}
        </p>
      )}
    </>
  );
}

export default function Results({
  result,
  inputs,
}: {
  result: ProfitResult;
  inputs: Inputs;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t("profitCalculator." + key);
  const { costs, limits, prices, refunds } = result;
  const bestPrice = [...prices]
    .filter(
      (row) =>
        row.status === "passed" ||
        (row.status === "even" && Number(inputs.target) === 0),
    )
    .sort((a, b) => a.price - b.price)[0]?.key;
  const firstRisk = refunds.find(
    (row) =>
      row.status === "loss" ||
      row.status === "below" ||
      (row.status === "even" && Number(inputs.target) > 0),
  );
  return (
    <>
      <ResultSummary result={result} inputs={inputs} />
      <ResultTable
        title={tr("limits")}
        columns={[tr("costItem"), tr("current"), tr("max"), tr("headroom")]}
        note={tr("limitNote")}
      >
        {limits.map((row) => {
          const format =
            row.key === "refund" || row.key === "adShare" ? percent : money;
          const distance = row.upper === null ? null : row.upper - row.current;
          return (
            <tr key={row.key}>
              <th scope="row">{tr("fields." + row.key)}</th>
              <td>{format(row.current)}</td>
              <td>{row.upper === null ? tr("noRoom") : format(row.upper)}</td>
              <td
                className={row.state === "over" ? styles.lossText : undefined}
              >
                {row.state === "over"
                  ? tr("overLimit")
                  : row.state === "edge"
                  ? tr("onLimit")
                  : format(distance)}
              </td>
            </tr>
          );
        })}
      </ResultTable>
      <ResultTable
        title={tr("priceLadder")}
        columns={[tr("case"), tr("fields.price"), tr("netShort"), tr("margin")]}
        note={targetPriceNote(result, tr)}
      >
        {prices.map((row) => (
          <tr
            key={row.key}
            className={row.key === bestPrice ? styles.highlight : undefined}
          >
            <th scope="row">
              {tr("priceCase." + row.key)}
              {row.key === bestPrice && <small> {tr("status.passed")}</small>}
            </th>
            <td>{money(row.price)}</td>
            <td>{money(row.profit)}</td>
            <td>{percent(row.margin)}</td>
          </tr>
        ))}
      </ResultTable>
      <ResultTable
        title={tr("refundCases")}
        columns={[
          tr("case"),
          tr("fields.refund"),
          tr("refundLoss"),
          tr("netShort"),
          tr("margin"),
        ]}
        note={
          firstRisk
            ? t("profitCalculator.refundRisk", {
                scenario: tr("refundCase." + firstRisk.key),
              })
            : undefined
        }
      >
        {refunds.map((row) => (
          <tr
            key={row.key}
            className={row.key === "base" ? styles.highlight : undefined}
          >
            <th scope="row">{tr("refundCase." + row.key)}</th>
            <td>{percent(row.rate)}</td>
            <td>{money(row.loss)}</td>
            <td className={row.status === "loss" ? styles.lossText : undefined}>
              {money(row.profit)}
            </td>
            <td>{percent(row.margin)}</td>
          </tr>
        ))}
      </ResultTable>
      <section className={styles.resultsSection}>
        <h3>
          {tr("costs")} <small>{money(result.totalCost)}</small>
        </h3>
        {result.totalCost > 0 && (
          <div className={styles.costBar} aria-hidden="true">
            {costs.map(
              (row, index) =>
                row.costShare > 0 && (
                  <span
                    key={row.key}
                    style={{
                      flexGrow: row.costShare,
                      backgroundColor: costColors[index],
                    }}
                  />
                ),
            )}
          </div>
        )}
        <div className={styles.scrollTable}>
          <table aria-label={tr("costs")}>
            <thead>
              <tr>
                {["costItem", "perOrder", "costShare", "saleShare"].map(
                  (key) => (
                    <th key={key} scope="col">
                      {tr(key)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {costs.map((row, index) => (
                <tr key={row.key}>
                  <th scope="row">
                    <i
                      className={styles.dot}
                      style={{ backgroundColor: costColors[index] }}
                    />
                    {tr("fields." + row.key)}
                  </th>
                  <td>{money(row.amount)}</td>
                  <td>{percent(row.costShare)}</td>
                  <td>{percent(row.saleShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>{tr("rounding")}</p>
      </section>
    </>
  );
}

function targetPriceNote(result: ProfitResult, tr: (key: string) => string) {
  return tr(result.targetPrice === null ? "targetImpossible" : "priceNote");
}
