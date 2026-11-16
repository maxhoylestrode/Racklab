CREATE TYPE "public"."cable_type" AS ENUM('cat5e', 'cat6', 'cat6a', 'fibre', 'dac', 'usb', 'power', 'other');--> statement-breakpoint
CREATE TYPE "public"."device_category" AS ENUM('router', 'switch', 'server', 'sbc', 'pc', 'laptop', 'nas', 'ap', 'ups', 'patch_panel', 'shelf', 'other');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('online', 'offline', 'unknown', 'planned');--> statement-breakpoint
CREATE TYPE "public"."form_factor" AS ENUM('rack', 'loose');--> statement-breakpoint
CREATE TYPE "public"."ip_kind" AS ENUM('static', 'dhcp', 'reserved', 'virtual');--> statement-breakpoint
CREATE TYPE "public"."port_kind" AS ENUM('rj45', 'sfp', 'sfp_plus', 'usb', 'power', 'console', 'idrac', 'hdmi', 'vga', 'other');--> statement-breakpoint
CREATE TYPE "public"."project_priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('not_started', 'in_progress', 'complete');--> statement-breakpoint
CREATE TYPE "public"."service_kind" AS ENUM('vm', 'lxc', 'docker', 'app', 'other');--> statement-breakpoint
CREATE TYPE "public"."service_status" AS ENUM('running', 'stopped', 'unknown', 'planned');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"vault_auto_lock_minutes" integer DEFAULT 10 NOT NULL,
	"default_unit_height_px" integer DEFAULT 44 NOT NULL,
	"reduced_motion" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_single_ck" CHECK ("app_settings"."id" = 1),
	CONSTRAINT "app_settings_lock_ck" CHECK ("app_settings"."vault_auto_lock_minutes" between 1 and 10),
	CONSTRAINT "app_settings_unit_ck" CHECK ("app_settings"."default_unit_height_px" between 28 and 80)
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_single_ck" CHECK ("app_user"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"summary" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid,
	"service_id" uuid,
	"label" text NOT NULL,
	"username_plain" text,
	"secret_ciphertext" "bytea" NOT NULL,
	"secret_nonce" "bytea" NOT NULL,
	"totp_ciphertext" "bytea",
	"totp_nonce" "bytea",
	"url" text,
	"notes_ciphertext" "bytea",
	"notes_nonce" "bytea",
	"last_revealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_owner_ck" CHECK (not ("credentials"."device_id" is not null and "credentials"."service_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "device_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"category" "device_category" NOT NULL,
	"form_factor" "form_factor" NOT NULL,
	"height_u" integer NOT NULL,
	"width_fraction" real DEFAULT 1 NOT NULL,
	"port_layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"illustration_key" text DEFAULT 'generic' NOT NULL,
	"shelf_slots" integer,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_templates_height_ck" CHECK ("device_templates"."height_u" between 1 and 8),
	CONSTRAINT "device_templates_width_ck" CHECK ("device_templates"."width_fraction" > 0 and "device_templates"."width_fraction" <= 1)
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"hostname" text,
	"template_id" uuid NOT NULL,
	"rack_id" uuid,
	"rack_unit_start" integer,
	"rack_side" text DEFAULT 'front' NOT NULL,
	"shelf_device_id" uuid,
	"shelf_slot" integer,
	"role" text,
	"os" text,
	"location_note" text,
	"status" "device_status" DEFAULT 'unknown' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"color_accent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_side_ck" CHECK ("devices"."rack_side" = 'front'),
	CONSTRAINT "devices_accent_ck" CHECK ("devices"."color_accent" is null or "devices"."color_accent" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "ip_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"port_id" uuid,
	"address" "inet" NOT NULL,
	"prefix_length" integer DEFAULT 24 NOT NULL,
	"kind" "ip_kind" DEFAULT 'static' NOT NULL,
	"vlan_id" uuid,
	"dns_name" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"port_a_id" uuid NOT NULL,
	"port_b_id" uuid NOT NULL,
	"cable_type" "cable_type" DEFAULT 'cat6' NOT NULL,
	"cable_color" text DEFAULT '#3b82f6' NOT NULL,
	"length_m" real,
	"label" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_not_self_ck" CHECK ("links"."port_a_id" <> "links"."port_b_id")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"ip" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid,
	"service_id" uuid,
	"title" text NOT NULL,
	"body_markdown" text DEFAULT '' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notes_owner_ck" CHECK (not ("notes"."device_id" is not null and "notes"."service_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "ports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" "port_kind" NOT NULL,
	"speed_mbps" integer,
	"poe" boolean DEFAULT false NOT NULL,
	"position_index" integer NOT NULL,
	"layout_x" real NOT NULL,
	"layout_y" real NOT NULL,
	"group" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"device_id" uuid,
	"service_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_links_one_ck" CHECK (("project_links"."device_id" is null) <> ("project_links"."service_id" is null))
);
--> statement-breakpoint
CREATE TABLE "project_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description_markdown" text DEFAULT '' NOT NULL,
	"status" "project_status" DEFAULT 'not_started' NOT NULL,
	"priority" "project_priority" DEFAULT 'medium' NOT NULL,
	"due_date" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_title_ck" CHECK (char_length("projects"."title") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "racks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"total_units" integer DEFAULT 42 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "racks_units_ck" CHECK ("racks"."total_units" between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"parent_service_id" uuid,
	"name" text NOT NULL,
	"kind" "service_kind" NOT NULL,
	"vmid_or_ctid" integer,
	"ip_address_id" uuid,
	"port_number" integer,
	"url" text,
	"status" "service_status" DEFAULT 'unknown' NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"csrf_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_meta" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"kdf_salt" "bytea" NOT NULL,
	"kdf_params" jsonb NOT NULL,
	"wrapped_data_key" "bytea" NOT NULL,
	"wrapped_data_key_nonce" "bytea" NOT NULL,
	"verifier" "bytea" NOT NULL,
	"verifier_nonce" "bytea" NOT NULL,
	"recovery_kdf_params" jsonb NOT NULL,
	"recovery_wrapped_data_key" "bytea" NOT NULL,
	"recovery_wrapped_data_key_nonce" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vault_meta_single_ck" CHECK ("vault_meta"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "vlans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vlan_number" integer NOT NULL,
	"name" text NOT NULL,
	"subnet" "cidr",
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vlans_number_ck" CHECK ("vlans"."vlan_number" between 1 and 4094)
);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_template_id_device_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."device_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_rack_id_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."racks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_shelf_device_id_devices_id_fk" FOREIGN KEY ("shelf_device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_addresses" ADD CONSTRAINT "ip_addresses_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_addresses" ADD CONSTRAINT "ip_addresses_port_id_ports_id_fk" FOREIGN KEY ("port_id") REFERENCES "public"."ports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_addresses" ADD CONSTRAINT "ip_addresses_vlan_id_vlans_id_fk" FOREIGN KEY ("vlan_id") REFERENCES "public"."vlans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_port_a_id_ports_id_fk" FOREIGN KEY ("port_a_id") REFERENCES "public"."ports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_port_b_id_ports_id_fk" FOREIGN KEY ("port_b_id") REFERENCES "public"."ports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ports" ADD CONSTRAINT "ports_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_links" ADD CONSTRAINT "project_links_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_parent_service_id_services_id_fk" FOREIGN KEY ("parent_service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_ip_address_id_ip_addresses_id_fk" FOREIGN KEY ("ip_address_id") REFERENCES "public"."ip_addresses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_templates_key_uq" ON "device_templates" USING btree ("key");--> statement-breakpoint
CREATE INDEX "devices_rack_idx" ON "devices" USING btree ("rack_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_shelf_slot_uq" ON "devices" USING btree ("shelf_device_id","shelf_slot");--> statement-breakpoint
CREATE INDEX "ip_addresses_device_idx" ON "ip_addresses" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "links_port_a_uq" ON "links" USING btree ("port_a_id");--> statement-breakpoint
CREATE UNIQUE INDEX "links_port_b_uq" ON "links" USING btree ("port_b_id");--> statement-breakpoint
CREATE INDEX "ports_device_idx" ON "ports" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "project_links_project_idx" ON "project_links" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_tasks_project_idx" ON "project_tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status","sort_order");--> statement-breakpoint
CREATE INDEX "services_device_idx" ON "services" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vlans_number_uq" ON "vlans" USING btree ("vlan_number");