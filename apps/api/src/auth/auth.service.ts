import { Inject, Injectable } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";
import {
  DataScope as DbDataScope,
  type Notification as DbNotification,
  Prisma,
  type Role as DbRole,
  type User as DbUser,
} from "../generated/prisma/client";
import type { DataScope, PermissionCode, RequestUser, UserRole } from "./auth.types";
import { permissionCodes } from "./auth.types";

const roleLabels: Record<UserRole, string> = {
  FOUNDER: "Founder",
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGEMENT: "Management",
  SALES_HEAD: "Sales Head",
  SALES_MANAGER: "Sales Manager",
  SALES_EXECUTIVE: "Sales Executive",
  OPERATIONS_HEAD: "Operations Head",
  OPERATIONS_MANAGER: "Operations Manager",
  OPERATIONS_EXECUTIVE: "Operations Executive",
  VENDOR_MANAGER: "Vendor Manager",
  ACCOUNTS_EXECUTIVE: "Accounts Executive",
  SUPPORT_STAFF: "Support Staff",
  VIEWER: "Viewer",
};

const permissionLabels: Record<PermissionCode, string> = {
  ADD_RAW_LEADS: "Can add raw leads",
  WORK_ON_LEADS: "Can work on leads",
  TRANSFER_LEADS: "Can transfer leads",
  SUPERVISOR: "Supervisor metrics",
  ADD_USERS: "Can add users",
  DELETE_USERS: "Can deactivate users",
};

const allAccessRoles: ReadonlySet<UserRole> = new Set(["FOUNDER", "SUPER_ADMIN"]);
const userVisibilityPermissions: ReadonlySet<PermissionCode> = new Set(["SUPERVISOR", "ADD_USERS", "DELETE_USERS"]);
const userWithRoles = {
  roles: { include: { role: true } },
} as const;

const userCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.string().trim().email("Valid email is required."),
  role: z.enum([
    "FOUNDER",
    "SUPER_ADMIN",
    "ADMIN",
    "MANAGEMENT",
    "SALES_HEAD",
    "SALES_MANAGER",
    "SALES_EXECUTIVE",
    "OPERATIONS_HEAD",
    "OPERATIONS_MANAGER",
    "OPERATIONS_EXECUTIVE",
    "VENDOR_MANAGER",
    "ACCOUNTS_EXECUTIVE",
    "SUPPORT_STAFF",
    "VIEWER",
  ]),
  postTitle: z.string().trim().min(1).optional(),
  roleTags: z.array(z.string().trim().min(1)).default([]),
  permissions: z.array(z.enum(permissionCodes)).default([]),
  authorityStage: z.coerce.number().int().min(1).max(100).default(10),
  temporaryPassword: z.string().trim().min(8).optional(),
});

export type CreateUserInput = z.input<typeof userCreateSchema>;
const userUpdateSchema = userCreateSchema.omit({ email: true }).partial();
export type UpdateUserInput = z.input<typeof userUpdateSchema>;
const userDeactivateSchema = z.object({
  actorPassword: z.string().min(1, "Confirm your password before removing staff access."),
});
export type DeactivateUserInput = z.input<typeof userDeactivateSchema>;

export type SessionUser = {
  id: string;
  authSubject: string | null;
  name: string;
  email: string | null;
  role: UserRole;
  postTitle: string | null;
  roleTags: string[];
  permissions: PermissionCode[];
  authorityStage: number;
  dataScope: DataScope;
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "DEACTIVATED";
};

export type ManagedUser = SessionUser & {
  createdAt: Date;
  updatedAt: Date;
  authProvisioning: "SUPABASE_CREATED" | "SUPABASE_INVITED" | "LOCAL_ONLY" | "SYNCED_LOGIN";
};

export type AssignableUser = {
  id: string;
  name: string;
  email: string | null;
  role: UserRole;
  postTitle: string | null;
  roleTags: string[];
  authorityStage: number;
};

export type AccessOptions = {
  roles: Array<{ value: UserRole; label: string; defaultPostTitle: string; defaultRoleTags: string[]; defaultAuthorityStage: number; defaultPermissions: PermissionCode[] }>;
  permissions: Array<{ value: PermissionCode; label: string }>;
};

export type UserMetrics = {
  userId: string;
  userName: string;
  role: UserRole;
  postTitle: string | null;
  authorityStage: number;
  leadsAdded: number;
  leadsInteracted: number;
  warmLeads: number;
  hotLeads: number;
  wonLeads: number;
  leadsAssistedHot: number;
  leadsAssistedWon: number;
  summary: StaffPerformanceSummary;
  quickRanges: {
    today: StaffPerformanceQuickRange;
    week: StaffPerformanceQuickRange;
    month: StaffPerformanceQuickRange;
  };
  dailyBreakdown: StaffDailyPerformance[];
  range: {
    from: Date;
    to: Date;
  };
};

export type StaffPerformanceRangeInput = {
  from?: string;
  to?: string;
};

export type StaffPerformanceSummary = {
  leadsAdded: number;
  leadsHandled: number;
  assists: number;
  leadsAssistedHot: number;
  leadsAssistedWon: number;
  wonLeads: number;
  hotLeadsCaptured: number;
  completeWonLeads: number;
  followUpsCompleted: number;
  followUpsMissedOrDelayed: number;
  stageMovements: number;
  quotationsHandled: number;
  siteVisitsCoordinated: number;
  warmLeadHandling: number;
  installationLeadHandling: number;
  repairServiceLeadHandling: number;
  capturedProjects: number;
  whatsappDrafts: number;
  vendorsCreated: number;
  jobsCreated: number;
  jobsAssigned: number;
  workStarted: number;
  workCompleted: number;
  activeActions: number;
  conversionRate: number;
};

export type StaffPerformanceQuickRange = Pick<StaffPerformanceSummary, "leadsHandled" | "assists" | "wonLeads" | "followUpsCompleted">;

export type StaffDailyPerformance = {
  date: string;
  leadsHandled: number;
  assists: number;
  wonLeads: number;
  followUpsCompleted: number;
  quotationsHandled: number;
  siteVisitsCoordinated: number;
};

export type LeaderboardEntry = {
  userId: string;
  userName: string;
  role: UserRole;
  postTitle: string | null;
  authorityStage: number;
  value: number;
  helper: string;
};

export type LeaderboardCategory = {
  key: string;
  label: string;
  entries: LeaderboardEntry[];
};

export type StaffLeaderboards = {
  range: {
    from: Date;
    to: Date;
  };
  categories: LeaderboardCategory[];
};

type DbUserWithRoles = DbUser & {
  roles: Array<{ role: DbRole }>;
};

