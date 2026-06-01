import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../database/prisma.service";
import { InMemoryLeadRepository, leadRepositoryToken } from "./lead.repository";
import { LeadIntakeService } from "./lead-intake.service";
import { LeadsController } from "./leads.controller";
import { PrismaLeadRepository } from "./prisma-lead.repository";

@Module({
  controllers: [LeadsController],
  providers: [
    PrismaService,
    LeadIntakeService,
    {
      provide: leadRepositoryToken,
      inject: [ConfigService, PrismaService],
      useFactory: (configService: ConfigService, prismaService: PrismaService) => {
        return configService.get<string>("CI4U_REPOSITORY") === "prisma"
          ? new PrismaLeadRepository(prismaService)
          : new InMemoryLeadRepository();
      },
    },
  ],
  exports: [LeadIntakeService],
})
export class LeadsModule {}
