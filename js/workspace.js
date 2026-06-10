/**
 * Per-tab workspace — agenda, slides and settings are namespaced so users
 * on the same browser (different tabs) do not share data.
 * Data never leaves the browser; there is no server-side storage.
 */

const WORKSPACE_SESSION_KEY = "xelto-webinar-workspace-id";

export function getWorkspaceId() {
  let id = sessionStorage.getItem(WORKSPACE_SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID().slice(0, 8);
    sessionStorage.setItem(WORKSPACE_SESSION_KEY, id);
  }
  return id;
}

export function startNewWorkspace() {
  const id = crypto.randomUUID().slice(0, 8);
  sessionStorage.setItem(WORKSPACE_SESSION_KEY, id);
  return id;
}

export function storageKey(name) {
  return `xelto-ws-${getWorkspaceId()}-${name}`;
}
