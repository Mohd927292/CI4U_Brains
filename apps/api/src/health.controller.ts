import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  getHealth() {
    return {
      status: "ok",
      service: "ci4u-brains-api",
      version: "0.1.0",
    };
  }
}
