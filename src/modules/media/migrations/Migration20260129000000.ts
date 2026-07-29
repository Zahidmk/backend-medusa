import { Migration } from '@mikro-orm/migrations';

export class Migration20260129000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "media" add column if not exists "product_ids" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "media" drop column if exists "product_ids";`);
  }

}
