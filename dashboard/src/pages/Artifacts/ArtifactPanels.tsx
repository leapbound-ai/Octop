import {
  Button,
  Dropdown,
  Descriptions,
  Drawer,
  Space,
  Typography,
} from "antd";
import { Ellipsis } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ArtifactDetail,
  type ArtifactStatus,
} from "../../api/modules/octopArtifacts";
import ArtifactFeedback from "./ArtifactFeedback";
import ArtifactRelations from "./ArtifactRelations";
import ArtifactLearning from "./ArtifactLearning";
import { useServerTimezone } from "../../hooks/useServerTimezone";
import { formatServerDateTime } from "../../utils/formatMessageTime";
import styles from "./index.module.less";

type Panel = "relations" | "feedback" | "learning" | "properties";

export default function ArtifactPanels({
  artifact,
  agentName,
  actions,
  busy,
  onEdit,
  onStatus,
}: {
  artifact: ArtifactDetail;
  agentName?: string;
  actions: ReactNode;
  busy: boolean;
  onEdit: () => void;
  onStatus: (status: ArtifactStatus) => void;
}) {
  const { t } = useTranslation();
  const timezone = useServerTimezone();
  const [panel, setPanel] = useState<Panel>();
  const labels = {
    relations: t("artifacts.relations.title"),
    feedback: t("artifacts.feedback.title"),
    learning: t("artifacts.learning.title"),
    properties: t("artifacts.properties"),
  };

  return (
    <>
      <Space wrap className={styles.detailActions}>
        {actions}
        <Button onClick={() => setPanel("relations")}>
          {labels.relations}
        </Button>
        <Button onClick={() => setPanel("feedback")}>{labels.feedback}</Button>
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              { key: "learning", label: labels.learning },
              { key: "properties", label: labels.properties },
              { type: "divider" },
              { key: "edit", label: t("artifacts.annotate"), disabled: busy },
              {
                key: "status",
                label: t("artifacts.statusLabel"),
                children: (["active", "archived", "ignored"] as const).map(
                  (status) => ({
                    key: status,
                    label: t("artifacts.status." + status),
                    disabled: busy || artifact.status === status,
                  }),
                ),
              },
            ],
            onClick: ({ key }) => {
              switch (key) {
                case "learning":
                case "properties":
                  setPanel(key);
                  break;
                case "edit":
                  onEdit();
                  break;
                case "active":
                case "archived":
                case "ignored":
                  onStatus(key);
                  break;
              }
            },
          }}
        >
          <Button
            icon={<Ellipsis size={18} />}
            aria-label={t("artifacts.moreActions")}
          />
        </Dropdown>
      </Space>
      <Drawer
        title={panel && labels[panel]}
        placement="right"
        width="min(520px, 100vw)"
        open={!!panel}
        onClose={() => setPanel(undefined)}
        destroyOnClose
      >
        {panel === "relations" && <ArtifactRelations artifact={artifact} />}
        {panel === "feedback" && <ArtifactFeedback artifact={artifact} />}
        {panel === "learning" && <ArtifactLearning artifact={artifact} />}
        {panel === "properties" && (
          <Descriptions
            size="small"
            column={1}
            className={styles.fileDetails}
            items={[
              {
                key: "filename",
                label: t("artifacts.filename"),
                children: artifact.path.split("/").at(-1),
              },
              {
                key: "created",
                label: t("artifacts.created"),
                children: formatServerDateTime(artifact.created_at, timezone),
              },
              {
                key: "agent",
                label: t("artifacts.agent"),
                children: agentName ?? artifact.agent_id,
              },
              {
                key: "path",
                label: t("artifacts.path"),
                children: (
                  <Typography.Text code>{artifact.path}</Typography.Text>
                ),
              },
            ]}
          />
        )}
      </Drawer>
    </>
  );
}
