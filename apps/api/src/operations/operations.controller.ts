import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { ZodError } from "zod";
import type { DataScope, UserRole } from "../auth/auth.types";
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
  constructor(@Inject(OperationsService) private readonly operationsService: OperationsService) {}

  @Get("vendors")
  listVendors(@Req() req: Request) {
    requireRole(req, operationsRoles);
    return this.operationsService.listVendors(requireDataScope(req));
  }

  @Post("vendors")
  async createVendor(@Req() req: Request, @Body() body: CreateVendorInput) {
    requireRole(req, vendorManagerRoles);

    try {
      return await this.operationsService.createVendor(requireDataScope(req), body);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Get("won/:leadId")
  async getWonLeadOperation(@Req() req: Request, @Param("leadId") leadId: string) {
    requireRole(req, operationsRoles);

    try {
      const detail = await this.operationsService.getWonLeadOperation(requireDataScope(req), leadId);

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
    requireRole(req, operationsRoles);

    try {
      return await this.operationsService.createJobFromWonLead(requireDataScope(req), leadId, req.user?.id ?? null);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("jobs/:jobId/assign")
  async assignJob(@Req() req: Request, @Param("jobId") jobId: string, @Body() body: AssignJobInput) {
    requireRole(req, vendorManagerRoles);

    try {
      return await this.operationsService.assignJob(requireDataScope(req), jobId, req.user?.id ?? null, body);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("jobs/:jobId/start")
  async startJob(@Req() req: Request, @Param("jobId") jobId: string) {
    requireRole(req, operationsRoles);

    try {
      return await this.operationsService.startJob(requireDataScope(req), jobId, req.user?.id ?? null);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("jobs/:jobId/pause")
  async pauseJob(@Req() req: Request, @Param("jobId") jobId: string) {
    requireRole(req, operationsRoles);

    try {
      return await this.operationsService.pauseJob(requireDataScope(req), jobId, req.user?.id ?? null);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("jobs/:jobId/photos")
  async addJobPhoto(@Req() req: Request, @Param("jobId") jobId: string, @Body() body: AddJobPhotoInput) {
    requireRole(req, operationsRoles);

    try {
      return await this.operationsService.addJobPhoto(requireDataScope(req), jobId, req.user?.id ?? null, body);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("jobs/:jobId/checklist")
  async saveJobChecklist(@Req() req: Request, @Param("jobId") jobId: string, @Body() body: SaveJobChecklistInput) {
    requireRole(req, operationsRoles);

    try {
      return await this.operationsService.saveJobChecklist(requireDataScope(req), jobId, req.user?.id ?? null, body);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  @Post("jobs/:jobId/complete")
  async completeJob(@Req() req: Request, @Param("jobId") jobId: string, @Body() body: CompleteJobInput) {
    requireRole(req, operationsRoles);

    try {
      return await this.operationsService.completeJob(requireDataScope(req), jobId, req.user?.id ?? null, body);
    } catch (error) {
      throw this.toBadRequest(error);
    }
  }

  private toBadRequest(error: unknown): BadRequestException {
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

function requireDataScope(req: Request): DataScope {
  if (!req.user?.dataScope) {
    throw new BadRequestException({
      code: "DATA_SCOPE_REQUIRED",
      message: "Authenticated data scope is required for operations.",
    });
  }

  return req.user.dataScope;
}

function requireRole(req: Request, allowedRoles: ReadonlySet<UserRole>): void {
  const role = req.user?.role;

  if (!role || !allowedRoles.has(role)) {
    throw new BadRequestException({
      code: "ROLE_NOT_ALLOWED",
      message: "Your role cannot perform this operations action.",
    });
  }
}
