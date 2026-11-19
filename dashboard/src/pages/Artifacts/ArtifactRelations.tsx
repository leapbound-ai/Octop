import {
  Alert,
  Button,
  Collapse,
  Empty,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import {
  type Artifact,
  type ArtifactDetail,
  type ArtifactGraph,
  addArtifactReference,
  getArtifactGraph,
  listArtifacts,
  removeArtifactReference,
} from "../../api/modules/octopArtifacts";
import styles from "./index.module.less";

export default function ArtifactRelations({
  artifact,
}: {
  artifact: ArtifactDetail;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [graph, setGraph] = useState<ArtifactGraph>();
  const [failed, setFailed] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Artifact[]>([]);
  const [target, setTarget] = useState<string>();
  const id = artifact.artifact_id;
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    void getArtifactGraph(id, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setGraph(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [id, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setSearching(true);
    setSearchFailed(false);
    const timer = setTimeout(() => {
      void listArtifacts(
        new URLSearchParams({ q: query, page_size: "50" }),
        controller.signal,
      )
        .then((value) => {
          if (!controller.signal.aborted)
            setCandidates(
              value.items.filter((item) => item.artifact_id !== id),
            );
        })
        .catch(() => {
          if (!controller.signal.aborted) setSearchFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, query]);
  async function change(operation: () => Promise<void>) {
    setBusy(true);
    setActionFailed(false);
    try {
      await operation();
      setTarget(undefined);
      setRevision((value) => value + 1);
    } catch {
      setActionFailed(true);
    } finally {
      setBusy(false);
    }
  }
  const edges = graph?.edges ?? [];
  const incoming = edges.filter((edge) => edge.target_id === id);
  const outgoing = edges.filter((edge) => edge.source_id === id);
  const height = Math.max(
    200,
    Math.max(incoming.length, outgoing.length) * 74 + 40,
  );
  const path = (nodeId: string) => "/artifacts/" + encodeURIComponent(nodeId);
  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space wrap>
        <Select
          showSearch
          filterOption={false}
          searchValue={query}
          onSearch={setQuery}
          value={target}
          onChange={setTarget}
          allowClear
          loading={searching}
          disabled={busy}
          className={styles.referenceSelect}
          aria-label={t("artifacts.relations.search")}
          placeholder={t("artifacts.relations.search")}
          options={candidates
            .filter(
              (item) =>
                !outgoing.some(
                  (edge) =>
                    edge.kind === "reference" &&
                    edge.target_id === item.artifact_id,
                ),
            )
            .map((item) => ({ value: item.artifact_id, label: item.title }))}
        />
        <Button
          disabled={!target}
          loading={busy}
          onClick={() => {
            if (target) void change(() => addArtifactReference(id, target));
          }}
        >
          {t("artifacts.relations.add")}
        </Button>
      </Space>
      {(actionFailed || searchFailed) && (
        <Alert type="error" message={t("artifacts.actionFailed")} />
      )}
      {failed ? (
        <Alert
          type="error"
          message={t("artifacts.loadFailed")}
          action={
            <Button onClick={() => setRevision((value) => value + 1)}>
              {t("artifacts.retry")}
            </Button>
          }
        />
      ) : !graph ? (
        <Spin />
      ) : !edges.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("artifacts.relations.empty")}
        />
      ) : (
        <>
          {[
            { key: "outgoing", edges: outgoing },
            { key: "incoming", edges: incoming },
          ].map(
            (group) =>
              group.edges.length > 0 && (
                <section key={group.key} className={styles.relationList}>
                  <Typography.Text strong>
                    {t("artifacts.relations." + group.key)}
                  </Typography.Text>
                  {group.edges.map((edge) => {
                    const isOutgoing = group.key === "outgoing";
                    return (
                      <div key={edge.source_id + edge.target_id + edge.kind}>
                        <Tag>{t("artifacts.relations." + edge.kind)}</Tag>
                        <Link
                          to={path(
                            isOutgoing ? edge.target_id : edge.source_id,
                          )}
                        >
                          {isOutgoing ? edge.target_title : edge.source_title}
                        </Link>
                        {edge.kind === "reference" && (
                          <Button
                            size="small"
                            type="text"
                            disabled={busy}
                            onClick={() =>
                              void change(() =>
                                removeArtifactReference(
                                  edge.source_id,
                                  edge.target_id,
                                ),
                              )
                            }
                          >
                            {t("artifacts.relations.remove")}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </section>
              ),
          )}
          <Collapse
            items={[
              {
                key: "graph",
                label: t("artifacts.relations.showGraph"),
                children: (
                  <>
                    {" "}
                    <Typography.Text type="secondary">
                      {t("artifacts.relations.help")}
                    </Typography.Text>
                    <div className={styles.graph}>
                      <svg
                        viewBox={`0 0 900 ${height}`}
                        style={{ height }}
                        role="group"
                        aria-label={t("artifacts.relations.title")}
                      >
                        <defs>
                          <marker
                            id="artifact-arrow"
                            viewBox="0 0 10 10"
                            refX="9"
                            refY="5"
                            markerWidth="6"
                            markerHeight="6"
                            orient="auto-start-reverse"
                          >
                            <path
                              d="M 0 0 L 10 5 L 0 10 z"
                              fill="currentColor"
                            />
                          </marker>
                        </defs>
                        {[incoming, outgoing].map((group, column) =>
                          group.map((edge, index) => {
                            const other =
                              column === 0 ? edge.source_id : edge.target_id;
                            const title =
                              column === 0
                                ? edge.source_title
                                : edge.target_title;
                            const y = 40 + index * 74;
                            const x = column === 0 ? 10 : 660;
                            const line =
                              column === 0
                                ? `M 250 ${y + 20} C 290 ${y + 20}, 290 ${
                                    height / 2
                                  }, 330 ${height / 2}`
                                : `M 570 ${height / 2} C 610 ${
                                    height / 2
                                  }, 610 ${y + 20}, 650 ${y + 20}`;
                            return (
                              <g
                                key={
                                  edge.source_id + edge.target_id + edge.kind
                                }
                              >
                                <path
                                  d={line}
                                  className={styles.graphEdge}
                                  strokeDasharray={
                                    edge.kind === "derivation"
                                      ? "5 4"
                                      : undefined
                                  }
                                  markerEnd="url(#artifact-arrow)"
                                />
                                <a
                                  href={path(other)}
                                  onClick={(event) => {
                                    if (
                                      !event.ctrlKey &&
                                      !event.metaKey &&
                                      !event.shiftKey &&
                                      event.button === 0
                                    ) {
                                      event.preventDefault();
                                      navigate(path(other));
                                    }
                                  }}
                                >
                                  <title>{title}</title>
                                  <rect
                                    x={x}
                                    y={y}
                                    width="230"
                                    height="46"
                                    rx="6"
                                  />
                                  <text x={x + 12} y={y + 20}>
                                    {title.length > 16
                                      ? title.slice(0, 16) + "…"
                                      : title}
                                  </text>
                                  <text
                                    x={x + 12}
                                    y={y + 37}
                                    className={styles.edgeLabel}
                                  >
                                    {t("artifacts.relations." + edge.kind)}
                                  </text>
                                </a>
                              </g>
                            );
                          }),
                        )}
                        <rect
                          x="330"
                          y={height / 2 - 24}
                          width="240"
                          height="48"
                          rx="6"
                          className={styles.currentNode}
                        />
                        <text x="342" y={height / 2 + 5}>
                          <title>{artifact.title}</title>
                          {artifact.title.length > 16
                            ? artifact.title.slice(0, 16) + "…"
                            : artifact.title}
                        </text>
                      </svg>
                    </div>
                  </>
                ),
              },
            ]}
          />
          {graph.truncated && (
            <Alert type="info" message={t("artifacts.relations.truncated")} />
          )}
        </>
      )}
    </Space>
  );
}
