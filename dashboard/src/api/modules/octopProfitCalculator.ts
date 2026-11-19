import { request } from "../request";
import type {
  InputKey,
  Inputs,
  ProfitResult,
} from "../../utils/profitCalculator";

export type Source = "actual" | "public" | "seller" | "model" | "empty";
export interface BaselineField {
  value: string;
  source: Source;
  source_note: string;
  updated_at: number;
}
export type BaselinePayload = Partial<Record<InputKey, BaselineField>>;
export interface Baseline {
  version: number;
  payload: BaselinePayload;
  created_at: number;
}
export interface SnapshotSummary {
  snapshot_id: string;
  title: string;
  created_at: number;
  engine_version: string;
  baseline_version: number | null;
}
export interface Snapshot extends SnapshotSummary {
  inputs: Inputs;
  results: ProfitResult;
}

const base = "/profit-calculator";
export const getBaseline = (signal?: AbortSignal) =>
  request<Baseline | null>(base + "/baseline", { signal });
export const saveBaseline = (payload: BaselinePayload) =>
  request<Baseline>(base + "/baseline", {
    method: "PUT",
    body: JSON.stringify({ payload }),
  });
export const listBaselines = (before?: number) =>
  request<Baseline[]>(
    base + "/baseline/history" + (before ? "?before=" + before : ""),
  );
export const restoreBaseline = (version: number) =>
  request<Baseline>(base + "/baseline/rollback", {
    method: "POST",
    body: JSON.stringify({ version }),
  });
export const listSnapshots = (before?: string) =>
  request<SnapshotSummary[]>(
    base +
      "/snapshots" +
      (before ? "?before=" + encodeURIComponent(before) : ""),
  );
export const getSnapshot = (id: string) =>
  request<Snapshot>(base + "/snapshots/" + encodeURIComponent(id));
export const saveSnapshot = (
  body: Omit<Snapshot, "snapshot_id" | "created_at">,
) =>
  request<Snapshot>(base + "/snapshots", {
    method: "POST",
    body: JSON.stringify(body),
  });
export const deleteSnapshot = (id: string) =>
  request<void>(base + "/snapshots/" + encodeURIComponent(id), {
    method: "DELETE",
  });
