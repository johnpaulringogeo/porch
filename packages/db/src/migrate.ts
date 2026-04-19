/**
 * Apply pending migrations against DATABASE_URL.
 *
 *   pnpm --filter @porch/db migrate
 *
 * Uses postgres-js driver explicitly (Node-only script — never run from edge).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  const migrationsFolder = new URL('./migrations', import.meta.url).pathname;
  console.info(`Applying migrations from ${migrationsFolder}…`);
  await migrate(db, { migrationsFolder });
  console.info('Migrations complete.');

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
