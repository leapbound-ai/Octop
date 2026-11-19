import {
  Card,
  Collapse,
  Descriptions,
  Empty,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

const grades = ["test", "hold", "drop", "insufficient"];

function gradeColor(grade: unknown) {
  return grade === "test"
    ? "success"
    : grade === "hold"
    ? "warning"
    : grade === "drop"
    ? "error"
    : "default";
}
const fields = [
  "use_case",
  "rationale",
  "audience",
  "niche",
  "lifecycle",
  "competition",
  "after_sales",
  "resale",
  "gaps",
  "next_step",
  "supply_term",
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : [];
}

function label(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function externalUrl(value: unknown) {
  const url = label(value);
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function inquiryLink(item: Record<string, unknown>) {
  const params = new URLSearchParams({ product: label(item.title) });
  if (label(item.id)) params.set("candidate", label(item.id));
  if (item.retail_price_status === "verified" && label(item.retail_price_cny)) {
    params.set("price", label(item.retail_price_cny));
  }
  return "/supplier-rfq?" + params.toString();
}

export default function SourcingReport({
  payload,
}: {
  payload: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const [grade, setGrade] = useState("all");
  const candidates = records(payload.candidates);
  const sources = new Map(
    records(payload.sources).map((source) => [label(source.id), source]),
  );
  const price = record(payload.retail_price_range);
  const shown = candidates.filter(
    (item) => grade === "all" || item.grade === grade,
  );

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Collapse
        size="small"
        items={[
          {
            key: "validation",
            label: t("artifacts.sourcing.scope"),
            children: (
              <Space direction="vertical">
                <Typography.Text>
                  {t("artifacts.sourcing.screeningRule")}
                </Typography.Text>
                {price.minimum != null && price.maximum != null && (
                  <Typography.Text>
                    {t("artifacts.sourcing.price", {
                      minimum: String(price.minimum),
                      maximum: String(price.maximum),
                    })}
                  </Typography.Text>
                )}
                <Typography.Text>
                  {t("artifacts.sourcing.checkRule")}
                </Typography.Text>
              </Space>
            ),
          },
        ]}
      />
      <Tabs
        activeKey={grade}
        onChange={setGrade}
        items={["all", ...grades].map((key) => ({
          key,
          label:
            t("artifacts.sourcing.grades." + key) +
            " (" +
            (key === "all"
              ? candidates.length
              : candidates.filter((item) => item.grade === key).length) +
            ")",
        }))}
      />
      {shown.length === 0 && (
        <Empty description={t("artifacts.sourcing.empty")} />
      )}
      {shown.map((item, index) => (
        <Card
          key={index}
          title={label(item.title)}
          extra={
            <Space wrap>
              <Tag color={gradeColor(item.grade)}>
                {t("artifacts.sourcing.grades." + label(item.grade))}
              </Tag>
              {label(item.title) && <Link to={inquiryLink(item)}>{t("rfq.startFromReport")}</Link>}
            </Space>
          }
        >
          <Descriptions
            size="small"
            column={1}
            items={fields
              .filter((field) => label(item[field]))
              .map((field) => ({
                key: field,
                label: t("artifacts.sourcing.fields." + field),
                children: label(item[field]),
              }))}
          />
          {Array.isArray(item.pdd_terms) && item.pdd_terms.length > 0 && (
            <Typography.Paragraph>
              {t("artifacts.sourcing.pddTerms")} ·{" "}
              {item.pdd_terms.map(label).join(" / ")}
            </Typography.Paragraph>
          )}
          {records(item.findings).map((finding, findingIndex) => {
            const source = sources.get(label(finding.source_id));
            const url = externalUrl(source?.url);
            return (
              <Typography.Paragraph key={findingIndex}>
                <Typography.Text strong>{label(finding.fact)}</Typography.Text>
                <br />
                {label(finding.quote)}
                {url && (
                  <>
                    {" "}
                    ·{" "}
                    <a href={url} target="_blank" rel="noreferrer">
                      {label(source?.title) || url}
                    </a>
                  </>
                )}
              </Typography.Paragraph>
            );
          })}
        </Card>
      ))}
    </Space>
  );
}
