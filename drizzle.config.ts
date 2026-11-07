import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  // Schema pushes need a direct connection: PgBouncer's transaction mode breaks session state
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED! },
});
