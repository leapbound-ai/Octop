import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Skeleton,
  Table,
  Tabs,
  Tag,
} from "antd";
import { ArrowRight, Plus } from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  createInquiry,
  getSupplierHistory,
  listInquiries,
  listSuppliers,
  type Category,
  type InquiryInput,
  type InquirySummary,
  type Reply,
  type Supplier,
} from "../../api/modules/sourcingRfq";
import { useServerTimezone } from "../../hooks/useServerTimezone";
import { formatServerDateTime } from "../../utils/formatMessageTime";
import InquiryWorkspace from "./InquiryWorkspace";
import styles from "./index.module.less";

export const inquiryPath = "/supplier-rfq";
const categories: Category[] = ["electrical", "textile", "food_contact"];
const inquiryStatus = (row: InquirySummary) => {
  if (row.archived) return "archived";
  if (!row.supplier_count) return "asking";
  if (row.parsed_count < row.supplier_count) return "pending";
  return row.parsed_count > 1 ? "ready" : "asking";
};

export default function SourcingRfqPage() {
  const { inquiryId } = useParams();
  return inquiryId ? (
    <InquiryWorkspace key={inquiryId} id={inquiryId} />
  ) : (
    <InquiryList />
  );
}

function InquiryList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const timezone = useServerTimezone();
  const [params, setParams] = useSearchParams();
  const candidate = params.get("product")?.trim().slice(0, 160) || "";
  const price = params.get("price") || "";
  const [creating, setCreating] = useState(Boolean(candidate));
  const [activeTab, setActiveTab] = useState("rfqs");
  const [rows, setRows] = useState<InquirySummary[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    const load =
      activeTab === "rfqs"
        ? listInquiries(controller.signal).then(setRows)
        : listSuppliers(controller.signal).then(setSuppliers);
    void load.catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [activeTab, retry]);

  const matching = rows?.filter(
    (row) =>
      (status === "all" || status === inquiryStatus(row)) &&
      row.title.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const shops = suppliers?.filter((supplier) =>
    supplier.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h1>{t("rfq.title")}</h1>
          <p>{t("rfq.intro")}</p>
        </div>
        <Button
          type="primary"
          icon={<Plus size={16} />}
          onClick={() => setCreating(true)}
        >
          {t("rfq.create")}
        </Button>
      </header>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setSearch("");
          setActiveTab(key);
        }}
        items={[
          { key: "rfqs", label: t("rfq.inquiries") },
          { key: "suppliers", label: t("rfq.suppliers") },
        ]}
      />
      <div className={styles.filters}>
        <Input.Search
          allowClear
          value={search}
          aria-label={t("rfq.search")}
          placeholder={t("rfq.search")}
          onChange={(event) => setSearch(event.target.value)}
        />
        {activeTab === "rfqs" && (
          <Select
            value={status}
            onChange={setStatus}
            aria-label={t("rfq.status")}
            options={["all", "asking", "pending", "ready", "archived"].map(
              (value) => ({
                value,
                label: t("rfq.states." + value),
              }),
            )}
          />
        )}
      </div>
      {error && (
        <Alert
          type="error"
          showIcon
          message={t("rfq.loadFailed")}
          action={
            <Button onClick={() => setRetry(retry + 1)}>
              {t("rfq.retry")}
            </Button>
          }
        />
      )}
      {activeTab === "rfqs" ? (
        <Table
          rowKey="rfq_id"
          dataSource={matching ?? []}
          loading={!error && !rows}
          scroll={{ x: 680 }}
          pagination={{ pageSize: 12, hideOnSinglePage: true }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t(
                  rows?.length ? "rfq.noMatches" : "rfq.emptyInquiries",
                )}
              />
            ),
          }}
          columns={[
            {
              title: t("rfq.product"),
              dataIndex: "title",
              render: (name: string, row) => (
                <Link
                  className={styles.recordName}
                  to={inquiryPath + "/" + row.rfq_id}
                >
                  {name}
                </Link>
              ),
            },
            {
              title: t("rfq.progress"),
              key: "progress",
              render: (_, row) =>
                t("rfq.progressValue", {
                  suppliers: row.supplier_count,
                  parsed: row.parsed_count,
                }),
            },
            {
              title: t("rfq.status"),
              key: "status",
              render: (_, row) => {
                const state = inquiryStatus(row);
                return (
                  <Tag
                    color={
                      state === "pending"
                        ? "gold"
                        : state === "ready"
                        ? "green"
                        : undefined
                    }
                  >
                    {t("rfq.states." + state)}
                  </Tag>
                );
              },
            },
            {
              title: t("rfq.updated"),
              dataIndex: "updated_at",
              render: (value: number) => formatServerDateTime(value, timezone),
            },
            {
              key: "action",
              render: (_, row) => {
                const state = inquiryStatus(row);
                const tab =
                  state === "ready" || state === "archived"
                    ? "compare"
                    : row.supplier_count
                    ? "replies"
                    : "";
                return (
                  <Link
                    to={
                      inquiryPath +
                      "/" +
                      row.rfq_id +
                      (tab ? "?step=" + tab : "")
                    }
                  >
                    {t("rfq.actions." + state)} <ArrowRight size={13} />
                  </Link>
                );
              },
            },
          ]}
        />
      ) : (
        <Table
          rowKey="supplier_id"
          dataSource={shops ?? []}
          loading={!error && !suppliers}
          scroll={{ x: 620 }}
          pagination={{ pageSize: 12, hideOnSinglePage: true }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t(
                  suppliers?.length ? "rfq.noMatches" : "rfq.emptySuppliers",
                )}
              />
            ),
          }}
          columns={[
            {
              title: t("rfq.supplier"),
              dataIndex: "name",
              render: (name: string, row) => (
                <Button
                  className={styles.recordName}
                  type="link"
                  onClick={() => setSelected(row)}
                >
                  {name}
                </Button>
              ),
            },
            {
              title: t("rfq.shop"),
              key: "shop",
              render: (_, row) =>
                row.shop_url ? (
                  <a href={row.shop_url} target="_blank" rel="noreferrer">
                    1688
                  </a>
                ) : (
                  "—"
                ),
            },
            { title: t("rfq.versionCount"), dataIndex: "version_count" },
            {
              title: t("rfq.lastContact"),
              dataIndex: "last_contact",
              render: (value: number | null) =>
                value ? formatServerDateTime(value, timezone) : "—",
            },
          ]}
        />
      )}
      {creating && (
        <CreateInquiry
          initial={{
            title: candidate,
            candidate_id: (params.get("candidate") || "").slice(0, 240),
            plan_price: /^\d{1,8}(\.\d{1,2})?$/.test(price) ? price : null,
            monthly_qty: null,
            categories: [],
          }}
          onCancel={() => {
            setCreating(false);
            if (candidate) setParams({}, { replace: true });
          }}
          onCreated={(id) => navigate(inquiryPath + "/" + id)}
        />
      )}
      {selected && (
        <SupplierHistory
          key={selected.supplier_id}
          supplier={selected}
          close={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function CreateInquiry({
  initial,
  onCancel,
  onCreated,
}: {
  initial: InquiryInput;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<InquiryInput>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function submit(values: InquiryInput) {
    setSaving(true);
    setError(false);
    try {
      const result = await createInquiry({
        ...values,
        candidate_id: initial.candidate_id,
        plan_price: values.plan_price || null,
      });
      onCreated(result.rfq_id);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={t("rfq.create")}
      onCancel={onCancel}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      okText={t("rfq.generate")}
      confirmLoading={saving}
      onOk={form.submit}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        onFinish={submit}
      >
        <Form.Item
          name="title"
          label={t("rfq.product")}
          rules={[
            {
              required: true,
              whitespace: true,
              message: t("rfq.requireProduct"),
            },
          ]}
        >
          <Input
            autoFocus
            maxLength={160}
            placeholder={t("rfq.productPlaceholder")}
          />
        </Form.Item>
        <div className={styles.fields}>
          <Form.Item
            name="plan_price"
            label={t("rfq.price")}
            rules={[
              {
                pattern: /^\d{1,8}(\.\d{1,2})?$/,
                message: t("rfq.priceInvalid"),
              },
            ]}
          >
            <Input
              inputMode="decimal"
              placeholder={t("rfq.optional")}
              maxLength={11}
            />
          </Form.Item>
          <Form.Item name="monthly_qty" label={t("rfq.monthly")}>
            <InputNumber
              min={1}
              max={100000000}
              precision={0}
              placeholder={t("rfq.optional")}
            />
          </Form.Item>
        </div>
        <Form.Item name="categories" label={t("rfq.category")}>
          <Select
            mode="multiple"
            placeholder={t("rfq.categoryPlaceholder")}
            options={categories.map((value) => ({
              value,
              label: t("rfq.categories." + value),
            }))}
          />
        </Form.Item>
        {error && <Alert showIcon type="error" message={t("rfq.saveFailed")} />}
      </Form>
    </Modal>
  );
}

function SupplierHistory({
  supplier,
  close,
}: {
  supplier: Supplier;
  close: () => void;
}) {
  const { t } = useTranslation();
  const timezone = useServerTimezone();
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void getSupplierHistory(supplier.supplier_id, controller.signal)
      .then(setReplies)
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [supplier.supplier_id]);

  return (
    <Modal
      open
      title={supplier.name}
      width={700}
      onCancel={close}
      footer={null}
    >
      {error ? (
        <Alert showIcon type="error" message={t("rfq.loadFailed")} />
      ) : !replies ? (
        <Skeleton />
      ) : (
        replies.map((reply) => (
          <details key={reply.reply_id} className={styles.historyEntry}>
            <summary>
              <strong>{reply.product_title}</strong>
              <span>{formatServerDateTime(reply.created_at, timezone)}</span>
              <Tag>{t(reply.terms ? "rfq.parsed" : "rfq.states.pending")}</Tag>
            </summary>
            {!!reply.terms?.some((term) => term.status === "found") && (
              <ul>
                {reply.terms
                  .filter((term) => term.status === "found")
                  .map((term) => (
                    <li key={term.id}>
                      {term.value}
                      {term.manual && (
                        <Tag className={styles.historyTag} color="blue">
                          {t("rfq.review.manual")}
                        </Tag>
                      )}
                    </li>
                  ))}
              </ul>
            )}
            <pre className={styles.source}>{reply.raw_text}</pre>
          </details>
        ))
      )}
    </Modal>
  );
}
