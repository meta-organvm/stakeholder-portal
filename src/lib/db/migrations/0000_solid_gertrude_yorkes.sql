CREATE TYPE "public"."alert_delivery_status" AS ENUM('sent', 'failed', 'retried', 'acked');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'done', 'failed', 'dead_letter');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('maintenance_cycle', 'alert_dispatch', 'connector_sync', 'retention');--> statement-breakpoint
CREATE TABLE "alert_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"scorecard_id" text,
	"alert_id" text NOT NULL,
	"alert_code" text NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"sink" text NOT NULL,
	"status" "alert_delivery_status" DEFAULT 'sent' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acked_at" timestamp with time zone,
	"error_message" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_cursors" (
	"connector_id" text PRIMARY KEY NOT NULL,
	"cursor" text,
	"last_sync_at" timestamp with time zone,
	"total_synced" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escalation_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"unacked_after_seconds" integer DEFAULT 3600 NOT NULL,
	"escalate_to" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "job_type" NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb,
	"result" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"worker_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"locked_by" text,
	"scorecard" jsonb
);
--> statement-breakpoint
CREATE TABLE "singleton_locks" (
	"name" text PRIMARY KEY NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text NOT NULL
);
