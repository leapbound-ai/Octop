import { useEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Select,
  Skeleton,
  Space,
  Tabs,
  Tag,
} from "antd";
import { ArrowLeft, ArrowRight, Clipboard, Download, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  archiveInquiry,
  getInquiry,
  getSupplierHistory,
  listSuppliers,
  parseReply,
  saveReply,
  type Inquiry,
  type Reply,
  type Supplier,
  type Term,
} from "../../api/modules/sourcingRfq";
import TermReviewDialog from "./TermReviewDialog";
import styles from "./index.module.less";

const root = "/supplier-rfq";
type Evidence = { supplier: string; term: Term };
const sameProduct = (reply: Reply, inquiry: Inquiry) =>
  (inquiry.candidate_id && reply.candidate_id === inquiry.candidate_id) ||
  reply.product_title.toLowerCase() === inquiry.title.toLowerCase();

export default function InquiryWorkspace({ id }: { id: string }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [archiveError, setArchiveError] = useState(false);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const step = params.get("step");
  const tab = step === "replies" || step === "compare" ? step : "checklist";

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void getInquiry(id, controller.signal)
      .then(setInquiry)
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [id, retry]);

  function goTo(key: string) {
    setParams(key === "checklist" ? {} : { step: key }, { replace: true });
  }

  if (!inquiry) {
    return error ? (
      <Alert
        showIcon
        type="error"
        message={t("rfq.loadFailed")}
        action={
          <Button onClick={() => setRetry(retry + 1)}>{t("rfq.retry")}</Button>
        }
      />
    ) : (
      <Skeleton active />
    );
  }

  const current = inquiry;
  async function toggleArchive() {
    setSaving(true);
    setArchiveError(false);
    try {
      setInquiry(await archiveInquiry(id, !current.archived));
    } catch {
      setArchiveError(true);
    } finally {
      setSaving(false);
    }
  }

  function updateReply(reply: Reply) {
    setInquiry((previous) => {
      if (!previous) return previous;
      const exists = previous.replies.some(
        (item) => item.supplier_id === reply.supplier_id,
      );
      const replies = exists
        ? previous.replies.map((item) =>
            item.supplier_id === reply.supplier_id ? reply : item,
          )
        : [reply, ...previous.replies];
      return { ...previous, replies };
    });
  }

  return (
    <div className={styles.page}>
      <Link to={root} className={styles.back}>
        <ArrowLeft size={15} />
        {t("rfq.inquiries")}
      </Link>
      <header className={styles.heading}>
        <div>
          <h1>
            {inquiry.title}{" "}
            {inquiry.archived && <Tag>{t("rfq.states.archived")}</Tag>}
          </h1>
          <div className={styles.meta}>
            {inquiry.plan_price && (
              <span>{t("rfq.priceValue", { value: inquiry.plan_price })}</span>
            )}
            {inquiry.monthly_qty && (
              <span>
                {t("rfq.monthlyValue", { value: inquiry.monthly_qty })}
              </span>
            )}
            {inquiry.categories.map((item) => (
              <span key={item}>{t("rfq.categories." + item)}</span>
            ))}
          </div>
        </div>
        <Button loading={saving} onClick={toggleArchive}>
          {t(inquiry.archived ? "rfq.reopen" : "rfq.archive")}
        </Button>
      </header>
      {archiveError && (
        <Alert showIcon type="error" message={t("rfq.saveFailed")} />
      )}
      <Tabs
        activeKey={tab}
        onChange={(key) => {
          setEvidence(null);
          goTo(key);
        }}
        items={[
          {
            key: "checklist",
            label: t("rfq.checklist"),
            children: (
              <Checklist inquiry={inquiry} next={() => goTo("replies")} />
            ),
          },
          {
            key: "replies",
            label: t("rfq.replies"),
            children: (
              <ReplyDesk
                inquiry={inquiry}
                evidence={evidence}
                updateReply={updateReply}
              />
            ),
          },
          {
            key: "compare",
            label: t("rfq.compare"),
            children: (
              <Compare
                inquiry={inquiry}
                record={() => goTo("replies")}
                showEvidence={(supplier, term) => {
                  setEvidence({ supplier, term });
                  goTo("replies");
                }}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function CopyButton({
  text,
  label,
  primary,
}: {
  text: string;
  label: string;
  primary?: boolean;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      void message.success(t("rfq.copied"));
    } catch {
      void message.error(t("rfq.copyFailed"));
    }
  }
  return (
    <Button
      type={primary ? "primary" : "default"}
      icon={<Clipboard size={14} />}
      onClick={copy}
    >
      {label}
    </Button>
  );
}

function Checklist({ inquiry, next }: { inquiry: Inquiry; next: () => void }) {
  const { t } = useTranslation();
  const message = [
    t("rfq.greeting", { product: inquiry.title }),
    ...inquiry.questions.map((item, i) => `${i + 1}. ${item.ask}`),
  ].join("\n");
  return (
    <section>
      <div className={styles.sectionHeading}>
        <div>
          <h2>{t("rfq.questions")}</h2>
          <p>{t("rfq.checklistHelp")}</p>
        </div>
        <CopyButton text={message} label={t("rfq.copyAll")} primary />
      </div>
      <ol className={styles.questions}>
        {inquiry.questions.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.ask}</strong>
              <p>{item.why}</p>
            </div>
            <CopyButton text={item.ask} label={t("rfq.copy")} />
          </li>
        ))}
      </ol>
      <Button icon={<ArrowRight size={16} />} onClick={next}>
        {t("rfq.replies")}
      </Button>
    </section>
  );
}

function ReplyDesk({
  inquiry,
  evidence,
  updateReply,
}: {
  inquiry: Inquiry;
  evidence: Evidence | null;
  updateReply: (reply: Reply) => void;
}) {
  const { t } = useTranslation();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierError, setSupplierError] = useState(false);
  const [selected, setSelected] = useState(
    evidence?.supplier || inquiry.replies[0]?.supplier_id || "",
  );
  const [name, setName] = useState("");
  const [shop, setShop] = useState("");
  const [drafts, setDrafts] = useState<Partial<Record<string, string>>>({});
  const [history, setHistory] = useState<Reply[]>([]);
  const [highlight, setHighlight] = useState<Term | null>(
    evidence?.term ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{
    replyId: string;
    label: string;
    term: Term;
  } | null>(null);
  const [error, setError] = useState("");
  const mark = useRef<HTMLElement>(null);
  const reply = inquiry.replies.find((item) => item.supplier_id === selected);
  const draft = inquiry.archived ? undefined : drafts[selected];
  const raw = draft ?? reply?.raw_text ?? "";
  const terms =
    reply && (highlight || raw === reply.raw_text) ? reply.terms : null;
  const supplierHistory = history.filter(
    (item) => item.supplier_id === selected,
  );
  const previous =
    supplierHistory.find(
      (item) =>
        item.rfq_id !== inquiry.rfq_id &&
        item.terms &&
        sameProduct(item, inquiry),
    ) ??
    supplierHistory.find(
      (item) => item.rfq_id !== inquiry.rfq_id && item.terms,
    );
  const gaps = inquiry.questions.filter(
    (item) => terms?.find((term) => term.id === item.id)?.status !== "found",
  );
  const oldGaps = inquiry.questions.filter(
    (item) =>
      previous?.terms?.some(
        (term) => term.id === item.id && term.status !== "found",
      ),
  );

  const followups = [
    ...gaps.filter((item) => oldGaps.includes(item)),
    ...gaps.filter((item) => !oldGaps.includes(item)),
  ].slice(0, 3);

  useEffect(() => {
    const controller = new AbortController();
    void listSuppliers(controller.signal)
      .then(setSuppliers)
      .catch(() => {
        if (!controller.signal.aborted) setSupplierError(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void getSupplierHistory(selected, controller.signal)
      .then(setHistory)
      .catch(() => {
        if (!controller.signal.aborted) setHistory([]);
      });
    return () => controller.abort();
  }, [selected]);

  useEffect(() => {
    if (!evidence) return;
    setSelected(evidence.supplier);
    setHighlight(evidence.term);
    setError("");
  }, [evidence]);

  useEffect(() => {
    if (highlight)
      mark.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [highlight, selected]);

  function choose(value: string) {
    if (value === selected && value) return;
    setSelected(value);
    setHighlight(null);
    setError("");
  }

  async function submit(parse: boolean) {
    setError("");
    setBusy(true);
    let saved: Reply | undefined;
    try {
      saved = await saveReply(inquiry.rfq_id, {
        raw_text: raw,
        ...(!selected
          ? { name: name.trim(), shop_url: shop.trim() }
          : { supplier_id: selected }),
      });
      updateReply(saved);
      setSelected(saved.supplier_id);
      setDrafts((items) => ({ ...items, [selected]: undefined }));
      if (!selected) {
        setName("");
        setShop("");
      }
      setHighlight(null);
      if (parse && !saved.terms) updateReply(await parseReply(saved.reply_id));
    } catch {
      setError(saved ? "rfq.parseFailed" : "rfq.saveReplyFailed");
    } finally {
      setBusy(false);
    }
  }

  const options = new Map(
    suppliers.map((item) => [item.supplier_id, item.name]),
  );
  inquiry.replies.forEach((item) =>
    options.set(item.supplier_id, item.supplier_name),
  );
  const canSave =
    !inquiry.archived && !!raw.trim() && (!!selected || !!name.trim());
  const found = terms?.filter((item) => item.status === "found").length ?? 0;
  const ambiguous =
    terms?.filter((item) => item.status === "ambiguous").length ?? 0;
  const codePoints = highlight && reply ? Array.from(reply.raw_text) : [];
  const evidenceVisible =
    highlight?.start != null &&
    highlight?.end != null &&
    highlight.quote &&
    !!terms;

  return (
    <section>
      <div className={styles.sectionHeading}>
        <div>
          <h2>{t("rfq.replies")}</h2>
          <p>{t("rfq.repliesHelp")}</p>
        </div>
        {!inquiry.archived && selected && (
          <Button
            icon={<Plus size={16} />}
            disabled={busy}
            onClick={() => choose("")}
          >
            {t("rfq.newSupplier")}
          </Button>
        )}
      </div>
      <div className={styles.desk}>
        <div className={styles.editor}>
          <label htmlFor="rfq-supplier">{t("rfq.supplier")}</label>
          <Select
            id="rfq-supplier"
            value={selected || undefined}
            showSearch
            optionFilterProp="label"
            disabled={busy}
            placeholder={t("rfq.chooseSupplier")}
            onChange={choose}
            options={[...options]
              .filter(
                ([id]) =>
                  !inquiry.archived ||
                  inquiry.replies.some((item) => item.supplier_id === id),
              )
              .map(([value, label]) => ({ value, label }))}
          />
          {supplierError && (
            <Alert type="warning" message={t("rfq.supplierLoadFailed")} />
          )}
          {!selected && !inquiry.archived && (
            <div className={styles.fields}>
              <label>
                {t("rfq.supplierName")}
                <Input
                  value={name}
                  maxLength={160}
                  disabled={busy}
                  placeholder={t("rfq.supplierPlaceholder")}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                {t("rfq.shopLink")}
                <Input
                  value={shop}
                  maxLength={500}
                  disabled={busy}
                  placeholder={t("rfq.optional")}
                  onChange={(event) => setShop(event.target.value)}
                />
              </label>
            </div>
          )}
          {previous && (
            <details className={styles.historyEntry}>
              <summary>
                {t("rfq.previous", { product: previous.product_title })}
              </summary>
              {oldGaps.length > 0 && (
                <p>
                  {t("rfq.previousGaps", {
                    terms: oldGaps.map((item) => item.label).join(" / "),
                  })}
                </p>
              )}
              <pre className={styles.source}>{previous.raw_text}</pre>
            </details>
          )}
          <label htmlFor="rfq-source">{t("rfq.original")}</label>
          {evidenceVisible ? (
            <div className={styles.evidence}>
              <pre className={styles.source}>
                {codePoints.slice(0, highlight.start!).join("")}
                <mark ref={mark}>{highlight.quote}</mark>
                {codePoints.slice(highlight.end!).join("")}
              </pre>
              <Button size="small" onClick={() => setHighlight(null)}>
                {t("rfq.closeEvidence")}
              </Button>
            </div>
          ) : (
            <Input.TextArea
              id="rfq-source"
              value={raw}
              maxLength={16000}
              rows={11}
              readOnly={inquiry.archived}
              disabled={busy}
              placeholder={t("rfq.replyPlaceholder")}
              onChange={(event) => {
                const text = event.target.value;
                setDrafts((items) => ({ ...items, [selected]: text }));
              }}
            />
          )}
          {!inquiry.archived && (
            <Space wrap>
              <Button
                type="primary"
                loading={busy}
                disabled={!canSave || !!terms}
                onClick={() => void submit(true)}
              >
                {t(
                  reply && raw === reply.raw_text
                    ? "rfq.parse"
                    : "rfq.saveParse",
                )}
              </Button>
              <Button
                disabled={busy || !canSave || raw === reply?.raw_text}
                onClick={() => void submit(false)}
              >
                {t("rfq.saveOnly")}
              </Button>
            </Space>
          )}
          {error && <Alert type="error" showIcon message={t(error)} />}
        </div>
        <div className={styles.results}>
          <h3>{t("rfq.terms")}</h3>
          {!terms ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t(reply && draft ? "rfq.edited" : "rfq.noTerms")}
            />
          ) : (
            <>
              <div className={styles.meta}>
                <Tag color="green">{t("rfq.foundCount", { count: found })}</Tag>
                <Tag color="gold">
                  {t("rfq.ambiguousCount", { count: ambiguous })}
                </Tag>
                <Tag>
                  {t("rfq.absentCount", {
                    count: terms.length - found - ambiguous,
                  })}
                </Tag>
              </div>
              <dl className={styles.terms}>
                {inquiry.questions.map((question) => {
                  const term = terms.find((item) => item.id === question.id);
                  return (
                    term && (
                      <div key={question.id}>
                        <dt>{question.label}</dt>
                        <dd className={styles.termActions}>
                          <TermValue
                            term={term}
                            onEvidence={() => setHighlight(term)}
                          />
                          {reply &&
                            !inquiry.archived &&
                            raw === reply.raw_text && (
                              <Button
                                type="text"
                                size="small"
                                disabled={busy}
                                aria-label={t("rfq.review.editNamed", {
                                  term: question.label,
                                })}
                                onClick={() =>
                                  setEditing({
                                    replyId: reply.reply_id,
                                    label: question.label,
                                    term,
                                  })
                                }
                              >
                                {t("rfq.review.edit")}
                              </Button>
                            )}
                        </dd>
                      </div>
                    )
                  );
                })}
              </dl>
              {gaps.length > 0 && (
                <div className={styles.followup}>
                  <h3>{t("rfq.followup")}</h3>
                  {oldGaps.some((item) => gaps.includes(item)) && (
                    <p>{t("rfq.recurring")}</p>
                  )}
                  <ol>
                    {followups.map((item) => (
                      <li key={item.id}>{item.ask}</li>
                    ))}
                  </ol>
                  <CopyButton
                    label={t("rfq.copyFollowup")}
                    text={[
                      t("rfq.followupIntro"),
                      ...followups.map((item, i) => `${i + 1}. ${item.ask}`),
                    ].join("\n")}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {editing && (
        <TermReviewDialog
          {...editing}
          close={() => setEditing(null)}
          onSaved={(reply) => {
            updateReply(reply);
            setHighlight(null);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function TermValue({
  term,
  onEvidence,
}: {
  term: Term;
  onEvidence: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.termValue}>
      <Tag
        color={
          term.status === "found"
            ? "green"
            : term.status === "ambiguous"
            ? "gold"
            : undefined
        }
      >
        {t("rfq.termStatus." + term.status)}
      </Tag>
      {term.manual && <Tag color="blue">{t("rfq.review.manual")}</Tag>}
      {term.manual && term.value && <span>{term.value}</span>}
      {term.quote && (
        <button
          type="button"
          className={styles.quote}
          onClick={onEvidence}
          title={t("rfq.viewEvidence")}
        >
          {term.manual ? t("rfq.viewEvidence") : term.value ?? term.quote}
        </button>
      )}
    </div>
  );
}

function Compare({
  inquiry,
  record,
  showEvidence,
}: {
  inquiry: Inquiry;
  record: () => void;
  showEvidence: (supplier: string, term: Term) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[] | null>(null);
  const replies = inquiry.replies.filter((reply, i) =>
    selected ? selected.includes(reply.supplier_id) : i < 4,
  );
  const lookup = (reply: Reply, id: string) =>
    reply.terms?.find((term) => term.id === id);
  const pending = replies.reduce(
    (sum, reply) =>
      sum +
      (reply.terms?.filter((term) => term.status !== "found").length ?? 0),
    0,
  );
  const unparsed = replies.filter((reply) => !reply.terms).length;

  function download() {
    const clean = (value: string) =>
      value.replace(/[\\|`*_~<>[\]#]/g, "\\$&").replace(/\r?\n/g, " ");
    const cells = (items: string[]) =>
      "| " + items.map(clean).join(" | ") + " |";
    const lines = [
      "# " + clean(inquiry.title),
      "",
      cells([t("rfq.terms"), ...replies.map((reply) => reply.supplier_name)]),
      cells(Array(replies.length + 1).fill("---")),
      ...inquiry.questions.map((question) =>
        cells([
          question.label,
          ...replies.map((reply) => {
            const term = lookup(reply, question.id);
            if (!term) return t("rfq.unparsed");
            return [
              t("rfq.termStatus." + term.status),
              term.manual ? t("rfq.review.manual") : null,
              term.manual ? term.value : term.value ?? term.quote,
            ]
              .filter(Boolean)
              .join(" · ");
          }),
        ]),
      ),
      cells([t("rfq.landed"), ...replies.map(() => t("rfq.costPending"))]),
      ...replies.flatMap((reply) => [
        "",
        "## " + clean(reply.supplier_name),
        "",
        ...reply.raw_text.split(/\r?\n/).map((line) => "> " + clean(line)),
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "inquiry-" + inquiry.rfq_id + ".md";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section>
      <div className={styles.sectionHeading}>
        <div>
          <h2>{t("rfq.compare")}</h2>
          <p>
            {replies.length > 0
              ? t("rfq.compareProgress", { pending, unparsed })
              : t("rfq.compareHelp")}
          </p>
        </div>
        <Button
          disabled={!replies.length}
          icon={<Download size={16} />}
          onClick={download}
        >
          {t("rfq.export")}
        </Button>
      </div>
      {!inquiry.replies.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("rfq.noReplies")}
        >
          <Button type="primary" onClick={record}>
            {t("rfq.replies")}
          </Button>
        </Empty>
      ) : (
        <>
          {inquiry.replies.length > 1 && (
            <div className={styles.filters}>
              <Select
                aria-label={t("rfq.compareSuppliers")}
                mode="multiple"
                maxCount={5}
                placeholder={t("rfq.compareSuppliers")}
                value={replies.map((reply) => reply.supplier_id)}
                onChange={setSelected}
                options={inquiry.replies.map((item) => ({
                  value: item.supplier_id,
                  label: item.supplier_name,
                }))}
              />
            </div>
          )}
          {replies.length ? (
            <div className={styles.tableScroll}>
              <table className={styles.compare}>
                <thead>
                  <tr>
                    <th scope="col">{t("rfq.terms")}</th>
                    {replies.map((reply) => (
                      <th scope="col" key={reply.supplier_id}>
                        {reply.supplier_name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inquiry.questions.map((question) => (
                    <tr key={question.id}>
                      <th scope="row">{question.label}</th>
                      {replies.map((reply) => {
                        const term = lookup(reply, question.id);
                        return (
                          <td key={reply.supplier_id}>
                            {term ? (
                              <TermValue
                                term={term}
                                onEvidence={() =>
                                  showEvidence(reply.supplier_id, term)
                                }
                              />
                            ) : (
                              <span className={styles.muted}>
                                {t("rfq.unparsed")}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">{t("rfq.landed")}</th>
                    {replies.map((reply) => (
                      <td key={reply.supplier_id}>{t("rfq.costPending")}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t("rfq.compareSuppliers")}
            />
          )}
          <div className={styles.compareFoot}>
            <Link to="/profit-calculator">
              {t("rfq.calculator")} <ArrowRight size={14} />
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
