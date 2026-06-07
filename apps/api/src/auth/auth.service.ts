import { Injectable } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";
import { DataScope as DbDataScope, type Notification as DbNotification, type Role as DbRole, type User as DbUser } from "../generated/prisma/client";
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
  constructor(private readonly prisma: PrismaService) {}

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

    return users.map((user) => this.toManagedUser(user, user.roles.map((entry) => entry.role), "SYNCED_LOGIN"));
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
    const postTitle = parsed.postTitle?.trim() || defaultPostTitle(role);
    const roleTags = uniqueStrings(parsed.roleTags.length ? parsed.roleTags : defaultRoleTags(role));
    const permissions = uniquePermissions(parsed.permissions.length ? parsed.permissions : defaultPermissions(role));
    const authorityStage = parsed.authorityStage || defaultAuthorityStage(role);

    this.requireStage(actorProfile, authorityStage, "create or manage this user");

    let authSubject: string | null = null;
    let provisioning: ManagedUser["authProvisioning"] = "LOCAL_ONLY";

    if (adminClient) {
      const appMetadata = { ci4u_role: role, ci4u_permissions: permissions, ci4u_authority_stage: authorityStage };
      const userMetadata = { name: parsed.name, postTitle, roleTags };

      if (parsed.temporaryPassword) {
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password: parsed.temporaryPassword,
          email_confirm: true,
          app_metadata: appMetadata,
          user_metadata: userMetadata,
        });

        if (error) {
          throw new AuthWorkflowError(error.message, "SUPABASE_USER_CREATE_FAILED");
        }

        authSubject = data.user?.id ?? null;
        provisioning = "SUPABASE_CREATED";
      } else {
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
              ...(authSubject ? { id: authSubject } : {}),
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

      return savedUser;
    });

    return this.toManagedUser(user, [roleRecord], provisioning);
  }

  assertPermission(user: SessionUser, permission: PermissionCode): void {
    this.requirePermission(user, permission);
  }

  async deactivateUser(dataScope: DataScope, actor: RequestUser, userId: string): Promise<ManagedUser> {
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

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: "DEACTIVATED",
        updatedAt: new Date(),
      },
      include: userWithRoles,
    });

    return this.toManagedUser(updated, updated.roles.map((entry) => entry.role), "SYNCED_LOGIN");
  }

  async getUserMetrics(dataScope: DataScope, actor: RequestUser, userId: string): Promise<UserMetrics> {
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
    };
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
    const role = requestUser.role;
    const roleRecord = await this.ensureRole(role);
    const now = new Date();

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
              roleId: roleRecord.id,
              createdAt: now,
            },
          });
          return {
            ...savedUser,
            roles: [{ role: roleRecord }],
          } satisfies DbUserWithRoles;
        }

        return savedUser;
      }

      const created = await tx.user.create({
        data: {
          id: authSubject,
          authProvider: "supabase",
          authSubject,
          name: requestUser.name,
          email,
          postTitle: defaultPostTitle(role),
          roleTags: defaultRoleTags(role),
          permissionCodes: defaultPermissions(role),
          authorityStage: defaultAuthorityStage(role),
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
          roleId: roleRecord.id,
          createdAt: now,
        },
      });

      return {
        ...created,
        roles: [{ role: roleRecord }],
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

export class AuthWorkflowError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
