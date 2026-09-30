CREATE TABLE "lead_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"sent_by" uuid,
	"assigned_agent_id" uuid,
	"source_id" uuid,
	"to_email" varchar(255) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"status" varchar(20) DEFAULT 'sent' NOT NULL,
	"error" text,
	"message_id" varchar(250),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"basic_salary" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period" varchar(7) NOT NULL,
	"basic_salary" integer NOT NULL,
	"working_days" integer NOT NULL,
	"present_days" integer NOT NULL,
	"absent_days" integer NOT NULL,
	"leave_days" integer DEFAULT 0 NOT NULL,
	"absence_deduction" integer NOT NULL,
	"bonus" integer DEFAULT 0 NOT NULL,
	"other_deduction" integer DEFAULT 0 NOT NULL,
	"final_salary" integer NOT NULL,
	"note" text,
	"finalized_by" uuid,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_emails" ADD CONSTRAINT "lead_emails_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_emails" ADD CONSTRAINT "lead_emails_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_emails" ADD CONSTRAINT "lead_emails_assigned_agent_id_users_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_emails" ADD CONSTRAINT "lead_emails_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_profiles" ADD CONSTRAINT "salary_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_profiles" ADD CONSTRAINT "salary_profiles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_records" ADD CONSTRAINT "salary_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_records" ADD CONSTRAINT "salary_records_finalized_by_users_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_emails_lead_idx" ON "lead_emails" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_emails_agent_idx" ON "lead_emails" USING btree ("assigned_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_records_user_period_uq" ON "salary_records" USING btree ("user_id","period");--> statement-breakpoint
CREATE INDEX "salary_records_period_idx" ON "salary_records" USING btree ("period");