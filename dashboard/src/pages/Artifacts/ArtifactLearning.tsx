import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import {
  type ArtifactDetail,
  type ArtifactVersion,
  type ArtifactVersionInfo,
  deriveArtifact,
  getArtifactVersion,
  listArtifactVersions,
} from "../../api/modules/octopArtifacts";
import { useServerTimezone } from "../../hooks/useServerTimezone";
import { writeInputDraft } from "../Chat/hooks/chatStore";
import { formatServerDateTime } from "../../utils/formatMessageTime";
import styles from "./index.module.less";

const parentKey = "parent";

function versionText(version: ArtifactVersion) {
  if (version.content_type === "json") {
    return JSON.stringify(JSON.parse(version.content), null, 2);
  }
  return version.content;
}

function changedText(text: string, other: string) {
  const lines = text.split("\n");
  const previous = other.split("\n");
  let start = 0;
  while (
    start < lines.length &&
    start < previous.length &&
    lines[start] === previous[start]
  )
    start++;
  let suffix = 0;
  while (
    suffix < lines.length - start &&
    suffix < previous.length - start &&
    lines[lines.length - 1 - suffix] === previous[previous.length - 1 - suffix]
  )
    suffix++;
  const end = lines.length - suffix;
  return (
    <>
      {lines.slice(0, start).join("\n")}
      {start > 0 && start < lines.length && "\n"}
      {end > start && <mark>{lines.slice(start, end).join("\n")}</mark>}
      {suffix > 0 && (end > start ? "\n" : "") + lines.slice(end).join("\n")}
    </>
  );
}

