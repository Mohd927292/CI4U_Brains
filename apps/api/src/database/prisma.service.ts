import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const fallbackDevDatabaseUrl =
  "postgresql://ci4u:ci4u_password@localhost:5432/ci4u_brains?schema=public";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const databaseUrl = process.env.DATABASE_URL ?? fallbackDevDatabaseUrl;
    super({
      adapter: new PrismaPg(databaseUrl),
    });
  }

  async onModuleInit() {
    if (process.env.CI4U_REPOSITORY === "prisma") {
      await this.$connect();
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
