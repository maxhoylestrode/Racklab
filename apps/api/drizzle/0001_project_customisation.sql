CREATE TABLE "project_priorities" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_priorities_label_ck" CHECK (char_length("project_priorities"."label") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "project_statuses" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"kind" text DEFAULT 'todo' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_statuses_kind_ck" CHECK ("project_statuses"."kind" in ('todo', 'active', 'done')),
	CONSTRAINT "project_statuses_label_ck" CHECK (char_length("project_statuses"."label") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "project_tag_colors" (
	"name" text PRIMARY KEY NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The three built-in statuses and priorities become ordinary, editable rows. Existing projects keep their keys.
INSERT INTO "project_statuses" ("key", "label", "color", "kind", "sort_order") VALUES
	('not_started', 'Not started', '#8b8d98', 'todo', 0),
	('in_progress', 'In progress', '#3e83f8', 'active', 1),
	('complete', 'Complete', '#2fa36b', 'done', 2);--> statement-breakpoint
INSERT INTO "project_priorities" ("key", "label", "color", "sort_order") VALUES
	('high', 'High', '#e5484d', 0),
	('medium', 'Medium', '#f0a020', 1),
	('low', 'Low', '#14a3a3', 2);--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "priority" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "priority" SET DATA TYPE text USING "priority"::text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_status_project_statuses_key_fk" FOREIGN KEY ("status") REFERENCES "public"."project_statuses"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_priority_project_priorities_key_fk" FOREIGN KEY ("priority") REFERENCES "public"."project_priorities"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
DROP TYPE "public"."project_priority";--> statement-breakpoint
DROP TYPE "public"."project_status";