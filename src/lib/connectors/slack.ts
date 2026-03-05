/**
 * Slack Connector — cursor-based incremental sync of channel messages.
 *
 * Uses Slack's conversations.history API with a `oldest` timestamp cursor
 * persisted in the connector_cursors table so restarts continue where they
 * left off. Each sync page is fetched in order; the cursor advances only
 * after a page is successfully committed.
 *
 * Required env:  SLACK_BOT_TOKEN, SLACK_CHANNEL_IDS (comma-separated)
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { connectorCursors } from "../db/schema";
import { createEnvelope } from "../ontology";
import type { ConnectorAdapter, ConnectorConfig, ConnectorState, IngestRecord } from "./types";

interface SlackMessage {
  ts: string;
  user?: string;
  bot_id?: string;
  text?: string;
  subtype?: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: Array<{ name: string; count: number }>;
}

interface SlackHistoryResponse {
  ok: boolean;
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
  error?: string;
}

const SLACK_API_BASE = "https://slack.com/api";
const PAGE_LIMIT = 200;
const CONNECTOR_ID = "slack";

export class SlackConnector implements ConnectorAdapter {
  readonly id = CONNECTOR_ID;
  readonly name = "Slack";

  private config: ConnectorConfig | null = null;
  private state: ConnectorState = {
    status: "idle",
    last_run: null,
    records_ingested: 0,
    errors: 0,
    last_error: null,
  };

  private get token(): string | null {
    return (this.config?.settings.slack_bot_token as string | undefined) ?? // allow-secret
      process.env.SLACK_BOT_TOKEN ?? // allow-secret
      null;
  }

  private get channelIds(): string[] {
    const fromConfig = this.config?.settings.slack_channel_ids;
    if (Array.isArray(fromConfig)) return fromConfig as string[];
    const fromEnv = process.env.SLACK_CHANNEL_IDS;
    if (fromEnv) return fromEnv.split(",").map(s => s.trim()).filter(Boolean);
    return [];
  }

  configure(config: ConnectorConfig): void {
    this.config = config;
  }

  getState(): ConnectorState {
    return { ...this.state };
  }

  async sync(options?: { incremental?: boolean; since?: string }): Promise<IngestRecord[]> {
    const bearerToken = this.token; // allow-secret
    if (!bearerToken) {
      this.state.status = "error";
      this.state.last_error = "SLACK_BOT_TOKEN not configured";
      return [];
    }

    const channels = this.channelIds;
    if (!channels.length) {
      // No channels configured — skip silently.
      this.state.status = "completed";
      return [];
    }

    this.state.status = "running";
    const records: IngestRecord[] = [];

    for (const channelId of channels) {
      try {
        const channelRecords = await this.syncChannel(channelId, bearerToken, options?.incremental ?? false, options?.since);
        records.push(...channelRecords);
      } catch (err) {
        this.state.errors += 1;
        this.state.last_error = err instanceof Error ? err.message : String(err);
      }
    }

    this.state.status = "completed";
    this.state.last_run = new Date().toISOString();
    this.state.records_ingested += records.length;
    return records;
  }

  private async syncChannel(
    channelId: string,
    bearerToken: string, // allow-secret
    incremental: boolean,
    since?: string
  ): Promise<IngestRecord[]> {
    const cursorKey = `slack:${channelId}`;

    // Load stored cursor (a Slack ts value = Unix timestamp.microseconds)
    const [cursorRow] = await db
      .select()
      .from(connectorCursors)
      .where(eq(connectorCursors.connectorId, cursorKey));

    // Determine start ts: stored cursor > caller's `since` > none
    let oldest = cursorRow?.cursor ?? undefined;
    if (since && (!oldest || since > oldest)) {
      oldest = String(Math.floor(new Date(since).getTime() / 1_000));
    }
    if (!incremental) {
      // Full sync: ignore cursor
      oldest = undefined;
    }

    const records: IngestRecord[] = [];
    let paginationCursor: string | undefined;
    let latestTs: string | undefined;

    do {
      const params = new URLSearchParams({
        channel: channelId,
        limit: String(PAGE_LIMIT),
        inclusive: "false",
      });
      if (oldest) params.set("oldest", oldest);
      if (paginationCursor) params.set("cursor", paginationCursor);

      const resp = await fetch(`${SLACK_API_BASE}/conversations.history?${params}`, {
        headers: { Authorization: `Bearer ${bearerToken}` }, // allow-secret
      });

      const body: SlackHistoryResponse = await resp.json() as SlackHistoryResponse;

      if (!body.ok) {
        throw new Error(`Slack API error: ${body.error ?? "unknown"}`);
      }

      const messages = body.messages ?? [];

      for (const msg of messages) {
        // Skip subtypes (joins, leaves, etc) unless it's a real message
        if (msg.subtype && msg.subtype !== "bot_message") continue;
        if (!msg.text?.trim()) continue;

        records.push(this.messageToRecord(msg, channelId));

        // Track the highest ts seen — it becomes the next cursor
        if (!latestTs || msg.ts > latestTs) {
          latestTs = msg.ts;
        }
      }

      paginationCursor = body.has_more ? body.response_metadata?.next_cursor : undefined;
    } while (paginationCursor);

    // Persist advanced cursor (only update if we actually got new messages)
    if (latestTs) {
      await db
        .insert(connectorCursors)
        .values({
          connectorId: cursorKey,
          cursor: latestTs,
          lastSyncAt: new Date(),
          totalSynced: (cursorRow?.totalSynced ?? 0) + records.length,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: connectorCursors.connectorId,
          set: {
            cursor: latestTs,
            lastSyncAt: new Date(),
            totalSynced: (cursorRow?.totalSynced ?? 0) + records.length,
            updatedAt: new Date(),
          },
        });
    }

    return records;
  }

  private messageToRecord(msg: SlackMessage, channelId: string): IngestRecord {
    const author = msg.user ?? msg.bot_id ?? "unknown";
    const text = (msg.text ?? "").slice(0, 2000);
    return {
      dedup_key: `slack:message:${channelId}:${msg.ts}`,
      entity_class: "artifact",
      name: `slack-${channelId}-${msg.ts}`,
      display_name: text.slice(0, 80),
      description: text,
      attributes: {
        artifact_type: "slack_message",
        channel_id: channelId,
        ts: msg.ts,
        author,
        thread_ts: msg.thread_ts ?? null,
        reply_count: msg.reply_count ?? 0,
        reactions: msg.reactions ?? [],
      },
      envelope: createEnvelope({
        source_id: `slack:${channelId}`,
        source_type: "slack",
        channel: "api",
        confidence: 0.9,
        valid_from: new Date(Number(msg.ts) * 1000).toISOString(),
      }),
    };
  }
}
