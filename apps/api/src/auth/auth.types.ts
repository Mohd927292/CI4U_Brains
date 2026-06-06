export type UserRole =
  | "FOUNDER"
  | "SUPER_ADMIN"
  | "ADMIN"
  | "MANAGEMENT"
  | "SALES_HEAD"
  | "SALES_MANAGER"
  | "SALES_EXECUTIVE"
  | "OPERATIONS_HEAD"
  | "OPERATIONS_MANAGER"
  | "OPERATIONS_EXECUTIVE"
  | "VENDOR_MANAGER"
  | "ACCOUNTS_EXECUTIVE"
  | "SUPPORT_STAFF"
  | "VIEWER";

export type DataScope = "development" | "production";

export type RequestUser = {
  id: string;
  name: string;
  role: UserRole;
  dataScope: DataScope;
  authProvider: "dev" | "jwt" | "supabase";
  authSubject?: string;
  email?: string;
};

declare module "express-serve-static-core" {
  interface Request {
    user?: RequestUser;
  }
}