export type NotificationSummary = {
  id: string;
  type: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  message: string;
  relatedId: string | null;
  read: boolean;
  createdAt: Date;
};

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getCurrentUser(requestUser: RequestUser): Promise<SessionUser> {
    if (requestUser.authProvider === "dev") {
      const role = requestUser.role;
      return {
        id: requestUser.id,
        authSubject: requestUser.authSubject ?? requestUser.id,
        name: requestUser.name,
        email: requestUser.email ?? null,
        role,
        postTitle: defaultPostTitle(role),
        roleTags: defaultRoleTags(role),
        permissions: defaultPermissions(role),
        authorityStage: defaultAuthorityStage(role),
        dataScope: requestUser.dataScope,
        status: "ACTIVE",
      };
    }

    return this.syncJwtUser(requestUser);
  }

  async listUsers(dataScope: DataScope, actor: RequestUser): Promise<ManagedUser[]> {
    const actorProfile = await this.getCurrentUser(actor);

    if (!this.hasAnyPermission(actorProfile, userVisibilityPermissions)) {
      throw new AuthWorkflowError("Your role cannot view staff users.", "ROLE_NOT_ALLOWED");
    }

    const users = await this.prisma.user.findMany({
      where: { dataScope: toDbDataScope(dataScope) },
      include: userWithRoles,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });

    return users.map((user) => this.toManagedUser(user, user.roles.map((entry) => entry.role), provisioningForUser(user)));
  }

  getAccessOptions(): AccessOptions {
    return {
      roles: (Object.keys(roleLabels) as UserRole[]).map((role) => ({
        value: role,
        label: roleLabels[role],
        defaultPostTitle: defaultPostTitle(role),
        defaultRoleTags: defaultRoleTags(role),
        defaultAuthorityStage: defaultAuthorityStage(role),
        defaultPermissions: defaultPermissions(role),
      })),
      permissions: permissionCodes.map((code) => ({
        value: code,
        label: permissionLabels[code],
      })),
    };
  }

  async listAssignableUsers(dataScope: DataScope, actor: RequestUser): Promise<AssignableUser[]> {
    const actorProfile = await this.getCurrentUser(actor);
    this.requirePermission(actorProfile, "TRANSFER_LEADS");

    const users = await this.prisma.user.findMany({
      where: {
        dataScope: toDbDataScope(dataScope),
        status: "ACTIVE",
      },
      include: userWithRoles,
      orderBy: [{ authorityStage: "desc" }, { name: "asc" }],
    });

    return users.map((user) => {
      const role = roleFromRecords(user.roles.map((entry) => entry.role));
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role,
        postTitle: user.postTitle,
        roleTags: toStringArray(user.roleTags),
        authorityStage: user.authorityStage,
      };
    });
  }

  async createUser(dataScope: DataScope, actor: RequestUser, input: CreateUserInput): Promise<ManagedUser> {
    const parsed = userCreateSchema.parse(input);
    const actorProfile = await this.getCurrentUser(actor);

    this.requirePermission(actorProfile, "ADD_USERS");

    const email = parsed.email.toLowerCase();
    const role = parsed.role as UserRole;
    const now = new Date();
    const roleRecord = await this.ensureRole(role);
    const adminClient = this.getSupabaseAdminClient();
    const emailInvitesEnabled = this.emailInvitesEnabled();
    const postTitle = parsed.postTitle?.trim() || defaultPostTitle(role);
    const roleTags = uniqueStrings(parsed.roleTags.length ? parsed.roleTags : defaultRoleTags(role));
    const permissions = uniquePermissions(parsed.permissions.length ? parsed.permissions : defaultPermissions(role));
    const authorityStage = parsed.authorityStage || defaultAuthorityStage(role);

    this.requireStage(actorProfile, authorityStage, "create or manage this user");

    if (!adminClient && dataScope === "production") {
      throw new AuthWorkflowError(
        "Staff invitation is not connected yet. Add the Supabase service-role key to the API server once, then staff invites will work from this screen.",
        "STAFF_INVITE_NOT_CONFIGURED",
      );
    }

    if (dataScope === "production" && !parsed.temporaryPassword && !emailInvitesEnabled) {
      throw new AuthWorkflowError(
        "Set a temporary password for this staff member. Email invite links are disabled until the Supabase redirect URL is fixed.",
        "TEMPORARY_PASSWORD_REQUIRED",
      );
    }

    let authSubject: string | null = null;
    let provisioning: ManagedUser["authProvisioning"] = "LOCAL_ONLY";

    if (adminClient) {
      const appMetadata = { ci4u_role: role, ci4u_permissions: permissions, ci4u_authority_stage: authorityStage };
      const userMetadata = { name: parsed.name, postTitle, roleTags };

      if (parsed.temporaryPassword) {
        authSubject = await this.createOrUpdateSupabasePasswordUser(adminClient, {
          email,
          password: parsed.temporaryPassword,
          appMetadata,
          userMetadata,
        });
        provisioning = "SUPABASE_CREATED";
      } else if (emailInvitesEnabled) {
        const redirectTo = process.env.CI4U_AUTH_INVITE_REDIRECT_URL;
        const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
          data: userMetadata,
          ...(redirectTo ? { redirectTo } : {}),
        });

        if (error) {
          throw new AuthWorkflowError(error.message, "SUPABASE_USER_INVITE_FAILED");
        }

        authSubject = data.user?.id ?? null;
        provisioning = "SUPABASE_INVITED";

        if (authSubject) {
          const { error: metadataError } = await adminClient.auth.admin.updateUserById(authSubject, {
            app_metadata: appMetadata,
          });

          if (metadataError) {
            throw new AuthWorkflowError(metadataError.message, "SUPABASE_USER_METADATA_FAILED");
          }
        }
      }
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: {
          dataScope_email: {
            dataScope: toDbDataScope(dataScope),
            email,
          },
        },
      });

      if (existing) {
        if (existing.id === actorProfile.id) {
          throw new AuthWorkflowError("You cannot change your own access from staff management.", "SELF_ACCESS_CHANGE_BLOCKED");
        }

        this.requireStage(actorProfile, existing.authorityStage, "change this existing user");
      }

      const savedUser = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              authProvider: authSubject ? "supabase" : existing.authProvider,
              authSubject: authSubject ?? existing.authSubject,
              name: parsed.name,
              postTitle,
              roleTags,
              permissionCodes: permissions,
              authorityStage,
              status: authSubject && parsed.temporaryPassword ? "ACTIVE" : "INVITED",
              updatedAt: now,
            },
          })
        : await tx.user.create({
            data: {
              authProvider: authSubject ? "supabase" : null,
              authSubject,
              name: parsed.name,
              email,
              postTitle,
              roleTags,
              permissionCodes: permissions,
              authorityStage,
              dataScope: toDbDataScope(dataScope),
              status: authSubject && parsed.temporaryPassword ? "ACTIVE" : "INVITED",
              createdAt: now,
              updatedAt: now,
            },
          });

      await tx.userRole.deleteMany({ where: { userId: savedUser.id } });
      await tx.userRole.create({
        data: {
          userId: savedUser.id,
          roleId: roleRecord.id,
          createdAt: now,
        },
      });

      await tx.notification.create({
        data: {
          dataScope: toDbDataScope(dataScope),
          userId: savedUser.id,
          type: "USER_ACCESS_CREATED",
          priority: "HIGH",
          title: "CI4U access created",
          message: `${actorProfile.name} added you as ${postTitle} (${roleLabels[role]}).`,
          createdAt: now,
        },
      });

      await tx.staffActivityEvent.create({
        data: {
          dataScope: toDbDataScope(dataScope),
          userId: actorProfile.id,
          targetUserId: savedUser.id,
          type: provisioning === "SUPABASE_INVITED" ? "STAFF_INVITED" : "STAFF_CREATED",
          summary:
            provisioning === "SUPABASE_INVITED"
              ? `${actorProfile.name} invited ${savedUser.name} as ${postTitle}.`
              : `${actorProfile.name} created ${savedUser.name} as ${postTitle}.`,
          metadata: {
            role,
            permissions,
            authorityStage,
            provisioning,
          },
          occurredAt: now,
          createdAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          dataScope: toDbDataScope(dataScope),
          actorId: actorProfile.id,
          action: existing ? "STAFF_ACCESS_REPLACED" : "STAFF_ACCESS_CREATED",
          entityType: "User",
          entityId: savedUser.id,
          before: existing
            ? {
                name: existing.name,
                postTitle: existing.postTitle,
                roleTags: existing.roleTags,
                permissionCodes: existing.permissionCodes,
                authorityStage: existing.authorityStage,
                status: existing.status,
              }
            : Prisma.JsonNull,
          after: {
            name: savedUser.name,
            postTitle: savedUser.postTitle,
            roleTags: savedUser.roleTags,
            permissionCodes: savedUser.permissionCodes,
            authorityStage: savedUser.authorityStage,
            status: savedUser.status,
          },
          metadata: {
            email,
            role,
            provisioning,
          },
          createdAt: now,
        },
      });

      return savedUser;
    });

    return this.toManagedUser(user, [roleRecord], provisioning);
  }

  async updateUser(dataScope: DataScope, actor: RequestUser, userId: string, input: UpdateUserInput): Promise<ManagedUser> {
    const parsed = userUpdateSchema.parse(input);
    const actorProfile = await this.getCurrentUser(actor);
    this.requirePermission(actorProfile, "ADD_USERS");

    if (actorProfile.id === userId) {
      throw new AuthWorkflowError("You cannot change your own access from staff management.", "SELF_ACCESS_CHANGE_BLOCKED");
    }

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: userWithRoles,
    });

    if (!target || target.dataScope !== toDbDataScope(dataScope)) {
      throw new AuthWorkflowError("User was not found.", "USER_NOT_FOUND");
    }

    this.requireStage(actorProfile, target.authorityStage, "change this user");

    const existingRole = roleFromRecords(target.roles.map((entry) => entry.role));
    const role = (parsed.role as UserRole | undefined) ?? existingRole;
    const postTitle = parsed.postTitle?.trim() || target.postTitle || defaultPostTitle(role);
    const roleTags = parsed.roleTags ? uniqueStrings(parsed.roleTags) : toStringArray(target.roleTags);
    const permissions = parsed.permissions ? uniquePermissions(parsed.permissions) : normalizePermissions(target.permissionCodes, role);
    const authorityStage = parsed.authorityStage ?? target.authorityStage;
    const now = new Date();

    this.requireStage(actorProfile, authorityStage, "set this user's authority stage");

    const adminClient = this.getSupabaseAdminClient();
    const emailInvitesEnabled = this.emailInvitesEnabled();
    let authSubject = target.authSubject;
    let authProvider = target.authProvider;
    let provisioning: ManagedUser["authProvisioning"] = provisioningForUser(target);
    let nextStatus = target.status;

    if (!adminClient && dataScope === "production" && !authSubject) {
      throw new AuthWorkflowError(
        "This staff record is not connected to login yet. Add the Supabase service-role key to the API server, then save this staff member again.",
        "STAFF_INVITE_NOT_CONFIGURED",
      );
    }

    if (adminClient && !authSubject) {
      const appMetadata = { ci4u_role: role, ci4u_permissions: permissions, ci4u_authority_stage: authorityStage };
      const userMetadata = { name: parsed.name ?? target.name, postTitle, roleTags };

      if (parsed.temporaryPassword) {
        if (!target.email) {
          throw new AuthWorkflowError("This staff record has no email, so login cannot be created.", "STAFF_EMAIL_REQUIRED");
        }

        authSubject = await this.createOrUpdateSupabasePasswordUser(adminClient, {
          email: target.email,
          password: parsed.temporaryPassword,
          appMetadata,
          userMetadata,
        });
        authProvider = authSubject ? "supabase" : authProvider;
        nextStatus = authSubject ? "ACTIVE" : nextStatus;
        provisioning = authSubject ? "SUPABASE_CREATED" : provisioning;
      } else if (target.email && emailInvitesEnabled) {
        const redirectTo = process.env.CI4U_AUTH_INVITE_REDIRECT_URL;
        const { data, error } = await adminClient.auth.admin.inviteUserByEmail(target.email, {
          data: userMetadata,
          ...(redirectTo ? { redirectTo } : {}),
        });

        if (error) {
          throw new AuthWorkflowError(error.message, "SUPABASE_USER_INVITE_FAILED");
        }

        authSubject = data.user?.id ?? null;
        authProvider = authSubject ? "supabase" : authProvider;
        provisioning = authSubject ? "SUPABASE_INVITED" : provisioning;
      }
    }

    if (adminClient && authSubject) {
      const shouldResetPassword = Boolean(parsed.temporaryPassword);
      const authUpdateInput = parsed.temporaryPassword
        ? {
            password: parsed.temporaryPassword,
            email_confirm: true,
            app_metadata: {
              ci4u_role: role,
              ci4u_permissions: permissions,
              ci4u_authority_stage: authorityStage,
            },
            user_metadata: {
              name: parsed.name ?? target.name,
              postTitle,
              roleTags,
            },
          }
        : {
            app_metadata: {
              ci4u_role: role,
              ci4u_permissions: permissions,
              ci4u_authority_stage: authorityStage,
            },
            user_metadata: {
              name: parsed.name ?? target.name,
              postTitle,
              roleTags,
            },
          };
      const { error } = await adminClient.auth.admin.updateUserById(authSubject, authUpdateInput);

      if (error) {
        throw new AuthWorkflowError(error.message, "SUPABASE_USER_METADATA_FAILED");
      }

      if (shouldResetPassword) {
        nextStatus = "ACTIVE";
        provisioning = "SUPABASE_CREATED";
      }
    } else if (dataScope === "production" && !authSubject && !parsed.temporaryPassword && !emailInvitesEnabled) {
      throw new AuthWorkflowError(
        "Set a temporary password for this staff member. Email invite links are disabled until the Supabase redirect URL is fixed.",
        "TEMPORARY_PASSWORD_REQUIRED",
      );
    }

    const roleRecord = await this.ensureRole(role);
    const updated = await this.prisma.$transaction(async (tx) => {
      const savedUser = await tx.user.update({
        where: { id: target.id },
        data: {
          authProvider,
          authSubject,
          name: parsed.name?.trim() || target.name,
          postTitle,
          roleTags,
          permissionCodes: permissions,
          authorityStage,
          status: nextStatus,
          updatedAt: now,
        },
      });

      await tx.userRole.deleteMany({ where: { userId: savedUser.id } });
      await tx.userRole.create({
        data: {
          userId: savedUser.id,
          roleId: roleRecord.id,
          createdAt: now,
        },
      });

      await tx.staffActivityEvent.create({
        data: {
          dataScope: toDbDataScope(dataScope),
          userId: actorProfile.id,
          targetUserId: savedUser.id,
          type: provisioning === "SUPABASE_INVITED" ? "STAFF_INVITED" : "STAFF_UPDATED",
          summary: `${actorProfile.name} updated ${savedUser.name}'s CI4U access.`,
          metadata: {
            role,
            postTitle,
            roleTags,
            permissions,
            authorityStage,
            provisioning,
          },
          occurredAt: now,
          createdAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          dataScope: toDbDataScope(dataScope),
          actorId: actorProfile.id,
          action: "STAFF_ACCESS_UPDATED",
          entityType: "User",
          entityId: savedUser.id,
          before: {
            name: target.name,
            postTitle: target.postTitle,
            roleTags: target.roleTags,
            permissionCodes: target.permissionCodes,
            authorityStage: target.authorityStage,
            status: target.status,
            role: existingRole,
          },
          after: {
            name: savedUser.name,
            postTitle: savedUser.postTitle,
            roleTags: savedUser.roleTags,
            permissionCodes: savedUser.permissionCodes,
            authorityStage: savedUser.authorityStage,
            status: savedUser.status,
            role,
          },
          metadata: {
            email: savedUser.email,
            provisioning,
          },
          createdAt: now,
        },
      });

      return savedUser;
    });

    return this.toManagedUser(updated, [roleRecord], provisioning);
  }

  assertPermission(user: SessionUser, permission: PermissionCode): void {
    this.requirePermission(user, permission);
  }

  async deactivateUser(dataScope: DataScope, actor: RequestUser, userId: string, input: DeactivateUserInput): Promise<ManagedUser> {
    const parsed = userDeactivateSchema.parse(input);
    const actorProfile = await this.getCurrentUser(actor);
    this.requirePermission(actorProfile, "DELETE_USERS");

    if (actorProfile.id === userId) {
      throw new AuthWorkflowError("You cannot deactivate your own account.", "SELF_DELETE_BLOCKED");
    }

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: userWithRoles,
    });

    if (!target || target.dataScope !== toDbDataScope(dataScope)) {
      throw new AuthWorkflowError("User was not found.", "USER_NOT_FOUND");
    }

    this.requireStage(actorProfile, target.authorityStage, "deactivate this user");
    await this.verifyActorPasswordForSensitiveAction(dataScope, actor, actorProfile, parsed.actorPassword);

    const adminClient = this.getSupabaseAdminClient();
    if (adminClient && target.authSubject) {
      const { error } = await adminClient.auth.admin.deleteUser(target.authSubject);

      if (error && !error.message.toLowerCase().includes("not found")) {
        throw new AuthWorkflowError(error.message, "SUPABASE_USER_DELETE_FAILED");
      }
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.user.update({
        where: { id: userId },
        data: {
          status: "DEACTIVATED",
          authProvider: null,
          authSubject: null,
          updatedAt: now,
        },
        include: userWithRoles,
      });

      await tx.notification.deleteMany({
        where: {
          dataScope: toDbDataScope(dataScope),
          userId,
          read: false,
        },
      });

      await tx.staffActivityEvent.create({
        data: {
          dataScope: toDbDataScope(dataScope),
          userId: actorProfile.id,
          targetUserId: userId,
          type: "STAFF_DEACTIVATED",
          summary: `${actorProfile.name} removed CI4U access for ${target.name}.`,
          metadata: {
            email: target.email,
            previousStatus: target.status,
            previousAuthProvider: target.authProvider,
          },
          occurredAt: now,
          createdAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          dataScope: toDbDataScope(dataScope),
          actorId: actorProfile.id,
          action: "STAFF_ACCESS_DEACTIVATED",
          entityType: "User",
          entityId: userId,
          before: {
            status: target.status,
            authProvider: target.authProvider,
            authSubject: target.authSubject,
          },
          after: {
            status: saved.status,
            authProvider: saved.authProvider,
            authSubject: saved.authSubject,
          },
          metadata: {
            email: target.email,
          },
          createdAt: now,
        },
      });

      return saved;
    });

    return this.toManagedUser(updated, updated.roles.map((entry) => entry.role), provisioningForUser(updated));
  }

  async getUserMetrics(dataScope: DataScope, actor: RequestUser, userId: string, rangeInput: StaffPerformanceRangeInput = {}): Promise<UserMetrics> {
    const actorProfile = await this.getCurrentUser(actor);
    this.requirePermission(actorProfile, "SUPERVISOR");

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: userWithRoles,
    });

    if (!target || target.dataScope !== toDbDataScope(dataScope)) {
      throw new AuthWorkflowError("User was not found.", "USER_NOT_FOUND");
    }

    this.requireStage(actorProfile, target.authorityStage, "supervise this user");

    const dbScope = toDbDataScope(dataScope);
    const now = new Date();
    const range = resolvePerformanceRange(rangeInput, now);
    const [leadsAdded, leadsInteracted, warmLeads, hotInstallation, hotRepair, wonLeads, transferredLeadRows] = await Promise.all([
      this.prisma.leadActivity.count({
        where: { dataScope: dbScope, createdById: userId, type: { in: ["LEAD_CREATED", "LEAD_IMPORTED"] } },
      }),
      this.prisma.leadActivity.count({
        where: { dataScope: dbScope, createdById: userId, type: { in: ["CALL_OUTCOME", "ARCHIVED", "WON_MARKED", "FOLLOW_UP_SCHEDULED"] } },
      }),
      this.prisma.lead.count({ where: { dataScope: dbScope, assignedToId: userId, currentStage: "WARM", isArchived: false } }),
      this.prisma.lead.count({ where: { dataScope: dbScope, assignedToId: userId, currentStage: "HOT_INSTALLATION", isArchived: false } }),
      this.prisma.lead.count({ where: { dataScope: dbScope, assignedToId: userId, currentStage: "HOT_REPAIR_SERVICE", isArchived: false } }),
      this.prisma.lead.count({ where: { dataScope: dbScope, assignedToId: userId, currentStage: "CAPTURED_WON", isArchived: false } }),
      this.prisma.leadActivity.findMany({
        where: { dataScope: dbScope, createdById: userId, type: "LEAD_TRANSFERRED" },
        select: { leadId: true },
      }),
    ]);
    const transferredLeadIds = Array.from(new Set(transferredLeadRows.map((row) => row.leadId)));
    const [leadsAssistedHot, leadsAssistedWon] = transferredLeadIds.length
      ? await Promise.all([
          this.prisma.lead.count({
            where: {
              dataScope: dbScope,
              id: { in: transferredLeadIds },
              currentStage: { in: ["HOT_INSTALLATION", "HOT_REPAIR_SERVICE"] },
            },
          }),
          this.prisma.lead.count({
            where: {
              dataScope: dbScope,
              id: { in: transferredLeadIds },
              currentStage: "CAPTURED_WON",
            },
          }),
        ])
      : [0, 0];
    const [summary, today, week, month, dailyBreakdown] = await Promise.all([
      this.buildPerformanceSummary(dbScope, userId, range.from, range.to, now),
      this.buildPerformanceSummary(dbScope, userId, startOfDay(now), now, now),
      this.buildPerformanceSummary(dbScope, userId, startOfWeek(now), now, now),
      this.buildPerformanceSummary(dbScope, userId, startOfMonth(now), now, now),
      this.buildDailyBreakdown(dbScope, userId, range.from, range.to),
    ]);

    return {
      userId: target.id,
      userName: target.name,
      role: roleFromRecords(target.roles.map((entry) => entry.role)),
      postTitle: target.postTitle,
      authorityStage: target.authorityStage,
      leadsAdded,
      leadsInteracted,
      warmLeads,
      hotLeads: hotInstallation + hotRepair,
      wonLeads,
      leadsAssistedHot,
      leadsAssistedWon,
      summary,
      quickRanges: {
        today: toQuickRange(today),
        week: toQuickRange(week),
        month: toQuickRange(month),
      },
      dailyBreakdown,
      range,
    };
  }

  async getLeaderboards(dataScope: DataScope, actor: RequestUser, rangeInput: StaffPerformanceRangeInput = {}): Promise<StaffLeaderboards> {
    const actorProfile = await this.getCurrentUser(actor);
    this.requirePermission(actorProfile, "SUPERVISOR");

    const now = new Date();
    const range = resolvePerformanceRange(rangeInput, now);
    const users = await this.prisma.user.findMany({
      where: {
        dataScope: toDbDataScope(dataScope),
        status: { not: "DEACTIVATED" },
        authorityStage: { lte: actorProfile.authorityStage },
      },
      include: userWithRoles,
      orderBy: [{ authorityStage: "desc" }, { name: "asc" }],
    });

    const rows = await Promise.all(
      users.map(async (user) => ({
        user,
        role: roleFromRecords(user.roles.map((entry) => entry.role)),
        summary: await this.buildPerformanceSummary(toDbDataScope(dataScope), user.id, range.from, range.to, now),
      })),
    );

    const makeEntries = (selector: (summary: StaffPerformanceSummary) => number, helper: (summary: StaffPerformanceSummary) => string): LeaderboardEntry[] =>
      rows
        .map(({ user, role, summary }) => ({
          userId: user.id,
          userName: user.name,
          role,
          postTitle: user.postTitle,
          authorityStage: user.authorityStage,
          value: selector(summary),
          helper: helper(summary),
        }))
        .filter((entry) => entry.value > 0)
        .sort((a, b) => b.value - a.value || b.authorityStage - a.authorityStage || a.userName.localeCompare(b.userName))
        .slice(0, 10);

    return {
      range,
      categories: [
        {
          key: "most_won_leads",
          label: "Most won leads",
          entries: makeEntries((summary) => summary.wonLeads, (summary) => `${summary.conversionRate}% conversion`),
        },
        {
          key: "most_assists",
          label: "Most assists",
          entries: makeEntries((summary) => summary.assists, (summary) => `${summary.leadsAssistedWon} assisted wins`),
        },
        {
          key: "most_hot_leads",
          label: "Most hot leads captured",
          entries: makeEntries((summary) => summary.hotLeadsCaptured, (summary) => `${summary.installationLeadHandling} install / ${summary.repairServiceLeadHandling} service`),
        },
        {
          key: "most_leads_handled",
          label: "Most leads handled",
          entries: makeEntries((summary) => summary.leadsHandled, (summary) => `${summary.activeActions} total actions`),
        },
        {
          key: "best_follow_up_completion",
          label: "Best follow-up completion",
          entries: makeEntries((summary) => summary.followUpsCompleted, (summary) => `${summary.followUpsMissedOrDelayed} overdue/open`),
        },
        {
          key: "highest_conversion",
          label: "Highest conversion performer",
          entries: makeEntries((summary) => summary.conversionRate, (summary) => `${summary.wonLeads}/${Math.max(summary.leadsHandled, 1)} handled leads`),
        },
        {
          key: "best_installation_closer",
          label: "Best installation lead closer",
          entries: makeEntries((summary) => summary.installationLeadHandling, (summary) => `${summary.hotLeadsCaptured} hot captures`),
        },
        {
          key: "best_repair_service_closer",
          label: "Best repair/service lead closer",
          entries: makeEntries((summary) => summary.repairServiceLeadHandling, (summary) => `${summary.hotLeadsCaptured} hot captures`),
        },
        {
          key: "best_warm_handler",
          label: "Best warm lead handler",
          entries: makeEntries((summary) => summary.warmLeadHandling, (summary) => `${summary.followUpsCompleted} follow-ups completed`),
        },
        {
          key: "most_quotations",
          label: "Most quotations handled",
          entries: makeEntries((summary) => summary.quotationsHandled, (summary) => `${summary.wonLeads} wins`),
        },
        {
          key: "most_site_visits",
          label: "Most site visits coordinated",
          entries: makeEntries((summary) => summary.siteVisitsCoordinated, (summary) => `${summary.wonLeads} wins`),
        },
        {
          key: "most_jobs_assigned",
          label: "Most jobs assigned",
          entries: makeEntries((summary) => summary.jobsAssigned, (summary) => `${summary.workStarted} work starts`),
        },
        {
          key: "most_work_completed",
          label: "Most work completed",
          entries: makeEntries((summary) => summary.workCompleted, (summary) => `${summary.jobsAssigned} jobs assigned`),
        },
        {
          key: "most_vendors_added",
          label: "Most vendors added",
          entries: makeEntries((summary) => summary.vendorsCreated, (summary) => `${summary.jobsAssigned} jobs assigned`),
        },
      ],
    };
  }

  private async buildPerformanceSummary(dbScope: DbDataScope, userId: string, from: Date, to: Date, now: Date): Promise<StaffPerformanceSummary> {
    const activityRange = { gte: from, lte: to };
    const [activityRows, staffActivityRows, handledLeadRows, transferRows, followUpsCompleted, followUpsMissedOrDelayed, whatsappDrafts] = await Promise.all([
      this.prisma.leadActivity.findMany({
        where: {
          dataScope: dbScope,
          createdById: userId,
          createdAt: activityRange,
        },
        select: {
          leadId: true,
          type: true,
          newStage: true,
          summary: true,
          createdAt: true,
        },
      }),
      this.prisma.staffActivityEvent.findMany({
        where: {
          dataScope: dbScope,
          userId,
          occurredAt: activityRange,
        },
        select: {
          type: true,
        },
      }),
      this.prisma.leadActivity.findMany({
        where: {
          dataScope: dbScope,
          createdById: userId,
          createdAt: activityRange,
          type: { in: ["CALL_OUTCOME", "ARCHIVED", "WON_MARKED", "FOLLOW_UP_SCHEDULED", "LEAD_TRANSFERRED"] },
        },
        distinct: ["leadId"],
        select: { leadId: true },
      }),
      this.prisma.leadActivity.findMany({
        where: {
          dataScope: dbScope,
          createdById: userId,
          createdAt: activityRange,
          type: "LEAD_TRANSFERRED",
        },
        select: { leadId: true },
      }),
      this.prisma.followUp.count({
        where: {
          dataScope: dbScope,
          assignedToId: userId,
          status: "COMPLETED",
          completedAt: activityRange,
        },
      }),
      this.prisma.followUp.count({
        where: {
          dataScope: dbScope,
          assignedToId: userId,
          status: "OPEN",
          dueAt: {
            gte: from,
            lte: now < to ? now : to,
            lt: now,
          },
        },
      }),
      this.prisma.whatsAppMessage.count({
        where: {
          dataScope: dbScope,
          sentById: userId,
          createdAt: activityRange,
        },
      }),
    ]);

    const transferredLeadIds = Array.from(new Set(transferRows.map((row) => row.leadId)));
    const [leadsAssistedHot, leadsAssistedWon] = transferredLeadIds.length
      ? await Promise.all([
          this.prisma.lead.count({
            where: {
              dataScope: dbScope,
              id: { in: transferredLeadIds },
              currentStage: { in: ["HOT_INSTALLATION", "HOT_REPAIR_SERVICE"] },
            },
          }),
          this.prisma.lead.count({
            where: {
              dataScope: dbScope,
              id: { in: transferredLeadIds },
              currentStage: "CAPTURED_WON",
            },
          }),
        ])
      : [0, 0];

    const leadsAdded = activityRows.filter((row) => row.type === "LEAD_CREATED" || row.type === "LEAD_IMPORTED").length;
    const wonLeads = activityRows.filter((row) => row.type === "WON_MARKED" || row.newStage === "CAPTURED_WON").length;
    const hotLeadsCaptured = activityRows.filter((row) => row.newStage === "HOT_INSTALLATION" || row.newStage === "HOT_REPAIR_SERVICE").length;
    const warmLeadHandling = activityRows.filter((row) => row.newStage === "WARM").length;
    const installationLeadHandling = activityRows.filter((row) => row.newStage === "HOT_INSTALLATION").length;
    const repairServiceLeadHandling = activityRows.filter((row) => row.newStage === "HOT_REPAIR_SERVICE").length;
    const stageMovements = activityRows.filter((row) => row.newStage).length;
    const quotationsHandled = activityRows.filter((row) => row.summary?.toLowerCase().includes("quotation saved")).length;
    const siteVisitsCoordinated = activityRows.filter((row) => row.summary?.toLowerCase().includes("site visit")).length;
    const countStaffEvents = (types: string[]) => staffActivityRows.filter((row) => types.includes(row.type)).length;
    const vendorsCreated = countStaffEvents(["VENDOR_CREATED"]);
    const jobsCreated = countStaffEvents(["JOB_CREATED"]);
    const jobsAssigned = countStaffEvents(["JOB_ASSIGNED"]);
    const workStarted = countStaffEvents(["WORK_STARTED"]);
    const workCompleted = countStaffEvents(["WORK_COMPLETED"]);
    const operationsActions = vendorsCreated + jobsCreated + jobsAssigned + workStarted + workCompleted;
    const activeActions = activityRows.length + followUpsCompleted + whatsappDrafts + operationsActions;
    const leadsHandled = handledLeadRows.length;
    const conversionRate = leadsHandled ? Math.round((wonLeads / leadsHandled) * 100) : 0;

    return {
      leadsAdded,
      leadsHandled,
      assists: transferredLeadIds.length,
      leadsAssistedHot,
      leadsAssistedWon,
      wonLeads,
      hotLeadsCaptured,
      completeWonLeads: wonLeads,
      followUpsCompleted,
      followUpsMissedOrDelayed,
      stageMovements,
      quotationsHandled,
      siteVisitsCoordinated,
      warmLeadHandling,
      installationLeadHandling,
      repairServiceLeadHandling,
      capturedProjects: wonLeads,
      whatsappDrafts,
      vendorsCreated,
      jobsCreated,
      jobsAssigned,
      workStarted,
      workCompleted,
      activeActions,
      conversionRate,
    };
  }

  private async buildDailyBreakdown(dbScope: DbDataScope, userId: string, from: Date, to: Date): Promise<StaffDailyPerformance[]> {
    const activityRows = await this.prisma.leadActivity.findMany({
      where: {
        dataScope: dbScope,
        createdById: userId,
        createdAt: { gte: from, lte: to },
      },
      select: {
        type: true,
        newStage: true,
        summary: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
      take: 5000,
    });
    const completedFollowUps = await this.prisma.followUp.findMany({
      where: {
        dataScope: dbScope,
        assignedToId: userId,
        status: "COMPLETED",
        completedAt: { gte: from, lte: to },
      },
      select: { completedAt: true },
      take: 5000,
    });
    const byDate = new Map<string, StaffDailyPerformance>();
    const getDay = (date: Date) => date.toISOString().slice(0, 10);
    const ensure = (date: string) => {
      const existing = byDate.get(date);
      if (existing) {
        return existing;
      }

      const created = {
        date,
        leadsHandled: 0,
        assists: 0,
        wonLeads: 0,
        followUpsCompleted: 0,
        quotationsHandled: 0,
        siteVisitsCoordinated: 0,
      };
      byDate.set(date, created);
      return created;
    };

    for (const row of activityRows) {
      const day = ensure(getDay(row.createdAt));
      if (["CALL_OUTCOME", "ARCHIVED", "WON_MARKED", "FOLLOW_UP_SCHEDULED", "LEAD_TRANSFERRED"].includes(row.type)) {
        day.leadsHandled += 1;
      }
      if (row.type === "LEAD_TRANSFERRED") {
        day.assists += 1;
      }
      if (row.type === "WON_MARKED" || row.newStage === "CAPTURED_WON") {
        day.wonLeads += 1;
      }
      if (row.summary?.toLowerCase().includes("quotation saved")) {
        day.quotationsHandled += 1;
      }
      if (row.summary?.toLowerCase().includes("site visit")) {
        day.siteVisitsCoordinated += 1;
      }
    }

    for (const followUp of completedFollowUps) {
      if (followUp.completedAt) {
        ensure(getDay(followUp.completedAt)).followUpsCompleted += 1;
      }
    }

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  async listNotifications(dataScope: DataScope, userId: string): Promise<NotificationSummary[]> {
    const notifications = await this.prisma.notification.findMany({
      where: {
        dataScope: toDbDataScope(dataScope),
        userId,
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    return notifications.map(toNotificationSummary);
  }

  async markNotificationRead(dataScope: DataScope, userId: string, notificationId: string): Promise<NotificationSummary> {
    const notification = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });

    if (notification.dataScope !== toDbDataScope(dataScope) || notification.userId !== userId) {
      throw new AuthWorkflowError("Notification was not found for this user.", "NOTIFICATION_NOT_FOUND");
    }

    return toNotificationSummary(notification);
  }

  private async syncJwtUser(requestUser: RequestUser): Promise<SessionUser> {
    const authSubject = requestUser.authSubject ?? requestUser.id;
    const email = requestUser.email?.toLowerCase() ?? null;
    const now = new Date();
    const fallbackRoleRecord = await this.ensureRole(requestUser.role);

    const user = await this.prisma.$transaction(async (tx) => {
      const existingBySubject = await tx.user.findUnique({
        where: {
          dataScope_authSubject: {
            dataScope: toDbDataScope(requestUser.dataScope),
            authSubject,
          },
        },
        include: userWithRoles,
      });
      const existingByEmail =
        !existingBySubject && email
          ? await tx.user.findUnique({
              where: {
                dataScope_email: {
                  dataScope: toDbDataScope(requestUser.dataScope),
                  email,
                },
              },
              include: userWithRoles,
            })
          : null;
      const existing = existingBySubject ?? existingByEmail;

      if (existing?.status === "SUSPENDED" || existing?.status === "DEACTIVATED") {
        throw new AuthWorkflowError("This CI4U account is not active.", "USER_NOT_ACTIVE");
      }

      const savedUser = existing
        ? await tx.user.update({
          where: { id: existing.id },
          data: {
              authProvider: "supabase",
              authSubject,
              name: requestUser.name,
              email: email ?? existing.email,
              status: "ACTIVE",
              updatedAt: now,
            },
            include: userWithRoles,
          })
        : null;

      if (savedUser) {
        if (!savedUser.roles.length) {
          await tx.userRole.create({
            data: {
              userId: savedUser.id,
              roleId: fallbackRoleRecord.id,
              createdAt: now,
            },
          });
          return {
            ...savedUser,
            roles: [{ role: fallbackRoleRecord }],
          } satisfies DbUserWithRoles;
        }

        return savedUser;
      }

      if (requestUser.role !== "FOUNDER") {
        throw new AuthWorkflowError("This email is not added as a CI4U staff member.", "USER_NOT_INVITED");
      }

      const created = await tx.user.create({
        data: {
          authProvider: "supabase",
          authSubject,
          name: requestUser.name,
          email,
          postTitle: defaultPostTitle("FOUNDER"),
          roleTags: defaultRoleTags("FOUNDER"),
          permissionCodes: defaultPermissions("FOUNDER"),
          authorityStage: defaultAuthorityStage("FOUNDER"),
          dataScope: toDbDataScope(requestUser.dataScope),
          status: "ACTIVE",
          createdAt: now,
          updatedAt: now,
        },
        include: userWithRoles,
      });

      await tx.userRole.create({
        data: {
          userId: created.id,
          roleId: fallbackRoleRecord.id,
          createdAt: now,
        },
      });

      return {
        ...created,
        roles: [{ role: fallbackRoleRecord }],
      } satisfies DbUserWithRoles;
    });

    return this.toSessionUser(user, user.roles.map((entry) => entry.role));
  }

  private async ensureRole(role: UserRole): Promise<DbRole> {
    return this.prisma.role.upsert({
      where: { code: role },
      update: {
        name: roleLabels[role],
        updatedAt: new Date(),
      },
      create: {
        code: role,
        name: roleLabels[role],
        description: `${roleLabels[role]} access role.`,
      },
    });
  }

  private getSupabaseAdminClient(): SupabaseClient | null {
    const supabaseUrl = process.env.CI4U_SUPABASE_URL;
    const serviceRoleKey = process.env.CI4U_SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return null;
    }

    return createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  private getSupabasePasswordClient(): SupabaseClient | null {
    const supabaseUrl = process.env.CI4U_SUPABASE_URL;
    const publishableKey = process.env.CI4U_SUPABASE_PUBLISHABLE_KEY ?? process.env.CI4U_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !publishableKey) {
      return null;
    }

    return createClient(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  private emailInvitesEnabled(): boolean {
    return process.env.CI4U_ENABLE_SUPABASE_EMAIL_INVITES === "true";
  }

  private async createOrUpdateSupabasePasswordUser(
    adminClient: SupabaseClient,
    input: {
      email: string;
      password: string;
      appMetadata: Record<string, unknown>;
      userMetadata: Record<string, unknown>;
    },
  ): Promise<string | null> {
    const { data, error } = await adminClient.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      app_metadata: input.appMetadata,
      user_metadata: input.userMetadata,
    });

    if (!error) {
      return data.user?.id ?? null;
    }

    if (!isSupabaseUserAlreadyRegistered(error.message)) {
      throw new AuthWorkflowError(error.message, "SUPABASE_USER_CREATE_FAILED");
    }

    const existingAuthUser = await this.findSupabaseAuthUserByEmail(adminClient, input.email);

    if (!existingAuthUser?.id) {
      throw new AuthWorkflowError(error.message, "SUPABASE_USER_CREATE_FAILED");
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(existingAuthUser.id, {
      password: input.password,
      email_confirm: true,
      app_metadata: input.appMetadata,
      user_metadata: input.userMetadata,
    });

    if (updateError) {
      throw new AuthWorkflowError(updateError.message, "SUPABASE_USER_CREATE_FAILED");
    }

    return existingAuthUser.id;
  }

  private async findSupabaseAuthUserByEmail(adminClient: SupabaseClient, email: string): Promise<{ id: string } | null> {
    const normalizedEmail = email.toLowerCase();

    for (let page = 1; page <= 10; page += 1) {
      const { data, error } = await adminClient.auth.admin.listUsers({
        page,
        perPage: 1000,
      });

      if (error) {
        throw new AuthWorkflowError(error.message, "SUPABASE_USER_LOOKUP_FAILED");
      }

      const found = data.users.find((user) => user.email?.toLowerCase() === normalizedEmail);

      if (found) {
        return { id: found.id };
      }

      if (data.users.length < 1000) {
        return null;
      }
    }

    return null;
  }

  private async verifyActorPasswordForSensitiveAction(dataScope: DataScope, requestUser: RequestUser, actor: SessionUser, actorPassword: string): Promise<void> {
    if (actor.authSubject && requestUser.authProvider === "supabase") {
      if (!actor.email) {
        throw new AuthWorkflowError("Your login email is missing, so password confirmation cannot be completed.", "PASSWORD_CONFIRMATION_NOT_CONFIGURED");
      }

      const passwordClient = this.getSupabasePasswordClient();

      if (!passwordClient) {
        throw new AuthWorkflowError("Password confirmation is not configured on the API server.", "PASSWORD_CONFIRMATION_NOT_CONFIGURED");
      }

      const { data, error } = await passwordClient.auth.signInWithPassword({
        email: actor.email,
        password: actorPassword,
      });

      await passwordClient.auth.signOut().catch(() => undefined);

      if (error || data.user?.id !== actor.authSubject) {
        throw new AuthWorkflowError("Password confirmation failed. Enter your own current CI4U login password.", "PASSWORD_CONFIRMATION_FAILED");
      }

      return;
    }

    if (dataScope === "production") {
      throw new AuthWorkflowError("Password confirmation requires a Supabase login session.", "PASSWORD_CONFIRMATION_NOT_CONFIGURED");
    }
  }

  private hasPermission(user: SessionUser, permission: PermissionCode): boolean {
    return allAccessRoles.has(user.role) || user.permissions.includes(permission);
  }

  private hasAnyPermission(user: SessionUser, permissions: ReadonlySet<PermissionCode>): boolean {
    if (allAccessRoles.has(user.role)) {
      return true;
    }

    return user.permissions.some((permission) => permissions.has(permission));
  }

  private requirePermission(user: SessionUser, permission: PermissionCode): void {
    if (!this.hasPermission(user, permission)) {
      throw new AuthWorkflowError(`Your role does not allow ${permissionLabels[permission]}.`, "PERMISSION_NOT_ALLOWED");
    }
  }

  private requireStage(actor: SessionUser, targetStage: number, action: string): void {
    if (targetStage > actor.authorityStage) {
      throw new AuthWorkflowError(`You cannot ${action} because the target stage is above your authority stage.`, "AUTHORITY_STAGE_NOT_ALLOWED");
    }
  }

  private toSessionUser(user: DbUser, roles: DbRole[]): SessionUser {
    const role = roleFromRecords(roles);

    return {
      id: user.id,
      authSubject: user.authSubject,
      name: user.name,
      email: user.email,
      role,
      postTitle: user.postTitle,
      roleTags: toStringArray(user.roleTags),
      permissions: normalizePermissions(user.permissionCodes, role),
      authorityStage: user.authorityStage,
      dataScope: toAppDataScope(user.dataScope),
      status: user.status,
    };
  }

  private toManagedUser(user: DbUser, roles: DbRole[], authProvisioning: ManagedUser["authProvisioning"]): ManagedUser {
    return {
      ...this.toSessionUser(user, roles),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      authProvisioning,
    };
  }
}

function roleFromRecords(roles: DbRole[]): UserRole {
  const role = roles.find((entry) => entry.code in roleLabels)?.code;
  return (role as UserRole | undefined) ?? "VIEWER";
}

function defaultPostTitle(role: UserRole): string {
  if (role === "FOUNDER") {
    return "BDM";
  }

  if (role === "SUPER_ADMIN") {
    return "Co-Founder / CTO";
  }

  return roleLabels[role];
}

function defaultRoleTags(role: UserRole): string[] {
  if (role === "FOUNDER") {
    return ["BDM"];
  }

  if (role === "SUPER_ADMIN") {
    return ["CO_FOUNDER", "CTO"];
  }

  return [];
}

function defaultAuthorityStage(role: UserRole): number {
  if (role === "SUPER_ADMIN") {
    return 100;
  }

  if (role === "FOUNDER") {
    return 90;
  }

  if (["ADMIN", "MANAGEMENT"].includes(role)) {
    return 80;
  }

  if (["SALES_HEAD", "OPERATIONS_HEAD"].includes(role)) {
    return 70;
  }

  if (["SALES_MANAGER", "OPERATIONS_MANAGER", "VENDOR_MANAGER"].includes(role)) {
    return 60;
  }

  if (["SALES_EXECUTIVE", "OPERATIONS_EXECUTIVE", "ACCOUNTS_EXECUTIVE", "SUPPORT_STAFF"].includes(role)) {
    return 30;
  }

  return 10;
}

function defaultPermissions(role: UserRole): PermissionCode[] {
  if (allAccessRoles.has(role)) {
    return [...permissionCodes];
  }

  if (["ADMIN", "MANAGEMENT"].includes(role)) {
    return ["ADD_RAW_LEADS", "WORK_ON_LEADS", "TRANSFER_LEADS", "SUPERVISOR", "ADD_USERS"];
  }

  if (["SALES_HEAD", "SALES_MANAGER", "OPERATIONS_HEAD", "OPERATIONS_MANAGER", "VENDOR_MANAGER"].includes(role)) {
    return ["ADD_RAW_LEADS", "WORK_ON_LEADS", "TRANSFER_LEADS", "SUPERVISOR"];
  }

  if (["SALES_EXECUTIVE", "OPERATIONS_EXECUTIVE", "SUPPORT_STAFF"].includes(role)) {
    return ["ADD_RAW_LEADS", "WORK_ON_LEADS", "TRANSFER_LEADS"];
  }

  if (role === "ACCOUNTS_EXECUTIVE") {
    return ["WORK_ON_LEADS"];
  }

  return [];
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? uniqueStrings(value.filter((item): item is string => typeof item === "string")) : [];
}

function normalizePermissions(value: unknown, role: UserRole): PermissionCode[] {
  if (allAccessRoles.has(role)) {
    return [...permissionCodes];
  }

  const fromValue = Array.isArray(value)
    ? value.filter((item): item is PermissionCode => typeof item === "string" && permissionCodes.includes(item as PermissionCode))
    : [];

  return uniquePermissions(fromValue.length ? fromValue : defaultPermissions(role));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function uniquePermissions(values: PermissionCode[]): PermissionCode[] {
  return permissionCodes.filter((permission) => values.includes(permission));
}

function toDbDataScope(dataScope: DataScope): DbDataScope {
  return dataScope === "production" ? DbDataScope.PRODUCTION : DbDataScope.DEVELOPMENT;
}

function toAppDataScope(dataScope: DbDataScope): DataScope {
  return dataScope === DbDataScope.PRODUCTION ? "production" : "development";
}

function toNotificationSummary(notification: DbNotification): NotificationSummary {
  return {
    id: notification.id,
    type: notification.type,
    priority: notification.priority,
    title: notification.title,
    message: notification.message,
    relatedId: notification.relatedId,
    read: notification.read,
    createdAt: notification.createdAt,
  };
}

function provisioningForUser(user: Pick<DbUser, "authSubject" | "status">): ManagedUser["authProvisioning"] {
  if (!user.authSubject) {
    return "LOCAL_ONLY";
  }

  return user.status === "INVITED" ? "SUPABASE_INVITED" : "SYNCED_LOGIN";
}

function isSupabaseUserAlreadyRegistered(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("already registered") || normalized.includes("already exists") || normalized.includes("user already");
}

function resolvePerformanceRange(input: StaffPerformanceRangeInput, now: Date): { from: Date; to: Date } {
  const to = input.to ? parseRangeDate(input.to, "to") : now;
  const from = input.from ? parseRangeDate(input.from, "from") : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (from > to) {
    throw new AuthWorkflowError("Performance start date cannot be after end date.", "INVALID_DATE_RANGE");
  }

  return { from, to };
}

function parseRangeDate(value: string, label: "from" | "to"): Date {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new AuthWorkflowError(`Performance ${label} date is invalid.`, "INVALID_DATE_RANGE");
  }

  return parsed;
}

function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function startOfWeek(date: Date): Date {
  const start = startOfDay(date);
  const day = start.getDay();
  const diff = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - diff);
  return start;
}

function startOfMonth(date: Date): Date {
  const start = startOfDay(date);
  start.setDate(1);
  return start;
}

function toQuickRange(summary: StaffPerformanceSummary): StaffPerformanceQuickRange {
  return {
    leadsHandled: summary.leadsHandled,
    assists: summary.assists,
    wonLeads: summary.wonLeads,
    followUpsCompleted: summary.followUpsCompleted,
  };
}

export class AuthWorkflowError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
