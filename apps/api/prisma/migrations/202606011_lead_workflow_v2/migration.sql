-- Rename the installation intent before production data exists.
ALTER TYPE "LeadIntent" RENAME VALUE 'NEW_INSTALLATION' TO 'INSTALLATION';

-- Replace old follow-up reason values with the final V2 vocabulary.
ALTER TYPE "FollowUpReason" RENAME TO "FollowUpReason_old";
CREATE TYPE "FollowUpReason" AS ENUM ('NURTURE', 'SITE_VISIT', 'QUOTATION', 'WON');
ALTER TABLE "leads"
  ALTER COLUMN "follow_up_reason" TYPE "FollowUpReason"
  USING (
    CASE "follow_up_reason"::text
      WHEN 'SITE_VISIT_REQUIRED' THEN 'SITE_VISIT'
      WHEN 'QUOTATION_REQUIRED' THEN 'QUOTATION'
      WHEN 'TO_FINALIZE_DECISION' THEN 'QUOTATION'
      ELSE "follow_up_reason"::text
    END
  )::"FollowUpReason";
DROP TYPE "FollowUpReason_old";

CREATE TYPE "WorkScheduleStatus" AS ENUM ('SCHEDULED', 'NOT_SCHEDULED');

CREATE TABLE "quotation_items" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "item_name" TEXT NOT NULL,
    "last_price_paise" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quotation_package_templates" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "package_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_package_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quotation_package_template_items" (
    "template_id" TEXT NOT NULL,
    "quotation_item_id" TEXT NOT NULL,
    "unit_price_paise" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_package_template_items_pkey" PRIMARY KEY ("template_id","quotation_item_id")
);

CREATE TABLE "lead_quotations" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "lead_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "total_price_paise" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_quotations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_quotation_packages" (
    "id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "package_name" TEXT NOT NULL,
    "multiplier" INTEGER NOT NULL DEFAULT 1,
    "package_total_paise" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lead_quotation_packages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lead_quotation_items" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "unit_price_paise" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "line_total_paise" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lead_quotation_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "won_lead_details" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "lead_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "site_contact_number" TEXT NOT NULL,
    "use_customer_phone_as_site_contact" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT NOT NULL,
    "scope_of_work" TEXT NOT NULL,
    "schedule_status" "WorkScheduleStatus" NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "quoted_price_paise" INTEGER NOT NULL,
    "accepted_price_paise" INTEGER NOT NULL,
    "advance_payment_paise" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "won_lead_details_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quotation_items_data_scope_item_name_key" ON "quotation_items"("data_scope", "item_name");
CREATE INDEX "quotation_items_data_scope_item_name_idx" ON "quotation_items"("data_scope", "item_name");
CREATE UNIQUE INDEX "quotation_package_templates_data_scope_package_name_key" ON "quotation_package_templates"("data_scope", "package_name");
CREATE INDEX "quotation_package_templates_data_scope_package_name_idx" ON "quotation_package_templates"("data_scope", "package_name");
CREATE INDEX "lead_quotations_data_scope_lead_id_created_at_idx" ON "lead_quotations"("data_scope", "lead_id", "created_at");
CREATE INDEX "lead_quotations_customer_id_created_at_idx" ON "lead_quotations"("customer_id", "created_at");
CREATE INDEX "lead_quotation_packages_quotation_id_sort_order_idx" ON "lead_quotation_packages"("quotation_id", "sort_order");
CREATE INDEX "lead_quotation_items_package_id_sort_order_idx" ON "lead_quotation_items"("package_id", "sort_order");
CREATE UNIQUE INDEX "won_lead_details_lead_id_key" ON "won_lead_details"("lead_id");
CREATE INDEX "won_lead_details_data_scope_customer_id_idx" ON "won_lead_details"("data_scope", "customer_id");

ALTER TABLE "quotation_package_template_items" ADD CONSTRAINT "quotation_package_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "quotation_package_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotation_package_template_items" ADD CONSTRAINT "quotation_package_template_items_quotation_item_id_fkey" FOREIGN KEY ("quotation_item_id") REFERENCES "quotation_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_quotations" ADD CONSTRAINT "lead_quotations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_quotations" ADD CONSTRAINT "lead_quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lead_quotation_packages" ADD CONSTRAINT "lead_quotation_packages_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "lead_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_quotation_items" ADD CONSTRAINT "lead_quotation_items_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "lead_quotation_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "won_lead_details" ADD CONSTRAINT "won_lead_details_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "won_lead_details" ADD CONSTRAINT "won_lead_details_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
