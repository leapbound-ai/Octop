import { Alert } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type Artifact,
  readArtifactFile,
} from "../../api/modules/octopArtifacts";
import FileViewer from "../Agent/Workspace/components/FileViewer";
import { getDocKind } from "../Agent/Workspace/utils/docKind";
import { isProbablyText } from "../Agent/Workspace/utils/fileKind";
import { getMediaKind } from "../Agent/Workspace/utils/mediaKind";

export default function FileArtifact({ artifact }: { artifact: Artifact }) {
  const { t } = useTranslation();
  const isText =
    !getDocKind(artifact.path) &&
    !getMediaKind(artifact.path) &&
    isProbablyText(artifact.path);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(isText);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isText) return;
    const controller = new AbortController();
    void readArtifactFile(artifact, controller.signal)
      .then((file) => {
        if (!controller.signal.aborted) setValue(file.content);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [artifact, isText]);

  if (failed)
    return (
      <Alert type="warning" showIcon message={t("artifacts.previewFailed")} />
    );

  return (
    <FileViewer
      agentId={artifact.agent_id}
      path={artifact.path}
      fromWorkspace
      editMode={false}
      value={value}
      onChange={() => {}}
      fileLoading={loading}
    />
  );
}
