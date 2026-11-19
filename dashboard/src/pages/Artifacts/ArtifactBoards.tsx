import { Alert, Button, Dropdown, Input, Modal, Space, Typography } from "antd";
import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type Artifact,
  type ArtifactBoard,
  createArtifactBoard,
  deleteArtifactBoard,
  renameArtifactBoard,
  saveToArtifactBoard,
  removeFromArtifactBoard,
} from "../../api/modules/octopArtifacts";
import styles from "./index.module.less";

export const artifactDragType = "application/x-octop-artifact";

export function BoardToolbar({
  boards,
  selected,
  onSelect,
  onChanged,
}: {
  boards: ArtifactBoard[];
  selected?: string;
  onSelect: (id?: string) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<
    { kind: "create" } | { kind: "rename" | "delete"; board: ArtifactBoard }
  >();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [hovered, setHovered] = useState<string>();
  async function perform(operation: () => Promise<unknown>) {
    setBusy(true);
    setFailed(false);
    setNotice("");
    try {
      await operation();
      onChanged();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label={t("artifacts.boards.title")} className={styles.boards}>
      <Space wrap>
        <Button
          type={!selected ? "primary" : "text"}
          aria-pressed={!selected}
          onClick={() => onSelect()}
        >
          {t("artifacts.back")}
        </Button>
        {boards.map((board) => (
          <Space.Compact key={board.board_id}>
            <Button
              type={selected === board.board_id ? "primary" : "default"}
              aria-pressed={selected === board.board_id}
              className={
                hovered === board.board_id ? styles.dropTarget : undefined
              }
              disabled={busy}
              onClick={() => onSelect(board.board_id)}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(artifactDragType)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setHovered(board.board_id);
                }
              }}
              onDragLeave={() => setHovered(undefined)}
              onDrop={(event) => {
                event.preventDefault();
                setHovered(undefined);
                const id = event.dataTransfer.getData(artifactDragType);
                if (id && !busy)
                  void perform(async () => {
                    await saveToArtifactBoard(board.board_id, id);
                    setNotice(
                      t("artifacts.boards.saved", { name: board.name }),
                    );
                  });
              }}
            >
              {board.name} · {board.total}
            </Button>
            <Dropdown
              trigger={["click"]}
              disabled={busy}
              menu={{
                items: [
                  { key: "rename", label: t("artifacts.boards.rename") },
                  {
                    key: "delete",
                    label: t("artifacts.boards.delete"),
                    danger: true,
                  },
                ],
                onClick: ({ key }) => {
                  setFailed(false);
                  if (key === "rename") setName(board.name);
                  setEditing({
                    kind: key === "rename" ? "rename" : "delete",
                    board,
                  });
                },
              }}
            >
              <Button
                type={selected === board.board_id ? "primary" : "default"}
                icon={<Ellipsis size={16} />}
                aria-label={board.name + " · " + t("artifacts.moreActions")}
                disabled={busy}
              />
            </Dropdown>
          </Space.Compact>
        ))}
        <Button
          disabled={busy}
          onClick={() => {
            setName("");
            setFailed(false);
            setEditing({ kind: "create" });
          }}
        >
          {t("artifacts.boards.create")}
        </Button>
      </Space>
      {notice && <Typography.Text role="status">{notice}</Typography.Text>}
      {failed && !editing && (
        <Alert type="error" message={t("artifacts.actionFailed")} />
      )}
      <Modal
        title={
          editing?.kind === "delete"
            ? t("artifacts.boards.delete") + " · " + editing.board.name
            : t("artifacts.boards." + (editing?.kind ?? "create"))
        }
        open={!!editing}
        confirmLoading={busy}
        okText={
          editing?.kind === "delete" ? t("artifacts.boards.delete") : undefined
        }
        okButtonProps={{
          danger: editing?.kind === "delete",
          disabled: editing?.kind !== "delete" && !name.trim(),
        }}
        onCancel={() => {
          if (!busy) setEditing(undefined);
        }}
        onOk={() =>
          void perform(async () => {
            if (editing?.kind === "delete") {
              await deleteArtifactBoard(editing.board.board_id);
              if (editing.board.board_id === selected) onSelect();
            } else if (editing?.kind === "rename") {
              await renameArtifactBoard(editing.board.board_id, name.trim());
            } else if (editing?.kind === "create") {
              const board = await createArtifactBoard(name.trim());
              onSelect(board.board_id);
            }
            setEditing(undefined);
          })
        }
      >
        {editing?.kind === "delete" ? (
          <Typography.Paragraph>
            {t("artifacts.boards.deleteHelp")}
          </Typography.Paragraph>
        ) : (
          <Input
            aria-label={t("artifacts.boards.name")}
            placeholder={t("artifacts.boards.name")}
            maxLength={80}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        )}
        {failed && <Alert type="error" message={t("artifacts.actionFailed")} />}
      </Modal>
    </section>
  );
}

