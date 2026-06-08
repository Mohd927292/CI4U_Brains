import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { ZodError } from "zod";
import type { UserRole } from "../auth/auth.types";
import { AuthService, AuthWorkflowError, type SessionUser } from "../auth/auth.service";
import {
  OperationsService,
  OperationsValidationError,
  type AddJobPhotoInput,
  type AssignJobInput,
  type CompleteJobInput,
  type SaveJobChecklistInput,
} from "./operations.service";
import type { CreateVendorInput } from "./operations.types";

const operationsRoles: ReadonlySet<UserRole> = new Set([
  "FOUNDER",
  "SUPER_ADMIN",
  "ADMIN",
  "MANAGEMENT",
  "OPERATIONS_HEAD",
  "OPERATIONS_MANAGER",
  "OPERATIONS_EXECUTIVE",
  "VENDOR_MANAGER",
]);

const vendorManagerRoles: ReadonlySet<UserRole> = new Set([
  "FOUNDER",
  "SUPER_ADMIN",
  "ADMIN",
  "MANAGEMENT",
  "OPERATIONS_HEAD",
  "OPERATIONS_MANAGER",
  "VENDOR_MANAGER",
]);

@Controller("operations")
export class OperationsController {
  constructor(
    @Inject(OperationsService) private readonly operationsService: OperationsService,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  @Get("vendors")
  async listVendors(@Req() req: Request) {
    const actor = await this.requireActor(req);
    requireRole(actor, operationsRoles);
    return this.operationsService.listVendors(actor.dataScope);
  }

  @Post("vendors")
  async createVendor(@Req() req: Request, @Body() body: CreateVendorInput) {
    const actor = await this.requireActor(req);
    requireRole(actor, vendorManagerRoles);

    try {
      return await this.operationsService.createVendor(actor.dataScope, body, actor.id);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Get("won/:leadId")
  async getWonLeadOperation(@Req() req: Request, @Param("leadId") leadId: string) {
    const actor = await this.requireActor(req);
    requireRole(actor, operationsRoles);

    try {
      const detail = await this.operationsService.getWonLeadOperation(actor.dataScope, leadId);

      if (!detail) {
        throw new NotFoundException({
          code: "LEAD_NOT_FOUND",
          message: "Lead was not found.",
        });
      }

      return detail;
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("won/:leadId/job")
  async createJobFromWonLead(@Req() req: Request, @Param("leadId") leadId: string) {
    const actor = await this.requireActor(req);
    requireRole(actor, operationsRoles);

    try {
      return await this.operationsService.createJobFromWonLead(actor.dataScope, leadId, actor.id);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("jobs/:jobId/assign")
  async assignJob(@Req() req: Request, @Param("jobId") jobId: string, @Body() body: AssignJobInput) {
    const actor = await this.requireActor(req);
    requireRole(actor, vendorManagerRoles);

    try {
      return await this.operationsService.assignJob(actor.dataScope, jobId, actor.id, body);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("jobs/:jobId/start")
  async startJob(@Req() req: Request, @Param("jobId") jobId: string) {
    const actor = await this.requireActor(req);
    requireRole(actor, operationsRoles);

    try {
      return await this.operationsService.startJob(actor.dataScope, jobId, actor.id);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("jobs/:jobId/pause")
  async pauseJob(@Req() req: Request, @Param("jobId") jobId: string) {
    const actor = await this.requireActor(req);
    requireRole(actor, operationsRoles);

    try {
      return await this.operationsService.pauseJob(actor.dataScope, jobId, actor.id);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("jobs/:jobId/photos")
  async addJobPhoto(@Req() req: Request, @Param("jobId") jobId: string, @Body() body: AddJobPhotoInput) {
    const actor = await this.requireActor(req);
    requireRole(actor, operationsRoles);

    try {
      return await this.operationsService.addJobPhoto(actor.dataScope, jobId, actor.id, body);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("jobs/:jobId/checklist")
  async saveJobChecklist(@Req() req: Request, @Param("jobId") jobId: string, @Body() body: SaveJobChecklistInput) {
    const actor = await this.requireActor(req);
    requireRole(actor, operationsRoles);

    try {
      return await this.operationsService.saveJobChecklist(actor.dataScope, jobId, actor.id, body);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("jobs/:jobId/complete")
  async completeJob(@Req() req: Request, @Param("jobId") jobId: string, @Body() body: CompleteJobInput) {
    const actor = await this.requireActor(req);
    requireRole(actor, operationsRoles);

    try {
      return await this.operationsService.completeJob(actor.dataScope, jobId, actor.id, body);
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

    if (error instanceof OperationsValidationError) {
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

    if (error instanceof NotFoundException) {
      throw error;
    }

    throw error;
  }
}

function requireUser(req: Request) {
  if (!req.user?.dataScope) {
    throw new BadRequestException({
      code: "DATA_SCOPE_REQUIRED",
      message: "Authenticated data scope is required for operations.",
    });
  }

  return req.user;
}

function requireRole(actor: SessionUser, allowedRoles: ReadonlySet<UserRole>): void {
  if (!allowedRoles.has(actor.role)) {
    throw new BadRequestException({
      code: "ROLE_NOT_ALLOWED",
      message: "Your role cannot perform this operations action.",
    });
  }
}
