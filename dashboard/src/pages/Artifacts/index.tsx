import {
  Alert,
  Button,
  Card,
  Dropdown,
  Empty,
  Form,
  Input,
  Pagination,
  Popover,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import {
  ArrowLeft,
  Ellipsis,
  FileText,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  type ArtifactBoard,
  listArtifactBoards,
  type Artifact,
  type ArtifactDetail,
  type ArtifactStatus,
  type CollectMode,
  annotateArtifact,
  changeArtifactStatus,
  downloadArtifactFile,
  getArtifact,
  getArtifactSettings,
  getArtifactStats,
  listArtifactAgents,
  listArtifacts,
  setArtifactSettings,
} from "../../api/modules/octopArtifacts";
import { useServerTimezone } from "../../hooks/useServerTimezone";
import PageShell from "../../layouts/PageShell";
import { formatServerDateTime } from "../../utils/formatMessageTime";
import { saveBlobAsFile } from "../../utils/saveBlobAsFile";
import { BoardActions, BoardToolbar, artifactDragType } from "./ArtifactBoards";
import ArtifactPanels from "./ArtifactPanels";
import FileArtifact from "./FileArtifact";
import SourcingReport from "./SourcingReport";
import {
  artifactDisplayTitle,
  useArtifactSummary,
} from "./artifactPresentation";
import styles from "./index.module.less";

const pageSize = 24;
const statuses: ArtifactStatus[] = ["active", "archived", "ignored"];

function conversationPath(artifact: Artifact) {
  return (
    "/chat/" +
    encodeURIComponent(artifact.agent_id) +
    "/" +
    encodeURIComponent(artifact.thread_id)
  );
}

function artifactPath(artifact: Artifact) {
  return "/artifacts/" + encodeURIComponent(artifact.artifact_id);
}

function artifactType(artifact: Artifact) {
  return artifact.kind === "sourcing-report"
    ? "sourcing-report"
    : artifact.mime_kind;
}

function artifactTypeColor(artifact: Artifact) {
  return artifact.kind === "sourcing-report" ? "blue" : "default";
}

function artifactStatusColor(status: ArtifactStatus) {
  return status === "active"
    ? "success"
    : status === "archived"
    ? "warning"
    : "error";
}

export default function ArtifactsPage() {
  const { artifactId } = useParams();
  return artifactId ? (
    <Detail key={artifactId} id={artifactId} />
  ) : (
    <ArtifactList />
  );
}

function ArtifactList() {
  const { t } = useTranslation();
  const timezone = useServerTimezone();
  const [search, setSearch] = useSearchParams();
  const selectedBoard = search.get("board_id") ?? undefined;
  const [boards, setBoards] = useState<ArtifactBoard[]>([]);
  const status = search.get("status") ?? "active";
  const page = Math.max(
    1,
    Math.min(1000000, Number.parseInt(search.get("page") ?? "1", 10) || 1),
  );
  const [items, setItems] = useState<Artifact[]>([]);
  const [total, setTotal] = useState(0);
  const [agents, setAgents] = useState<{ agent_id: string; name: string }[]>(
    [],
  );
  const [stats, setStats] = useState<{
    total: number;
    this_week: number;
    agents: number;
  }>();
  const [collectMode, setCollectMode] = useState<CollectMode>();
  const [savingMode, setSavingMode] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [lastHidden, setLastHidden] = useState<Artifact>();
  const summarize = useArtifactSummary();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadFailed(false);
    const filters = new URLSearchParams(search);
    filters.set("page", String(page));
    filters.set("page_size", String(pageSize));
    const days = Number(filters.get("days"));
    if (days === 7 || days === 30) {
      filters.set("from", String(Math.floor(Date.now() / 1000) - days * 86400));
    }
    filters.delete("days");
    void listArtifacts(filters, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(result.items);
        setTotal(result.total);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [search, page, revision]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      listArtifactBoards(controller.signal),
      listArtifactAgents(controller.signal),
      getArtifactStats(controller.signal),
      getArtifactSettings(controller.signal),
    ])
      .then(([boardList, agentList, counts, settings]) => {
        if (controller.signal.aborted) return;
        setBoards(boardList);
        setAgents(agentList);
        setStats(counts);
        setCollectMode((current) => current ?? settings.collect_mode);
      })
      .catch(() => {
        if (!controller.signal.aborted) setActionFailed(true);
      });
    return () => controller.abort();
  }, [revision]);

  function filter(key: string, value?: string) {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setSearch(next);
  }

  async function setListStatus(artifact: Artifact, nextStatus: ArtifactStatus) {
    setBusy(artifact.artifact_id);
    setActionFailed(false);
    try {
      await changeArtifactStatus(artifact.artifact_id, nextStatus);
      setLastHidden(nextStatus === "ignored" ? artifact : undefined);
      if (
        items.length === 1 &&
        items[0].artifact_id === artifact.artifact_id &&
        page > 1
      ) {
        filter("page", String(page - 1));
      }
      setRevision((current) => current + 1);
    } catch {
      setActionFailed(true);
    } finally {
      setBusy(undefined);
    }
  }

  async function updateCollection(mode: CollectMode) {
    setSavingMode(true);
    setActionFailed(false);
    try {
      setCollectMode((await setArtifactSettings(mode)).collect_mode);
    } catch {
      setActionFailed(true);
    } finally {
      setSavingMode(false);
    }
  }

  return (
    <PageShell
      title={t("nav.artifacts")}
      actions={
        <Popover
          trigger="click"
          placement="bottomRight"
          title={t("artifacts.collectMode")}
          content={
            <Select
              aria-label={t("artifacts.collectMode")}
              value={collectMode}
              disabled={savingMode || !collectMode}
              onChange={(mode) => void updateCollection(mode)}
              options={["documents", "all"].map((value) => ({
                value,
                label: t("artifacts." + value),
              }))}
            />
          }
        >
          <Button
            icon={<Settings2 size={16} />}
            aria-label={t("artifacts.settings")}
          />
        </Popover>
      }
    >
      <div className={styles.content}>
        {stats && (
          <div className={styles.stats}>
            {(["total", "this_week", "agents"] as const).map((key) => (
              <span key={key}>
                <strong>{stats[key]}</strong> {t("artifacts.stats." + key)}
              </span>
            ))}
          </div>
        )}
        <BoardToolbar
          boards={boards}
          selected={selectedBoard}
          onSelect={(value) => filter("board_id", value)}
          onChanged={() => setRevision((value) => value + 1)}
        />
        <Space wrap className={styles.filters}>
          <Input.Search
            key={search.get("q")}
            defaultValue={search.get("q") ?? ""}
            allowClear
            maxLength={300}
            aria-label={t("artifacts.search")}
            placeholder={t("artifacts.search")}
            onSearch={(value) => filter("q", value.trim())}
          />
          <Select
            aria-label={t("artifacts.agent")}
            placeholder={t("artifacts.agent")}
            allowClear
            value={search.get("agent_id") ?? undefined}
            onChange={(value) => filter("agent_id", value)}
            options={agents.map((agent) => ({
              value: agent.agent_id,
              label: agent.name,
            }))}
          />
          <Select
            aria-label={t("artifacts.kind")}
            placeholder={t("artifacts.kind")}
            allowClear
            value={search.get("kind") ?? undefined}
            onChange={(value) => filter("kind", value)}
            options={["file", "sourcing-report"].map((value) => ({
              value,
              label: t("artifacts.types." + value),
            }))}
          />
          <Select
            aria-label={t("artifacts.statusLabel")}
            popupMatchSelectWidth={false}
            value={status}
            onChange={(value) =>
              filter("status", value === "active" ? undefined : value)
            }
            options={statuses.map((value) => ({
              value,
              label: t("artifacts.status." + value),
            }))}
          />
          <Popover
            trigger="click"
            placement="bottomLeft"
            title={t("artifacts.moreFilters")}
            content={
              <Space direction="vertical">
                {" "}
                <Input
                  key={search.get("tag")}
                  defaultValue={search.get("tag") ?? ""}
                  allowClear
                  maxLength={80}
                  aria-label={t("artifacts.tagFilter")}
                  placeholder={t("artifacts.tagFilter")}
                  onClear={() => filter("tag")}
                  onPressEnter={(event) =>
                    filter("tag", event.currentTarget.value.trim())
                  }
                />
                <Select
                  aria-label={t("artifacts.time")}
                  placeholder={t("artifacts.time")}
                  allowClear
                  value={search.get("days") ?? undefined}
                  onChange={(value) => filter("days", value)}
                  options={["7", "30"].map((value) => ({
                    value,
                    label: t("artifacts.days", { count: Number(value) }),
                  }))}
                />
              </Space>
            }
          >
            <Button
              icon={<SlidersHorizontal size={16} />}
              type={
                search.has("tag") || search.has("days") ? "primary" : "default"
              }
            >
              {t("artifacts.moreFilters")}
            </Button>
          </Popover>
        </Space>
        {actionFailed && (
          <Alert type="error" showIcon message={t("artifacts.actionFailed")} />
        )}
        {lastHidden && (
          <Alert
            type="success"
            showIcon
            message={t("artifacts.hiddenNotice", {
              title: artifactDisplayTitle(lastHidden),
            })}
            action={
              <Button
                size="small"
                disabled={!!busy}
                onClick={() =>
                  void setListStatus(
                    { ...lastHidden, status: "ignored" },
                    lastHidden.status,
                  )
                }
              >
                {t("artifacts.undo")}
              </Button>
            }
            closable
            onClose={() => setLastHidden(undefined)}
          />
        )}
        {loadFailed ? (
          <Alert
            type="error"
            showIcon
            message={t("artifacts.loadFailed")}
            action={
              <Button
                size="small"
                onClick={() => setRevision((current) => current + 1)}
              >
                {t("artifacts.retry")}
              </Button>
            }
          />
        ) : loading ? (
          <Spin />
        ) : items.length === 0 ? (
          <Empty
            description={t(
              search.size ? "artifacts.noMatches" : "artifacts.empty",
            )}
          />
        ) : (
          <ul className={styles.artifactList}>
            {items.map((artifact) => {
              const summary = summarize(artifact);
              const displayTitle = artifactDisplayTitle(artifact);
              const tags = artifact.tags.filter((tag) => tag !== displayTitle);
              return (
                <li
                  key={artifact.artifact_id}
                  className={styles.artifactRow}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      artifactDragType,
                      artifact.artifact_id,
                    );
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <span className={styles.fileIcon} aria-hidden="true">
                    <FileText size={20} />
                  </span>
                  <div className={styles.rowContent}>
                    <Space wrap size={[8, 4]}>
                      <Link
                        className={styles.artifactTitle}
                        to={{
                          pathname: artifactPath(artifact),
                          search: search.toString(),
                        }}
                      >
                        {displayTitle}
                      </Link>
                      <Tag color={artifactTypeColor(artifact)}>
                        {t("artifacts.types." + artifactType(artifact))}
                      </Tag>
                    </Space>
                    {summary.headline && (
                      <Typography.Paragraph
                        className={styles.rowSummary}
                        ellipsis={{ rows: 2 }}
                      >
                        {summary.headline}
                      </Typography.Paragraph>
                    )}
                    <div className={styles.rowMeta}>
                      {agents.find(
                        (agent) => agent.agent_id === artifact.agent_id,
                      )?.name ?? artifact.agent_id}
                      {" · "}
                      {formatServerDateTime(artifact.created_at, timezone)}
                    </div>
                    {tags.length > 0 && (
                      <div className={styles.rowTags}>
                        {tags.map((tag) => (
                          <Tag key={tag}>{tag}</Tag>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className={styles.rowActions}>
                    <Link to={conversationPath(artifact)}>
                      {t("artifacts.conversation")}
                    </Link>
                    <Dropdown
                      trigger={["click"]}
                      disabled={!!busy}
                      menu={{
                        items: [
                          {
                            key: "status",
                            label: t(
                              artifact.status === "ignored"
                                ? "artifacts.restore"
                                : "artifacts.ignore",
                            ),
                          },
                        ],
                        onClick: () =>
                          void setListStatus(
                            artifact,
                            artifact.status === "ignored"
                              ? "active"
                              : "ignored",
                          ),
                      }}
                    >
                      <Button
                        type="text"
                        icon={<Ellipsis size={18} />}
                        aria-label={t("artifacts.moreActions")}
                        loading={busy === artifact.artifact_id}
                      />
                    </Dropdown>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!loading && !loadFailed && total > pageSize && (
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger={false}
            onChange={(value) => filter("page", String(value))}
          />
        )}
      </div>
    </PageShell>
  );
}

const renderers = { "sourcing-report": SourcingReport };

function Detail({ id }: { id: string }) {
  const { t } = useTranslation();
  const timezone = useServerTimezone();
  const [artifact, setArtifact] = useState<ArtifactDetail>();
  const [search] = useSearchParams();
  const listPath = { pathname: "/artifacts", search: search.toString() };
  const summarize = useArtifactSummary();
  const [agentName, setAgentName] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    const agentId = artifact?.agent_id;
    if (agentId) {
      void listArtifactAgents(controller.signal)
        .then((agents) => {
          if (!controller.signal.aborted)
            setAgentName(
              agents.find((agent) => agent.agent_id === agentId)?.name,
            );
        })
        .catch(() => {});
    }
    return () => controller.abort();
  }, [artifact?.agent_id]);
  const [boards, setBoards] = useState<ArtifactBoard[]>();
  const [boardRevision, setBoardRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void listArtifactBoards(controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setBoards(rows);
      })
      .catch(() => {
        if (!controller.signal.aborted) setActionFailed(true);
      });
    return () => controller.abort();
  }, [boardRevision]);
  const [failed, setFailed] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void getArtifact(id, controller.signal)
      .then((item) => {
        if (!controller.signal.aborted) setArtifact(item);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [id]);

  async function update(operation: () => Promise<ArtifactDetail>) {
    setBusy(true);
    setActionFailed(false);
    try {
      setArtifact(await operation());
      setEditing(false);
    } catch {
      setActionFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!artifact) return;
    setDownloadBusy(true);
    setActionFailed(false);
    try {
      const blob = await downloadArtifactFile(artifact);
      await saveBlobAsFile(
        blob,
        artifact.path.split("/").at(-1) ?? artifact.title,
      );
    } catch {
      setActionFailed(true);
    } finally {
      setDownloadBusy(false);
    }
  }

  if (!artifact) {
    return (
      <PageShell title={t("nav.artifacts")}>
        {failed ? (
          <Alert
            type="error"
            showIcon
            message={t("artifacts.detailFailed")}
            action={<Link to={listPath}>{t("artifacts.back")}</Link>}
          />
        ) : (
          <Spin />
        )}
      </PageShell>
    );
  }

  const Renderer =
    artifact.schema_version === 1
      ? renderers[artifact.kind as keyof typeof renderers]
      : undefined;

  const displayTitle = artifactDisplayTitle(artifact);
  const summary = summarize(artifact);

  return (
    <PageShell title={t("nav.artifacts")}>
      <div className={styles.content}>
        <Link to={listPath} className={styles.backLink}>
          <ArrowLeft size={16} /> {t("artifacts.back")}
        </Link>
        <header className={styles.detailHeader}>
          <div className={styles.detailIntro}>
            <h2>{displayTitle}</h2>
            <Space wrap size={[8, 4]}>
              <Tag color={artifactTypeColor(artifact)}>
                {t("artifacts.types." + artifactType(artifact))}
              </Tag>
              <Typography.Text type="secondary">
                {agentName ?? artifact.agent_id} ·{" "}
                {formatServerDateTime(artifact.created_at, timezone)}
              </Typography.Text>
              {artifact.status !== "active" && (
                <Tag color={artifactStatusColor(artifact.status)}>
                  {t("artifacts.status." + artifact.status)}
                </Tag>
              )}
              {artifact.tags
                .filter((tag) => tag !== displayTitle)
                .map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
            </Space>
          </div>
          <ArtifactPanels
            artifact={artifact}
            agentName={agentName}
            actions={
              <>
                <Link to={conversationPath(artifact)}>
                  {t("artifacts.conversation")}
                </Link>
                <Button loading={downloadBusy} onClick={() => void download()}>
                  {t("artifacts.download")}
                </Button>
                {boards && (
                  <BoardActions
                    artifact={artifact}
                    boards={boards}
                    onChanged={() => setBoardRevision((value) => value + 1)}
                  />
                )}
              </>
            }
            onEdit={() => setEditing(!editing)}
            busy={busy}
            onStatus={(status) =>
              void update(() => changeArtifactStatus(id, status))
            }
          />
        </header>
        {actionFailed && (
          <Alert type="error" showIcon message={t("artifacts.actionFailed")} />
        )}
        {editing && (
          <Card>
            <Form
              layout="vertical"
              initialValues={{
                title: artifact.title,
                summary: artifact.summary,
                tags: artifact.tags,
              }}
              onFinish={(
                values: Pick<Artifact, "title" | "summary" | "tags">,
              ) => {
                void update(() =>
                  annotateArtifact(id, {
                    ...values,
                    tags: [
                      ...new Set(
                        values.tags.map((tag) => tag.trim()).filter(Boolean),
                      ),
                    ],
                  }),
                );
              }}
            >
              <Form.Item
                name="title"
                label={t("artifacts.title")}
                rules={[{ required: true, whitespace: true }]}
              >
                <Input maxLength={300} />
              </Form.Item>
              <Form.Item name="summary" label={t("artifacts.summary")}>
                <Input.TextArea maxLength={4000} />
              </Form.Item>
              <Form.Item
                name="tags"
                label={t("artifacts.tags")}
                rules={[
                  {
                    validator: (_, tags: string[]) =>
                      tags.length <= 30 && tags.every((tag) => tag.length <= 80)
                        ? Promise.resolve()
                        : Promise.reject(new Error(t("artifacts.tagLimits"))),
                  },
                ]}
              >
                <Select mode="tags" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={busy}>
                {t("artifacts.save")}
              </Button>
            </Form>
          </Card>
        )}
        {summary.headline && (
          <section
            className={styles.summaryBlock}
            aria-label={t("artifacts.summary")}
          >
            <Typography.Text className={styles.summaryLabel}>
              {t("artifacts.summary")}
            </Typography.Text>
            <p>{summary.headline}</p>
            {summary.detail && (
              <p className={styles.summaryDetail}>{summary.detail}</p>
            )}
          </section>
        )}
        {Renderer ? (
          <Renderer payload={artifact.payload} />
        ) : (
          <Card className={styles.preview}>
            <FileArtifact artifact={artifact} />
          </Card>
        )}
      </div>
    </PageShell>
  );
}
