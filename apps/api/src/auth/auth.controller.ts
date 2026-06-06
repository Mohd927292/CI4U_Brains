import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { ZodError } from "zod";
import type { DataScope, RequestUser, UserRole } from "./auth.types";
import { AuthService, AuthWorkflowError, type CreateUserInput } from "./auth.service";

const userAdminRoles: ReadonlySet<UserRole> = new Set(["FOUNDER", "SUPER_ADMIN", "ADMIN", "MANAGEMENT"]);

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get("me")
  getMe(@Req() req: Request) {
    return this.authService.getCurrentUser(requireUser(req));
  }

  @Get("users")
  listUsers(@Req() req: Request) {
    const user = requireUser(req);
    requireRole(user, userAdminRoles);
    return this.authService.listUsers(user.dataScope);
  }

  @Post("users")
  async createUser(@Req() req: Request, @Body() body: CreateUserInput) {
    const user = requireUser(req);
    requireRole(user, userAdminRoles);

    try {
      return await this.authService.createUser(user.dataScope, user, body);
    } catch (error) {
      throw toBadRequest(error);
    }
  }

  @Get("notifications")
  listNotifications(@Req() req: Request) {
    const user = requireUser(req);
    return this.authService.listNotifications(user.dataScope, user.id);
  }

  @Post("notifications/:notificationId/read")
  async markNotificationRead(@Req() req: Request, @Param("notificationId") notificationId: string) {
    const user = requireUser(req);

    try {
      return await this.authService.markNotificationRead(user.dataScope, user.id, notificationId);
    } catch (error) {
      throw toBadRequest(error);
    }
  }
}

function requireUser(req: Request): RequestUser {
  if (!req.user?.dataScope) {
    throw new BadRequestException({
      code: "AUTH_REQUIRED",
      message: "Authenticated CI4U user is required.",
    });
  }

  return req.user;
}

function requireRole(user: RequestUser, allowedRoles: ReadonlySet<UserRole>): void {
  if (!allowedRoles.has(user.role)) {
    throw new BadRequestException({
      code: "ROLE_NOT_ALLOWED",
      message: "Your role cannot manage CI4U users.",
    });
  }
}

function toBadRequest(error: unknown): BadRequestException {
  if (error instanceof AuthWorkflowError) {
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
