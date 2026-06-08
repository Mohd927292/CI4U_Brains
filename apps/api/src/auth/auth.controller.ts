import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { ZodError } from "zod";
import type { RequestUser } from "./auth.types";
import { AuthService, AuthWorkflowError, type CreateUserInput, type StaffPerformanceRangeInput, type UpdateUserInput } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get("me")
  getMe(@Req() req: Request) {
    try {
      return this.authService.getCurrentUser(requireUser(req));
    } catch (error) {
      throw toBadRequest(error);
    }
  }

  @Get("access-options")
  getAccessOptions() {
    return this.authService.getAccessOptions();
  }

  @Get("users")
  listUsers(@Req() req: Request) {
    const user = requireUser(req);
    return this.authService.listUsers(user.dataScope, user);
  }

  @Get("assignable-users")
  listAssignableUsers(@Req() req: Request) {
    const user = requireUser(req);
    return this.authService.listAssignableUsers(user.dataScope, user);
  }

  @Get("users/:userId/metrics")
  async getUserMetrics(@Req() req: Request, @Param("userId") userId: string, @Query() query: StaffPerformanceRangeInput) {
    const user = requireUser(req);

    try {
      return await this.authService.getUserMetrics(user.dataScope, user, userId, query);
    } catch (error) {
      throw toBadRequest(error);
    }
  }

  @Get("leaderboards")
  async getLeaderboards(@Req() req: Request, @Query() query: StaffPerformanceRangeInput) {
    const user = requireUser(req);

    try {
      return await this.authService.getLeaderboards(user.dataScope, user, query);
    } catch (error) {
      throw toBadRequest(error);
    }
  }

  @Post("users")
  async createUser(@Req() req: Request, @Body() body: CreateUserInput) {
    const user = requireUser(req);

    try {
      return await this.authService.createUser(user.dataScope, user, body);
    } catch (error) {
      throw toBadRequest(error);
    }
  }

  @Patch("users/:userId")
  async updateUser(@Req() req: Request, @Param("userId") userId: string, @Body() body: UpdateUserInput) {
    const user = requireUser(req);

    try {
      return await this.authService.updateUser(user.dataScope, user, userId, body);
    } catch (error) {
      throw toBadRequest(error);
    }
  }

  @Delete("users/:userId")
  async deactivateUser(@Req() req: Request, @Param("userId") userId: string) {
    const user = requireUser(req);

    try {
      return await this.authService.deactivateUser(user.dataScope, user, userId);
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
