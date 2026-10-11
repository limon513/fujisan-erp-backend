import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";

const HealthStatus = z
  .object({
    status: z.enum(["ok", "degraded"]),
    database: z.enum(["up", "down"]),
    uptime: z.number().int().meta({ description: "Seconds since process start" }),
    timestamp: z.iso.datetime(),
  })
  .meta({ id: "HealthStatus" });

defineRoute({
  method: "get",
  path: "/health",
  tags: ["System"],
  summary: "Service and database status",
  response: HealthStatus,
  auth: false,
  errors: [],
});
