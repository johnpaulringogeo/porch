DO $$ BEGIN
 CREATE TYPE "public"."account_status" AS ENUM('active', 'restricted', 'suspended', 'deletion_requested', 'deleted');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."persona_moderation_state" AS ENUM('ok', 'restricted', 'suspended');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."contact_request_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."post_audience_mode" AS ENUM('all_contacts', 'selected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."post_mode" AS ENUM('home', 'public', 'community', 'professional', 'creators');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."post_moderation_state" AS ENUM('ok', 'pending_review', 'limited', 'hidden', 'removed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_type" AS ENUM('contact_request_received', 'contact_request_accepted', 'contact_request_declined', 'post_moderated', 'account_moderated', 'system');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."moderation_report_status" AS ENUM('open', 'reviewing', 'actioned', 'dismissed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"email_verification_token" text,
	"password_hash" text NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"age_attested_at" timestamp with time zone,
	"age_jurisdiction" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "account_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "persona" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"username" text NOT NULL,
	"did" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"avatar_url" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"moderation_state" "persona_moderation_state" DEFAULT 'ok' NOT NULL,
	"moderation_reason" text,
	CONSTRAINT "persona_username_unique" UNIQUE("username"),
	CONSTRAINT "persona_did_unique" UNIQUE("did")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "persona_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"persona_id" uuid NOT NULL,
	"key_id" text NOT NULL,
	"public_key_multibase" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"algorithm" text DEFAULT 'Ed25519VerificationKey2020' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"active_persona_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "session_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact" (
	"owner_persona_id" uuid NOT NULL,
	"contact_persona_id" uuid NOT NULL,
	"nickname" text,
	"established_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_owner_persona_id_contact_persona_id_pk" PRIMARY KEY("owner_persona_id","contact_persona_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_persona_id" uuid NOT NULL,
	"to_persona_id" uuid NOT NULL,
	"message" text,
	"status" "contact_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_persona_id" uuid NOT NULL,
	"mode" "post_mode" NOT NULL,
	"audience_mode" "post_audience_mode" DEFAULT 'all_contacts' NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"moderation_state" "post_moderation_state" DEFAULT 'ok' NOT NULL,
	"moderation_reason" text,
	"moderated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_audience" (
	"post_id" uuid NOT NULL,
	"audience_persona_id" uuid NOT NULL,
	CONSTRAINT "post_audience_post_id_audience_persona_id_pk" PRIMARY KEY("post_id","audience_persona_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_persona_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"persona_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"metadata" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "moderation_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_persona_id" uuid,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" "moderation_report_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_note" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "persona" ADD CONSTRAINT "persona_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "persona_key" ADD CONSTRAINT "persona_key_persona_id_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_active_persona_id_persona_id_fk" FOREIGN KEY ("active_persona_id") REFERENCES "public"."persona"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact" ADD CONSTRAINT "contact_owner_persona_id_persona_id_fk" FOREIGN KEY ("owner_persona_id") REFERENCES "public"."persona"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact" ADD CONSTRAINT "contact_contact_persona_id_persona_id_fk" FOREIGN KEY ("contact_persona_id") REFERENCES "public"."persona"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_request" ADD CONSTRAINT "contact_request_from_persona_id_persona_id_fk" FOREIGN KEY ("from_persona_id") REFERENCES "public"."persona"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_request" ADD CONSTRAINT "contact_request_to_persona_id_persona_id_fk" FOREIGN KEY ("to_persona_id") REFERENCES "public"."persona"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post" ADD CONSTRAINT "post_author_persona_id_persona_id_fk" FOREIGN KEY ("author_persona_id") REFERENCES "public"."persona"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_audience" ADD CONSTRAINT "post_audience_post_id_post_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."post"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "post_audience" ADD CONSTRAINT "post_audience_audience_persona_id_persona_id_fk" FOREIGN KEY ("audience_persona_id") REFERENCES "public"."persona"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_persona_id_persona_id_fk" FOREIGN KEY ("recipient_persona_id") REFERENCES "public"."persona"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_persona_id_persona_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."persona"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "moderation_report" ADD CONSTRAINT "moderation_report_reporter_persona_id_persona_id_fk" FOREIGN KEY ("reporter_persona_id") REFERENCES "public"."persona"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "persona_account_idx" ON "persona" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "persona_default_per_account_idx" ON "persona" USING btree ("account_id") WHERE "persona"."is_default" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "persona_key_persona_idx" ON "persona_key" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_account_idx" ON "session" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_owner_idx" ON "contact" USING btree ("owner_persona_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_request_from_idx" ON "contact_request" USING btree ("from_persona_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_request_to_idx" ON "contact_request" USING btree ("to_persona_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_request_status_idx" ON "contact_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_author_created_idx" ON "post" USING btree ("author_persona_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_mode_created_idx" ON "post" USING btree ("mode","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_audience_audience_idx" ON "post_audience" USING btree ("audience_persona_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_recipient_created_idx" ON "notification" USING btree ("recipient_persona_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_account_created_idx" ON "audit_log" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_action_created_idx" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "moderation_subject_idx" ON "moderation_report" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "moderation_status_idx" ON "moderation_report" USING btree ("status");