export function BoardActions({
  artifact,
  boards,
  selected,
  onChanged,
}: {
  artifact: Artifact;
  boards: ArtifactBoard[];
  selected?: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [createdBoard, setCreatedBoard] = useState<ArtifactBoard>();
  async function perform(operation: () => Promise<void>) {
    setBusy(true);
    setFailed(false);
    setSaved("");
    try {
      await operation();
      onChanged();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.boardActions}>
      <Space wrap size="small">
        {boards.length ? (
          <Dropdown
            trigger={["click"]}
            disabled={busy || !boards.length}
            menu={{
              items: boards.map((board) => ({
                key: board.board_id,
                label: board.name,
              })),
              onClick: ({ key }) =>
                void perform(async () => {
                  await saveToArtifactBoard(key, artifact.artifact_id);
                  setSaved(
                    t("artifacts.boards.saved", {
                      name: boards.find((board) => board.board_id === key)
                        ?.name,
                    }),
                  );
                }),
            }}
          >
            <Button loading={busy}>{t("artifacts.boards.save")}</Button>
          </Dropdown>
        ) : (
          <Button
            onClick={() => {
              setFailed(false);
              setName("");
              setCreating(true);
            }}
          >
            {t("artifacts.boards.createAndSave")}
          </Button>
        )}
        {selected && (
          <>
            <Button
              size="small"
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  saveToArtifactBoard(
                    selected,
                    artifact.artifact_id,
                    !artifact.pinned,
                  ),
                )
              }
            >
              {t(
                artifact.pinned
                  ? "artifacts.boards.unpin"
                  : "artifacts.boards.pin",
              )}
            </Button>
            <Button
              size="small"
              type="text"
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  removeFromArtifactBoard(selected, artifact.artifact_id),
                )
              }
            >
              {t("artifacts.boards.remove")}
            </Button>
          </>
        )}
      </Space>
      {saved && (
        <Typography.Text role="status" type="secondary">
          {saved}
        </Typography.Text>
      )}
      {failed && !creating && (
        <Alert type="error" message={t("artifacts.actionFailed")} />
      )}
      <Modal
        title={t("artifacts.boards.createAndSave")}
        open={creating}
        confirmLoading={busy}
        okText={t("artifacts.boards.save")}
        okButtonProps={{ disabled: !name.trim() }}
        onCancel={() => {
          if (busy) return;
          if (createdBoard) onChanged();
          setCreatedBoard(undefined);
          setCreating(false);
          setFailed(false);
        }}
        onOk={() =>
          void perform(async () => {
            const board =
              createdBoard ?? (await createArtifactBoard(name.trim()));
            setCreatedBoard(board);
            await saveToArtifactBoard(board.board_id, artifact.artifact_id);
            setSaved(t("artifacts.boards.saved", { name: board.name }));
            setCreatedBoard(undefined);
            setCreating(false);
          })
        }
      >
        <Input
          aria-label={t("artifacts.boards.name")}
          placeholder={t("artifacts.boards.name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy || !!createdBoard}
          maxLength={80}
        />
        {failed && <Alert type="error" message={t("artifacts.actionFailed")} />}
      </Modal>
    </div>
  );
}
