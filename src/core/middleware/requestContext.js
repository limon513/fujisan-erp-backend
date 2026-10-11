import { randomUUID } from "node:crypto";
import { runWithContext } from "#core/context/requestContext.js";

export default function requestContext(req, res, next) {
  const requestId = req.get("x-request-id") || randomUUID();
  req.id = requestId;
  res.setHeader("x-request-id", requestId);

  runWithContext(
    {
      requestId,
      ip: req.ip,
      userAgent: req.get("user-agent") ?? null,
    },
    next,
  );
}
