import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { ZodError } from "zod";
import type { SessionUser } from "../auth/auth.service";
import { AuthService, AuthWorkflowError } from "../auth/auth.service";
import { LeadIntakeService, LeadValidationError, type CreateLeadInput, type SaveCallOutcomeInput, type SnoozeFollowUpInput, type TransferLeadInput } from "./lead-intake.service";
import { type ImportPreviewRowInput, type LeadQueue } from "./lead.types";

@Controller("leads")
export class LeadsController {
  constructor(
    @Inject(LeadIntakeService) private readonly leadIntakeService: LeadIntakeService,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  @Get("raw")
  async listRawLeads(@Req() req: Request) {
    const actor = await this.requireActor(req);
    this.authService.assertPermission(actor, "WORK_ON_LEADS");
    return this.leadIntakeService.listRawLeads(actor.dataScope);
  }

  @Get("counts")
  async getQueueCounts(@Req() req: Request) {
    const actor = await this.requireActor(req);
    this.authService.assertPermission(actor, "WORK_ON_LEADS");
    return this.leadIntakeService.getQueueCounts(actor.dataScope);
  }

  @Get("queue/:queue")
  async listQueue(@Req() req: Request, @Param("queue") queue: LeadQueue) {
    if (!["RAW", "WARM", "HOT_INSTALLATION", "HOT_REPAIR_SERVICE", "UNANSWERED", "GHOSTING", "WON", "LOST", "ARCHIVE"].includes(queue)) {
      throw new BadRequestException({
        code: "INVALID_QUEUE",
        message: "Lead queue is not valid.",
      });
    }

    const actor = await this.requireActor(req);
    this.authService.assertPermission(actor, "WORK_ON_LEADS");
    return this.leadIntakeService.listLeadsByQueue(actor.dataScope, queue);
  }

  @Get("follow-up-alerts")
  async listDueFollowUpAlerts(@Req() req: Request) {
    const actor = await this.requireActor(req);
    this.authService.assertPermission(actor, "WORK_ON_LEADS");
    return this.leadIntakeService.listDueFollowUpAlerts(actor.dataScope, actor.id);
  }

  @Post("follow-up-alerts/:followUpId/snooze")
  async snoozeFollowUpAlert(@Req() req: Request, @Param("followUpId") followUpId: string, @Body() body: SnoozeFollowUpInput) {
    try {
      const actor = await this.requireActor(req);
      this.authService.assertPermission(actor, "WORK_ON_LEADS");
      return await this.leadIntakeService.snoozeFollowUpAlert(actor.dataScope, followUpId, body, actor.id);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("follow-up-alerts/:followUpId/handle-now")
  async holdFollowUpForHandling(@Req() req: Request, @Param("followUpId") followUpId: string) {
    try {
      const actor = await this.requireActor(req);
      this.authService.assertPermission(actor, "WORK_ON_LEADS");
      return await this.leadIntakeService.holdFollowUpForHandling(actor.dataScope, followUpId, actor.id);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Get(":leadId")
  async getLeadDetail(@Req() req: Request, @Param("leadId") leadId: string) {
    const actor = await this.requireActor(req);
    this.authService.assertPermission(actor, "WORK_ON_LEADS");
    const lead = await this.leadIntakeService.getLeadDetail(actor.dataScope, leadId);

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
      const actor = await this.requireActor(req);
      this.authService.assertPermission(actor, "ADD_RAW_LEADS");
      return await this.leadIntakeService.createManualLead(actor.dataScope, {
        ...body,
        createdById: actor.id,
        assignedToId: body.assignedToId ?? actor.id,
      });
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post(":leadId/call-outcome")
  async saveCallOutcome(@Req() req: Request, @Param("leadId") leadId: string, @Body() body: SaveCallOutcomeInput) {
    try {
      const actor = await this.requireActor(req);
      this.authService.assertPermission(actor, "WORK_ON_LEADS");
      return await this.leadIntakeService.saveCallOutcome(actor.dataScope, leadId, body, actor.id);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post(":leadId/call-outcome/ack")
  async saveCallOutcomeAck(@Req() req: Request, @Param("leadId") leadId: string, @Body() body: SaveCallOutcomeInput) {
    try {
      const actor = await this.requireActor(req);
      this.authService.assertPermission(actor, "WORK_ON_LEADS");
      return await this.leadIntakeService.saveCallOutcomeAck(actor.dataScope, leadId, body, actor.id);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post(":leadId/transfer")
  async transferLead(@Req() req: Request, @Param("leadId") leadId: string, @Body() body: TransferLeadInput) {
    try {
      const actor = await this.requireActor(req);
      this.authService.assertPermission(actor, "TRANSFER_LEADS");
      return await this.leadIntakeService.transferLead(actor.dataScope, leadId, body, actor.id);
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

    try {
      const actor = await this.requireActor(req);
      this.authService.assertPermission(actor, "ADD_RAW_LEADS");
      return this.leadIntakeService.previewImportRows(actor.dataScope, body.rows);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("import/commit")
  async commitImport(@Req() req: Request, @Body() body: { rows?: ImportPreviewRowInput[]; source?: string }) {
    if (!Array.isArray(body.rows)) {
      throw new BadRequestException({
        code: "ROWS_REQUIRED",
        message: "Import commit requires a rows array.",
      });
    }

    try {
      const actor = await this.requireActor(req);
      this.authService.assertPermission(actor, "ADD_RAW_LEADS");
      return this.leadIntakeService.commitImportRows(actor.dataScope, body.rows, body.source ?? "IMPORT", actor.id);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  private requireActor(req: Request): Promise<SessionUser> {
    return this.authService.getCurrentUser(requireUser(req));
  }

  private toBadRequest(error: unknown): BadRequestException {
    if (error instanceof AuthWorkflowError) {
      return new BadRequestException({
        code: error.code,
        message: error.message,
      });
    }

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

function requireUser(req: Request) {
  if (!req.user?.dataScope) {
    throw new BadRequestException({
      code: "AUTH_REQUIRED",
      message: "Authenticated CI4U user is required.",
    });
  }

  return req.user;
}
