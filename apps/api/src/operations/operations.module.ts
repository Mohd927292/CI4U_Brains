import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../database/prisma.service";
import { LeadsModule } from "../leads/leads.module";
import { OperationsController } from "./operations.controller";
import { InMemoryOperationsRepository, operationsRepositoryToken } from "./operations.repository";
import { OperationsService } from "./operations.service";
import { PrismaOperationsRepository } from "./prisma-operations.repository";

@Module({
  imports: [LeadsModule],
  controllers: [OperationsController],
  providers: [
    PrismaService,
    OperationsService,
    {
      provide: operationsRepositoryToken,
      inject: [ConfigService, PrismaService],
      useFactory: (configService: ConfigService, prismaService: PrismaService) => {
        return configService.get<string>("CI4U_REPOSITORY") === "prisma"
          ? new PrismaOperationsRepository(prismaService)
          : new InMemoryOperationsRepository();
      },
    },
  ],
  exports: [OperationsService],
})
export class OperationsModule {}
