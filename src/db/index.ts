import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

// Pooled connection for app and task traffic; migrations use the direct one (see drizzle.config.ts)
export const db = drizzle(process.env.DATABASE_URL!, { schema });
