import { defineConfig } from "prisma/config";

const fallbackDevDatabaseUrl =
  "postgresql://ci4u:ci4u_password@localhost:5432/ci4u_brains?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? fallbackDevDatabaseUrl,
  },
});
