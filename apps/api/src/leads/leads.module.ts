import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../database/prisma.service";
import { InMemoryLeadRepository, leadRepositoryToken } from "./lead.repository";
import { LeadIntakeService } from "./lead-intake.service";
import { LeadsController } from "./leads.controller";
import { PrismaLeadRepository } from "./prisma-lead.repository";

@Module({
  imports: [AuthModule],
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
