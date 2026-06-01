import { generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ci4uAuthMiddleware } from "./ci4u-auth.middleware";

describe("Ci4uAuthMiddleware", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("keeps local dev access locked to development data scope", async () => {
    process.env.CI4U_AUTH_MODE = "dev";
    const middleware = new Ci4uAuthMiddleware();
    const req = makeRequest({
      "x-ci4u-data-scope": "development",
      "x-ci4u-dev-user-id": "dev_user_1",
      "x-ci4u-dev-user-name": "Rahul Verma",
      "x-ci4u-dev-role": "SALES_MANAGER",
    });
    const res = makeResponse();
    const next = vi.fn();

    await middleware.use(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toEqual({
      id: "dev_user_1",
      name: "Rahul Verma",
      role: "SALES_MANAGER",
      dataScope: "development",
      authProvider: "dev",
    });
    expect(res.headers.get("x-ci4u-data-scope")).toBe("development");
  });

  it("rejects jwt mode requests without a bearer token", async () => {
    process.env.CI4U_AUTH_MODE = "jwt";
    process.env.CI4U_DATA_SCOPE = "production";
    process.env.CI4U_AUTH_JWKS_URL = "https://auth.example.test/.well-known/jwks.json";
    process.env.CI4U_AUTH_ISSUER = "https://auth.example.test";
    const middleware = new Ci4uAuthMiddleware();
    const req = makeRequest();
    const res = makeResponse();
    const next = vi.fn();

    await middleware.use(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      code: "AUTH_TOKEN_REQUIRED",
    });
  });

  it("validates jwt bearer tokens and assigns production scope from server config", async () => {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = {
      ...keys.publicKey.export({ format: "jwk" }),
      alg: "RS256",
      kid: "ci4u-test-key",
      use: "sig",
    };
    const jwksServer = await startJwksServer(publicJwk);
    const jwksUrl = getServerUrl(jwksServer, "/.well-known/jwks.json");
    const token = jwt.sign(
      {
        app_metadata: {
          ci4u_role: "ADMIN",
        },
        email: "admin@ci4u.test",
      },
      keys.privateKey,
      {
        algorithm: "RS256",
        audience: "ci4u-api",
        expiresIn: "5m",
        issuer: "https://auth.ci4u.test",
        keyid: "ci4u-test-key",
        subject: "auth_user_1",
      },
    );

    process.env.CI4U_AUTH_MODE = "jwt";
    process.env.CI4U_DATA_SCOPE = "production";
    process.env.CI4U_AUTH_JWKS_URL = jwksUrl;
    process.env.CI4U_AUTH_ISSUER = "https://auth.ci4u.test";
    process.env.CI4U_AUTH_AUDIENCE = "ci4u-api";

    const middleware = new Ci4uAuthMiddleware();
    const req = makeRequest({
      authorization: `Bearer ${token}`,
      "x-ci4u-data-scope": "development",
    });
    const res = makeResponse();
    const next = vi.fn();

    try {
      await middleware.use(req, res, next);
    } finally {
      await closeServer(jwksServer);
    }

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toEqual({
      id: "auth_user_1",
      name: "admin@ci4u.test",
      role: "ADMIN",
      dataScope: "production",
      authProvider: "jwt",
    });
    expect(res.headers.get("x-ci4u-data-scope")).toBe("production");
  });
});

function makeRequest(headers: Record<string, string> = {}): Request {
  return {
    headers,
    originalUrl: "/v1/leads/counts",
    path: "/v1/leads/counts",
  } as unknown as Request;
}

function makeResponse(): Response & {
  body?: unknown;
  headers: Map<string, string>;
  statusCode: number;
} {
  const response = {
    body: undefined as unknown,
    headers: new Map<string, string>(),
    statusCode: 200,
    json(body: unknown) {
      this.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
      return this;
    },
    status(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
  };

  return response as unknown as Response & {
    body?: unknown;
    headers: Map<string, string>;
    statusCode: number;
  };
}

async function startJwksServer(publicJwk: Record<string, unknown>): Promise<Server> {
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [publicJwk] }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return server;
}

function getServerUrl(server: Server, path: string): string {
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("JWKS test server did not open a TCP port.");
  }

  return `http://127.0.0.1:${(address as AddressInfo).port}${path}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
