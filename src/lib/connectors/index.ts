/**
 * Connector bootstrap utilities.
 */

import { GitHubConnector } from "./github";
import { WorkspaceConnector } from "./workspace";
import { DocsConnector } from "./docs";
import { SlackConnector } from "./slack";
import { getConnector, registerConnector } from "./types";

export function ensureDefaultConnectorsRegistered(): void {
  if (!getConnector("github")) registerConnector(new GitHubConnector());
  if (!getConnector("workspace")) registerConnector(new WorkspaceConnector());
  if (!getConnector("docs")) registerConnector(new DocsConnector());
  if (!getConnector("slack")) registerConnector(new SlackConnector());
}

