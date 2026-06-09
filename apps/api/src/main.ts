import { NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { Ci4uAuthMiddleware } from "./auth/ci4u-auth.middleware";

async function bootstrap() {
  assertSafeAuthMode();

  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  });

  app.use(createCorsMiddleware(getAllowedOrigins()));
  const authMiddleware = new Ci4uAuthMiddleware();
  app.use((req: Request, res: Response, next: NextFunction) => {
    void authMiddleware.use(req, res, next);
  });
  app.setGlobalPrefix("v1");

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
}

void bootstrap();

function assertSafeAuthMode(): void {
  const authMode = process.env.CI4U_AUTH_MODE ?? "dev";
  const isProductionRuntime = process.env.NODE_ENV === "production";
  const explicitlyAllowed = process.env.CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION === "true";

  if (authMode === "dev" && isProductionRuntime && !explicitlyAllowed) {
    throw new Error(
      "CI4U_AUTH_MODE=dev is blocked in NODE_ENV=production. Set CI4U_AUTH_MODE=supabase or jwt for real users, or set CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION=true only for a temporary development demo.",
    );
  }
}

function createCorsMiddleware(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }

    res.setHeader(
      "Access-Control-Allow-Headers",
      "authorization,content-type,x-ci4u-data-scope,x-ci4u-dev-user-id,x-ci4u-dev-user-name,x-ci4u-dev-role",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");

    if (req.method === "OPTIONS") {
      res.status(204).send();
      return;
    }

    next();
  };
}

function getAllowedOrigins(): string[] {
  const configuredOrigins = process.env.CI4U_WEB_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean);

  return configuredOrigins && configuredOrigins.length > 0
    ? configuredOrigins
    : ["http://127.0.0.1:3000", "http://localhost:3000", "http://127.0.0.1:3001", "http://localhost:3001"];
}
