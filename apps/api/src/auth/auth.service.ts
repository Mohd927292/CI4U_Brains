import { Injectable } from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { PrismaService } from "../database/prisma.service";
import { DataScope as DbDataScope, type Notification as DbNotification, type Role as DbRole, type User as DbUser } from "../generated/prisma/client";
import type { DataScope, RequestUser, UserRole } from "./auth.types";

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
  temporaryPassword: z.string().trim().min(8).optional(),
});

export type CreateUserInput = z.input<typeof userCreateSchema>;

export type SessionUser = {
  id: string;
  authSubject: string | null;
  name: string;
  email: string | null;
  role: UserRole;
  dataScope: DataScope;
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "DEACTIVATED";
};

export type ManagedUser = SessionUser & {
  createdAt: Date;
  updatedAt: Date;
  authProvisioning: "SUPABASE_CREATED" | "SUPABASE_INVITED" | "LOCAL_ONLY" | "SYNCED_LOGIN";
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
      return {
        id: requestUser.id,
        authSubject: requestUser.authSubject ?? requestUser.id,
        name: requestUser.name,
        email: requestUser.email ?? null,
        role: requestUser.role,
        dataScope: requestUser.dataScope,
        status: "ACTIVE",
      };
    }

    return this.syncJwtUser(requestUser);
  }

  async listUsers(dataScope: DataScope): Promise<ManagedUser[]> {
    const users = await this.prisma.user.findMany({
      where: { dataScope: toDbDataScope(dataScope) },
      include: { roles: { include: { role: true } } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });

    return users.map((user) => this.toManagedUser(user, user.roles.map((entry) => entry.role), "SYNCED_LOGIN"));
  }

  async createUser(dataScope: DataScope, actor: RequestUser, input: CreateUserInput): Promise<ManagedUser> {
    const parsed = userCreateSchema.parse(input);
    const email = parsed.email.toLowerCase();
    const role = parsed.role as UserRole;
    const now = new Date();
    const roleRecord = await this.ensureRole(role);
    const adminClient = this.getSupabaseAdminClient();
    let authSubject: string | null = null;
    let provisioning: ManagedUser["authProvisioning"] = "LOCAL_ONLY";

    if (adminClient) {
      const appMetadata = { ci4u_role: role };
      const userMetadata = { name: parsed.name };

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
      const userId = authSubject ?? existing?.id;
      const savedUser = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              ...(userId ? { id: userId } : {}),
              authProvider: authSubject ? "supabase" : existing.authProvider,
              authSubject: authSubject ?? existing.authSubject,
              name: parsed.name,
              status: authSubject && parsed.temporaryPassword ? "ACTIVE" : "INVITED",
              updatedAt: now,
            },
          })
        : await tx.user.create({
            data: {
              ...(userId ? { id: userId } : {}),
              authProvider: authSubject ? "supabase" : null,
              authSubject,
              name: parsed.name,
              email,
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
          message: `${actor.name} added you as ${roleLabels[role]}.`,
          createdAt: now,
        },
      });

      return savedUser;
    });

    return this.toManagedUser(user, [roleRecord], provisioning);
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
            })
          : null;
      const existing = existingBySubject ?? existingByEmail;

      const savedUser = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              id: authSubject,
              authProvider: "supabase",
              authSubject,
              name: requestUser.name,
              email: email ?? existing.email,
              status: "ACTIVE",
              updatedAt: now,
            },
          })
        : await tx.user.create({
            data: {
              id: authSubject,
              authProvider: "supabase",
              authSubject,
              name: requestUser.name,
              email,
              dataScope: toDbDataScope(requestUser.dataScope),
              status: "ACTIVE",
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

      return savedUser;
    });

    return this.toSessionUser(user, [roleRecord]);
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

  private toSessionUser(user: DbUser, roles: DbRole[]): SessionUser {
    const role = roleFromRecords(roles);

    return {
      id: user.id,
      authSubject: user.authSubject,
      name: user.name,
      email: user.email,
      role,
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
