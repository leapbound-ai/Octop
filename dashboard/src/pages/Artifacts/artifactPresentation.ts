import { useTranslation } from "react-i18next";
import type { Artifact } from "../../api/modules/octopArtifacts";

// Match the sourcing plugin's generated snapshot. Edited summaries are shown verbatim.
const generatedBrief =
  /^(.+)：完成 (\d+)\/(\d+) 组搜索，(\d+) 个来源，(\d+) 个候选。\s*建议测 (\d+)、缓一缓 (\d+)、放弃 (\d+)、信息不足 (\d+)。\s*建议测不等于可以备货；实盘数据待验。(?:\s*(部分来源采集失败，详见报告。))?$/;

export function artifactDisplayTitle(artifact: Artifact) {
  const filename = artifact.path.split("/").at(-1);
  if (artifact.kind !== "sourcing-report" || artifact.title !== filename) {
    return artifact.title;
  }
  const generatedTitle = artifact.title.match(
    /^选品报告-(.+)-[a-f0-9]{8}\.md$/,
  );
  if (!generatedTitle) return artifact.title;
  return artifact.summary.match(generatedBrief)?.[1] ?? generatedTitle[1];
}

export function useArtifactSummary() {
  const { t } = useTranslation();
  return (artifact: Artifact) => {
    const match =
      artifact.kind === "sourcing-report" &&
      artifact.summary.match(generatedBrief);
    if (!match) return { headline: artifact.summary };
    const [
      ,
      ,
      completed,
      planned,
      sources,
      candidates,
      test,
      hold,
      drop,
      insufficient,
      partial,
    ] = match;
    const headline = t("artifacts.sourcing.result", { candidates, test, hold });
    const remaining =
      Number(drop) || Number(insufficient)
        ? t("artifacts.sourcing.remaining", { drop, insufficient })
        : "";
    const evidence = t("artifacts.sourcing.coverage", {
      completed,
      planned,
      sources,
    });
    const caution = t("artifacts.sourcing.stockCheck");
    return {
      headline: [headline, remaining].filter(Boolean).join(" "),
      detail: [evidence, caution, partial && t("artifacts.sourcing.partial")]
        .filter(Boolean)
        .join(" "),
    };
  };
}
