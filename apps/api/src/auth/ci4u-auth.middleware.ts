import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import jwt, { type Algorithm, type JwtPayload } from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import type { DataScope, UserRole } from "./auth.types";

const allowedRoles: ReadonlySet<UserRole> = new Set([
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
]);

const jwtAlgorithms: Algorithm[] = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"];
const jwksClients = new Map<string, jwksClient.JwksClient>();

@Injectable()
export class Ci4uAuthMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (isHealthRoute(req)) {
      next();
      return;
    }

    const authMode = process.env.CI4U_AUTH_MODE ?? "dev";

    if (authMode === "dev") {
      this.handleDevAuth(req, res, next);
      return;
    }

    if (authMode === "jwt") {
      await this.handleJwtAuth(req, res, next);
      return;
    }

    res.status(503).json({
      code: "AUTH_MODE_INVALID",
      message: "CI4U_AUTH_MODE must be either dev or jwt.",
    });
  }

  private handleDevAuth(req: Request, res: Response, next: NextFunction): void {
    const dataScope = getHeader(req, "x-ci4u-data-scope");
    const userId = getHeader(req, "x-ci4u-dev-user-id");
    const userName = getHeader(req, "x-ci4u-dev-user-name");
    const role = getHeader(req, "x-ci4u-dev-role");

    if (dataScope !== "development") {
      res.status(401).json({
        code: "DEV_DATA_SCOPE_REQUIRED",
        message: "Dev auth requires x-ci4u-data-scope=development so test data cannot be confused with production.",
      });
      return;
    }

    if (!userId || !userName || !isUserRole(role)) {
      res.status(401).json({
        code: "DEV_AUTH_REQUIRED",
        message: "Use the CI4U dev login to access development-only API data.",
      });
      return;
    }

    req.user = {
      id: userId,
      name: userName,
      role,
      dataScope: "development",
      authProvider: "dev",
    };
    res.setHeader("x-ci4u-data-scope", "development");
    next();
  }

  private async handleJwtAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = getHeader(req, "authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({
        code: "AUTH_TOKEN_REQUIRED",
        message: "Production auth requires an Authorization: Bearer token.",
      });
      return;
    }

    const jwksUrl = process.env.CI4U_AUTH_JWKS_URL;
    const issuer = process.env.CI4U_AUTH_ISSUER;
    const audience = process.env.CI4U_AUTH_AUDIENCE;
    const dataScope = parseConfiguredDataScope(process.env.CI4U_DATA_SCOPE ?? "production");

    if (!jwksUrl || !issuer || !dataScope) {
      res.status(503).json({
        code: "AUTH_CONFIG_REQUIRED",
        message: "JWT auth requires CI4U_AUTH_JWKS_URL, CI4U_AUTH_ISSUER, and a valid CI4U_DATA_SCOPE.",
      });
      return;
    }

    try {
      const token = authHeader.slice("Bearer ".length).trim();
      const verifyOptions = audience
        ? {
            jwksUrl,
            issuer,
            audience,
          }
        : {
            jwksUrl,
            issuer,
          };
      const payload = await verifyJwt(token, verifyOptions);
      const userId = typeof payload.sub === "string" ? payload.sub : null;

      if (!userId) {
        res.status(401).json({
          code: "AUTH_SUBJECT_REQUIRED",
          message: "The auth token is valid but does not contain a user subject.",
        });
        return;
      }

      req.user = {
        id: userId,
        name: getJwtDisplayName(payload),
        role: getJwtUserRole(payload),
        dataScope,
        authProvider: "jwt",
      };
      res.setHeader("x-ci4u-data-scope", dataScope);
      next();
    } catch {
      res.status(401).json({
        code: "AUTH_TOKEN_INVALID",
        message: "The auth token is missing, expired, or not trusted by this CI4U API environment.",
      });
    }
  }
}

function isHealthRoute(req: Request): boolean {
  return req.path === "/v1/health" || req.path === "/health" || req.originalUrl === "/v1/health";
}

function getHeader(req: Request, name: string): string | null {
  const value = req.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function isUserRole(role: string | null): role is UserRole {
  return Boolean(role && allowedRoles.has(role as UserRole));
}

function parseConfiguredDataScope(value: string): DataScope | null {
  return value === "development" || value === "production" ? value : null;
}

function getJwtUserRole(payload: JwtPayload): UserRole {
  const roleClaimPath = process.env.CI4U_AUTH_ROLE_CLAIM ?? "app_metadata.ci4u_role";
  const claimValue = getClaimByPath(payload, roleClaimPath);

  return typeof claimValue === "string" && isUserRole(claimValue) ? claimValue : "VIEWER";
}

function getJwtDisplayName(payload: JwtPayload): string {
  const name = payload.name ?? payload.email ?? payload.phone;
  return typeof name === "string" && name.trim() ? name : "Authenticated User";
}

function getClaimByPath(payload: JwtPayload, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }

    return undefined;
  }, payload);
}

async function verifyJwt(
  token: string,
  options: {
    jwksUrl: string;
    issuer: string;
    audience?: string;
  },
): Promise<JwtPayload> {
  const decoded = jwt.decode(token, { complete: true });

  if (!decoded || typeof decoded !== "object" || typeof decoded.header.kid !== "string") {
    throw new Error("JWT missing key id.");
  }

  const publicKey = await getSigningKey(options.jwksUrl, decoded.header.kid);
  const verifyOptions: jwt.VerifyOptions = {
    algorithms: jwtAlgorithms,
    issuer: options.issuer,
  };

  if (options.audience) {
    verifyOptions.audience = options.audience;
  }

  const verified = jwt.verify(token, publicKey, verifyOptions);

  if (!verified || typeof verified === "string") {
    throw new Error("JWT payload is not an object.");
  }

  return verified;
}

async function getSigningKey(jwksUrl: string, keyId: string): Promise<string> {
  const client = getJwksClient(jwksUrl);
  const key = await client.getSigningKey(keyId);
  return key.getPublicKey();
}

function getJwksClient(jwksUrl: string): jwksClient.JwksClient {
  const existing = jwksClients.get(jwksUrl);

  if (existing) {
    return existing;
  }

  const client = jwksClient({
    cache: true,
    cacheMaxEntries: 5,
    cacheMaxAge: 10 * 60 * 1000,
    jwksUri: jwksUrl,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });
  jwksClients.set(jwksUrl, client);
  return client;
}
