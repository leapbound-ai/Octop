import {
  Alert,
  Button,
  Input,
  Rate,
  Select,
  Space,
  Spin,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ArtifactDetail,
  getArtifactReview,
  updateArtifactReview,
  listArtifactComments,
  addArtifactComment,
  deleteArtifactComment,
} from "../../api/modules/octopArtifacts";
import styles from "./index.module.less";

export default function ArtifactFeedback({
  artifact,
}: {
  artifact: ArtifactDetail;
}) {
  const { t } = useTranslation();
  const [review, setReview] = useState<{
    rating: number;
    decision: "pending" | "adopted" | "rejected";
    use_for_preferences: boolean;
  }>();
  const [comments, setComments] = useState<
    { comment_id: string; content: string; created_at: number }[]
  >([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestId = useRef("");
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getArtifactReview(artifact.artifact_id, controller.signal),
      listArtifactComments(artifact.artifact_id, controller.signal),
    ])
      .then(([value, rows]) => {
        if (!controller.signal.aborted) {
          setReview(value);
          setComments(rows.items);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [artifact.artifact_id]);
  async function save(values: Partial<NonNullable<typeof review>>) {
    setBusy(true);
    setFailed(false);
    try {
      setReview(await updateArtifactReview(artifact.artifact_id, values));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  async function comment() {
    const content = draft.trim();
    if (!content) return;
    if (!requestId.current)
      requestId.current = Array.from(
        crypto.getRandomValues(new Uint8Array(16)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
    setBusy(true);
    setFailed(false);
    try {
      const value = await addArtifactComment(
        artifact.artifact_id,
        requestId.current,
        content,
      );
      setComments((rows) => [value, ...rows]);
      setDraft("");
      requestId.current = "";
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {failed && (
        <Alert type="error" showIcon message={t("artifacts.actionFailed")} />
      )}
      {!review ? (
        <Spin />
      ) : (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              value={draft}
              maxLength={2000}
              disabled={busy}
              placeholder={t("artifacts.feedback.placeholder")}
              onChange={(event) => setDraft(event.target.value)}
              onPressEnter={() => void comment()}
            />
            <Button
              type="primary"
              loading={busy}
              disabled={!draft.trim()}
              onClick={() => void comment()}
            >
              {t("artifacts.feedback.comment")}
            </Button>
          </Space.Compact>
          {comments.map((item) => (
            <div key={item.comment_id} className={styles.comment}>
              <Typography.Paragraph>{item.content}</Typography.Paragraph>
              <Button
                type="link"
                size="small"
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    try {
                      await deleteArtifactComment(
                        artifact.artifact_id,
                        item.comment_id,
                      );
                      setComments((rows) =>
                        rows.filter(
                          (row) => row.comment_id !== item.comment_id,
                        ),
                      );
                    } catch {
                      setFailed(true);
                    } finally {
                      setBusy(false);
                    }
                  })()
                }
              >
                {t("artifacts.feedback.delete")}
              </Button>
            </div>
          ))}
          <Space wrap>
            <Typography.Text>{t("artifacts.feedback.rating")}</Typography.Text>
            <Rate
              value={review.rating}
              disabled={busy}
              onChange={(rating) => void save({ rating })}
            />
            <Select
              value={review.decision}
              disabled={busy}
              aria-label={t("artifacts.feedback.decision")}
              onChange={(decision) => void save({ decision })}
              options={["pending", "adopted", "rejected"].map((value) => ({
                value,
                label: t("artifacts.feedback." + value),
              }))}
            />
          </Space>
          <Select
            value={review.use_for_preferences}
            disabled={busy}
            aria-label={t("artifacts.feedback.preferenceUse")}
            onChange={(use_for_preferences) =>
              void save({ use_for_preferences })
            }
            options={[true, false].map((value) => ({
              value,
              label: t(
                value
                  ? "artifacts.feedback.preferenceOn"
                  : "artifacts.feedback.preferenceOff",
              ),
            }))}
          />
        </Space>
      )}
    </div>
  );
}
