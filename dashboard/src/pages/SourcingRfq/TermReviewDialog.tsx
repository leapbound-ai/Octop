import { useState } from "react";
import { Alert, Button, Form, Input, Modal, Select } from "antd";
import { useTranslation } from "react-i18next";
import {
  reviewTerm,
  type Reply,
  type Term,
  type TermReview,
  type TermStatus,
} from "../../api/modules/sourcingRfq";
import styles from "./index.module.less";

const statuses: TermStatus[] = ["found", "ambiguous", "absent"];

export default function TermReviewDialog({
  replyId,
  label,
  term,
  close,
  onSaved,
}: {
  replyId: string;
  label: string;
  term: Term;
  close: () => void;
  onSaved: (reply: Reply) => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<TermReview>();
  const status = Form.useWatch("status", form) ?? term.status;
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save(review: TermReview | null) {
    setSaving(true);
    setFailed(false);
    try {
      onSaved(await reviewTerm(replyId, term.id, review));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={t("rfq.review.editNamed", { term: label })}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      onCancel={close}
      onOk={form.submit}
      confirmLoading={saving}
      okText={t("rfq.review.save")}
      cancelButtonProps={{ disabled: saving }}
      footer={(_, { OkBtn, CancelBtn }) => (
        <>
          {term.manual && (
            <Button disabled={saving} onClick={() => void save(null)}>
              {t("rfq.review.restore")}
            </Button>
          )}
          <CancelBtn />
          <OkBtn />
        </>
      )}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ status: term.status, value: term.value }}
        onFinish={(values) =>
          void save({
            status: values.status,
            value:
              values.status === "found" ? values.value?.trim() ?? null : null,
          })
        }
      >
        {term.quote && (
          <>
            <p>{t("rfq.review.supplierQuote")}</p>
            <blockquote className={styles.source}>{term.quote}</blockquote>
          </>
        )}
        <Form.Item name="status" label={t("rfq.status")}>
          <Select
            disabled={saving}
            options={statuses.map((value) => ({
              value,
              label: t("rfq.termStatus." + value),
            }))}
          />
        </Form.Item>
        {status === "found" && (
          <Form.Item
            name="value"
            label={t("rfq.review.value")}
            rules={[
              {
                required: true,
                whitespace: true,
                message: t("rfq.review.requireValue"),
              },
            ]}
          >
            <Input.TextArea
              autoFocus
              disabled={saving}
              maxLength={400}
              autoSize={{ minRows: 2, maxRows: 5 }}
            />
          </Form.Item>
        )}
        {failed && (
          <Alert type="error" showIcon message={t("rfq.review.failed")} />
        )}
      </Form>
    </Modal>
  );
}