export default function ArtifactLearning({
  artifact,
}: {
  artifact: ArtifactDetail;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const timezone = useServerTimezone();
  const [versions, setVersions] = useState<ArtifactVersionInfo[]>([]);
  const [selection, setSelection] = useState<string>();
  const [base, setBase] = useState<string>();
  const [comparison, setComparison] =
    useState<[ArtifactVersion, ArtifactVersion]>();
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [versionFailed, setVersionFailed] = useState(false);
  const [compareFailed, setCompareFailed] = useState(false);
  const [deriveFailed, setDeriveFailed] = useState(false);
  const [deriveOpen, setDeriveOpen] = useState(false);
  const [deriving, setDeriving] = useState(false);
  const [task, setTask] = useState("");
  const id = artifact.artifact_id;
  const requestId = useRef("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setVersionFailed(false);
    void listArtifactVersions(id, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        setVersions(rows);
        setSelection(rows[0] ? String(rows[0].revision) : undefined);
        setBase(
          artifact.parent_version != null
            ? parentKey
            : rows[1]
            ? String(rows[1].revision)
            : undefined,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setVersionFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, artifact.parent_version]);

  useEffect(() => {
    setComparison(undefined);
    setCompareFailed(false);
    if (!selection || !base || selection === base) {
      setComparing(false);
      return;
    }
    const controller = new AbortController();
    setComparing(true);
    void Promise.all([
      base === parentKey
        ? getArtifactVersion(
            artifact.parent_id,
            artifact.parent_version!,
            controller.signal,
          )
        : getArtifactVersion(id, Number(base), controller.signal),
      getArtifactVersion(id, Number(selection), controller.signal),
    ])
      .then((values) => {
        if (!controller.signal.aborted) setComparison(values);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCompareFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setComparing(false);
      });
    return () => controller.abort();
  }, [id, selection, base, artifact.parent_id, artifact.parent_version]);

  async function derive() {
    setDeriving(true);
    setDeriveFailed(false);
    try {
      const objective = task.trim() || t("artifacts.learning.defaultTask");
      const result = await deriveArtifact(
        id,
        objective,
        requestId.current,
        selection ? Number(selection) : undefined,
      );
      const { context } = result;
      const heading = t("artifacts.learning.contextHeading");
      const revision =
        context.revision == null
          ? ""
          : " · " +
            t("artifacts.learning.version", { revision: context.revision });
      const source =
        context.title + revision + " (" + context.artifact_id + ")";
      const reference = [source, context.summary, context.excerpt]
        .filter(Boolean)
        .join("\n\n");
      const quoted = reference
        .split("\n")
        .map((line) => "> " + line)
        .join("\n");
      const draft = [
        objective,
        heading,
        quoted,
        context.truncated ? t("artifacts.learning.truncated") : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      writeInputDraft(result.agent_id, result.thread_id, draft);
      navigate(
        "/chat/" +
          encodeURIComponent(result.agent_id) +
          "/" +
          encodeURIComponent(result.thread_id),
        { state: { prefillInput: draft } },
      );
    } catch {
      setDeriveFailed(true);
    } finally {
      setDeriving(false);
    }
  }

  const options = versions.map((version) => ({
    value: String(version.revision),
    label: t("artifacts.learning.versionDate", {
      revision: version.revision,
      date: formatServerDateTime(version.created_at, timezone),
    }),
  }));
  const bases = options.filter((item) => item.value !== selection);
  if (artifact.parent_version != null && artifact.parent_id) {
    bases.push({
      value: parentKey,
      label: t("artifacts.learning.parentVersion", {
        revision: artifact.parent_version,
      }),
    });
  }

  return (
    <>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        {artifact.parent_id && (
          <Link to={"/artifacts/" + encodeURIComponent(artifact.parent_id)}>
            {t("artifacts.learning.parent")}
          </Link>
        )}
        {loading ? (
          <Spin />
        ) : versionFailed ? (
          <Alert
            type="error"
            showIcon
            message={t("artifacts.learning.versionFailed")}
          />
        ) : versions.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("artifacts.learning.noVersions")}
          />
        ) : (
          <Space wrap>
            <Select
              aria-label={t("artifacts.learning.selected")}
              value={selection}
              options={options}
              onChange={(value) => {
                setSelection(value);
                if (value === base) setBase(undefined);
              }}
            />
            {bases.length > 0 && (
              <Select
                aria-label={t("artifacts.learning.compareWith")}
                placeholder={t("artifacts.learning.compareWith")}
                value={base}
                onChange={setBase}
                allowClear
                options={bases}
              />
            )}
          </Space>
        )}
        <Button
          type="primary"
          disabled={loading || versionFailed}
          onClick={() => {
            requestId.current = Array.from(
              crypto.getRandomValues(new Uint8Array(16)),
              (byte) => byte.toString(16).padStart(2, "0"),
            ).join("");
            setDeriveFailed(false);
            setDeriveOpen(true);
          }}
        >
          {t("artifacts.learning.derive")}
        </Button>
        {comparing && <Spin />}
        {compareFailed && (
          <Alert
            type="warning"
            showIcon
            message={t("artifacts.learning.compareFailed")}
          />
        )}
        {comparison && (
          <div className={styles.versionComparison}>
            {comparison.map((version, index) => (
              <section key={version.artifact_id + ":" + version.revision}>
                <Typography.Text strong>
                  {t(
                    version.artifact_id === id
                      ? "artifacts.learning.version"
                      : "artifacts.learning.parentVersion",
                    {
                      revision: version.revision,
                    },
                  )}
                </Typography.Text>
                {version.truncated && (
                  <Tag>{t("artifacts.learning.truncated")}</Tag>
                )}
                <pre>
                  {changedText(
                    versionText(version),
                    versionText(comparison[index === 0 ? 1 : 0]),
                  )}
                </pre>
              </section>
            ))}
          </div>
        )}
      </Space>
      <Modal
        title={t("artifacts.learning.derive")}
        open={deriveOpen}
        okText={t("artifacts.learning.openDraft")}
        confirmLoading={deriving}
        onOk={() => void derive()}
        onCancel={() => {
          if (!deriving) setDeriveOpen(false);
        }}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text>{t("artifacts.learning.draftHelp")}</Typography.Text>
          <Input.TextArea
            aria-label={t("artifacts.learning.task")}
            placeholder={t("artifacts.learning.defaultTask")}
            value={task}
            maxLength={1000}
            rows={3}
            disabled={deriving}
            onChange={(event) => setTask(event.target.value)}
          />
          {deriveFailed && (
            <Alert
              type="error"
              showIcon
              message={t("artifacts.learning.deriveFailed")}
            />
          )}
        </Space>
      </Modal>
    </>
  );
}
