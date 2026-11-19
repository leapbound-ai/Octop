import { request, requestBlob } from "../request";

export type ArtifactStatus = "active" | "archived" | "ignored";
export type CollectMode = "documents" | "all";

export interface Artifact {
  artifact_id: string;
  pinned?: boolean;
  agent_id: string;
  thread_id: string;
  path: string;
  title: string;
  mime_kind: string;
  kind: string;
  schema_version: number;
  summary: string;
  tags: string[];
  status: ArtifactStatus;
  created_at: number;
  updated_at: number;
}

export interface ArtifactDetail extends Artifact {
  payload: Record<string, unknown>;
  parent_id: string;
  parent_version: number | null;
}

export interface ArtifactVersionInfo {
  artifact_id: string;
  revision: number;
  content_type: "text" | "json";
  truncated: boolean;
  created_at: number;
}

export interface ArtifactVersion extends ArtifactVersionInfo {
  content: string;
}

interface ArtifactDerivation {
  agent_id: string;
  thread_id: string;
  context: {
    artifact_id: string;
    title: string;
    summary: string;
    excerpt: string;
    truncated: boolean;
    revision: number | null;
  };
}

const endpoint = (id: string) => "/artifacts/" + encodeURIComponent(id);
const workspaceFile = (artifact: Artifact, operation: string) =>
  "/agents/" +
  encodeURIComponent(artifact.agent_id) +
  "/workspace/" +
  operation +
  "?from_workspace=true&path=" +
  encodeURIComponent(artifact.path);

export const listArtifacts = (params: URLSearchParams, signal: AbortSignal) =>
  request<{ items: Artifact[]; total: number }>("/artifacts?" + params, {
    signal,
  });
export const getArtifact = (id: string, signal: AbortSignal) =>
  request<ArtifactDetail>(endpoint(id), { signal });
export const listArtifactAgents = (signal: AbortSignal) =>
  request<{ agent_id: string; name: string }[]>("/artifacts/agents", {
    signal,
  });
export const getArtifactStats = (signal: AbortSignal) =>
  request<{ total: number; this_week: number; agents: number }>(
    "/artifacts/stats",
    { signal },
  );
export const getArtifactSettings = (signal: AbortSignal) =>
  request<{ collect_mode: CollectMode }>("/artifacts/settings", { signal });
export const setArtifactSettings = (collect_mode: CollectMode) =>
  request<{ collect_mode: CollectMode }>("/artifacts/settings", {
    method: "PUT",
    body: JSON.stringify({ collect_mode }),
  });
export const changeArtifactStatus = (id: string, status: ArtifactStatus) =>
  request<ArtifactDetail>(endpoint(id) + "/status", {
    method: "POST",
    body: JSON.stringify({ status }),
  });
export const annotateArtifact = (
  id: string,
  values: Pick<Artifact, "title" | "summary" | "tags">,
) =>
  request<ArtifactDetail>(endpoint(id), {
    method: "PATCH",
    body: JSON.stringify(values),
  });
export const listArtifactVersions = (id: string, signal: AbortSignal) =>
  request<ArtifactVersionInfo[]>(endpoint(id) + "/versions", { signal });
export const getArtifactVersion = (
  id: string,
  revision: number,
  signal: AbortSignal,
) =>
  request<ArtifactVersion>(endpoint(id) + "/versions/" + revision, { signal });
export const deriveArtifact = (
  id: string,
  focus: string,
  request_id: string,
  revision?: number,
) =>
  request<ArtifactDerivation>(endpoint(id) + "/derive", {
    method: "POST",
    body: JSON.stringify({ focus, request_id, revision }),
  });
export const readArtifactFile = (artifact: Artifact, signal: AbortSignal) =>
  request<{ content: string }>(workspaceFile(artifact, "file"), { signal });
export const downloadArtifactFile = (artifact: Artifact) =>
  requestBlob(workspaceFile(artifact, "download"));

export interface ArtifactBoard {
  board_id: string;
  name: string;
  total: number;
}
export interface ArtifactEdge {
  source_id: string;
  target_id: string;
  source_title: string;
  target_title: string;
  source_status: ArtifactStatus;
  target_status: ArtifactStatus;
  kind: "reference" | "derivation";
}
export interface ArtifactGraph {
  edges: ArtifactEdge[];
  truncated: boolean;
}
export interface ArtifactReview {
  artifact_id: string;
  rating: number;
  decision: "pending" | "adopted" | "rejected";
  use_for_preferences: boolean;
  revision: number | null;
  updated_at: number | null;
}
export interface ArtifactComment {
  comment_id: string;
  content: string;
  revision: number | null;
  created_at: number;
}
const boardEndpoint = (id: string) =>
  "/artifacts/boards/" + encodeURIComponent(id);
export const listArtifactBoards = (signal: AbortSignal) =>
  request<ArtifactBoard[]>("/artifacts/boards", { signal });
export const createArtifactBoard = (name: string) =>
  request<ArtifactBoard>("/artifacts/boards", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
export const renameArtifactBoard = (id: string, name: string) =>
  request<void>(boardEndpoint(id), {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
export const deleteArtifactBoard = (id: string) =>
  request<void>(boardEndpoint(id), { method: "DELETE" });
export const saveToArtifactBoard = (
  boardId: string,
  id: string,
  pinned?: boolean,
) =>
  request<void>(boardEndpoint(boardId) + "/items/" + encodeURIComponent(id), {
    method: "PUT",
    body: JSON.stringify({ pinned }),
  });
export const removeFromArtifactBoard = (boardId: string, id: string) =>
  request<void>(boardEndpoint(boardId) + "/items/" + encodeURIComponent(id), {
    method: "DELETE",
  });
export const getArtifactGraph = (id: string, signal: AbortSignal) =>
  request<ArtifactGraph>(endpoint(id) + "/graph", { signal });
export const addArtifactReference = (id: string, target_id: string) =>
  request<void>(endpoint(id) + "/references", {
    method: "POST",
    body: JSON.stringify({ target_id }),
  });
export const removeArtifactReference = (id: string, target: string) =>
  request<void>(endpoint(id) + "/references/" + encodeURIComponent(target), {
    method: "DELETE",
  });
export const getArtifactReview = (id: string, signal: AbortSignal) =>
  request<ArtifactReview>(endpoint(id) + "/review", { signal });
export const updateArtifactReview = (
  id: string,
  values: Partial<
    Pick<ArtifactReview, "rating" | "decision" | "use_for_preferences">
  >,
) =>
  request<ArtifactReview>(endpoint(id) + "/review", {
    method: "PATCH",
    body: JSON.stringify(values),
  });
export const listArtifactComments = (id: string, signal: AbortSignal) =>
  request<{ items: ArtifactComment[] }>(endpoint(id) + "/comments", { signal });
export const addArtifactComment = (
  id: string,
  comment_id: string,
  content: string,
) =>
  request<ArtifactComment>(endpoint(id) + "/comments", {
    method: "POST",
    body: JSON.stringify({ comment_id, content }),
  });
export const deleteArtifactComment = (id: string, comment_id: string) =>
  request<void>(endpoint(id) + "/comments/" + encodeURIComponent(comment_id), {
    method: "DELETE",
  });
