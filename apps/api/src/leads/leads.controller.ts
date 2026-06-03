import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { ZodError } from "zod";
import { LeadIntakeService, LeadValidationError, type CreateLeadInput, type SaveCallOutcomeInput } from "./lead-intake.service";
import { type ImportPreviewRowInput, type LeadQueue } from "./lead.types";

@Controller("leads")
export class LeadsController {
  constructor(@Inject(LeadIntakeService) private readonly leadIntakeService: LeadIntakeService) {}

  @Get("raw")
  listRawLeads(@Req() req: Request) {
    return this.leadIntakeService.listRawLeads(requireDataScope(req));
  }

  @Get("counts")
  getQueueCounts(@Req() req: Request) {
    return this.leadIntakeService.getQueueCounts(requireDataScope(req));
  }

  @Get("queue/:queue")
  listQueue(@Req() req: Request, @Param("queue") queue: LeadQueue) {
    if (!["RAW", "WARM", "HOT_INSTALLATION", "HOT_REPAIR_SERVICE", "UNANSWERED", "GHOSTING", "WON", "LOST", "ARCHIVE"].includes(queue)) {
      throw new BadRequestException({
        code: "INVALID_QUEUE",
        message: "Lead queue is not valid.",
      });
    }

    return this.leadIntakeService.listLeadsByQueue(requireDataScope(req), queue);
  }

  @Get(":leadId")
  async getLeadDetail(@Req() req: Request, @Param("leadId") leadId: string) {
    const lead = await this.leadIntakeService.getLeadDetail(requireDataScope(req), leadId);

    if (!lead) {
      throw new NotFoundException({
        code: "LEAD_NOT_FOUND",
        message: "Lead was not found.",
      });
    }

    return lead;
  }

  @Post("manual")
  async createManualLead(@Req() req: Request, @Body() body: CreateLeadInput) {
    try {
      return await this.leadIntakeService.createManualLead(requireDataScope(req), body);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post(":leadId/call-outcome")
  async saveCallOutcome(@Req() req: Request, @Param("leadId") leadId: string, @Body() body: SaveCallOutcomeInput) {
    try {
      return await this.leadIntakeService.saveCallOutcome(requireDataScope(req), leadId, body);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("import/preview")
  async previewImport(@Req() req: Request, @Body() body: { rows?: ImportPreviewRowInput[] }) {
    if (!Array.isArray(body.rows)) {
      throw new BadRequestException({
        code: "ROWS_REQUIRED",
        message: "Import preview requires a rows array.",
      });
    }

    return this.leadIntakeService.previewImportRows(requireDataScope(req), body.rows);
  }

  @Post("import/commit")
  async commitImport(@Req() req: Request, @Body() body: { rows?: ImportPreviewRowInput[]; source?: string }) {
    if (!Array.isArray(body.rows)) {
      throw new BadRequestException({
        code: "ROWS_REQUIRED",
        message: "Import commit requires a rows array.",
      });
    }

    return this.leadIntakeService.commitImportRows(requireDataScope(req), body.rows, body.source ?? "IMPORT");
  }

  private toBadRequest(error: unknown): BadRequestException {
    if (error instanceof LeadValidationError) {
      return new BadRequestException({
        code: error.code,
        message: error.message,
      });
    }

    if (error instanceof ZodError) {
      return new BadRequestException({
        code: "VALIDATION_ERROR",
        issues: error.issues,
      });
    }

    throw error;
  }
}

function requireDataScope(req: Request) {
  if (!req.user?.dataScope) {
    throw new BadRequestException({
      code: "DATA_SCOPE_REQUIRED",
      message: "Authenticated data scope is required for lead operations.",
    });
  }

  return req.user.dataScope;
}
