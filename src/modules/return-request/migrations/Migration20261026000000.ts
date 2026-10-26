import { Migration } from '@mikro-orm/migrations';

export class Migration20261026000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "return_request" (
      "id" text not null,
      "order_id" text not null,
      "display_id" text null,
      "customer_id" text null,
      "customer_email" text not null,
      "customer_name" text null,
      "type" text not null,
      "items" jsonb null,
      "reason" text null,
      "payment_method" text not null default 'cod',
      "currency_code" text not null default 'kwd',
      "refund_amount" integer not null default 0,
      "refund_method" text not null default 'none',
      "bank_details" jsonb null,
      "status" text not null default 'requested',
      "admin_notes" text null,
      "processed_at" timestamptz null,
      "metadata" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "return_request_pkey" primary key ("id")
    );`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_return_request_deleted_at" ON "return_request" (deleted_at) WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_return_request_order_id" ON "return_request" (order_id);`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_return_request_status" ON "return_request" (status);`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "return_request" cascade;`);
  }
}
