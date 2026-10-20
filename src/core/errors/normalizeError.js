import { StatusCodes } from "http-status-codes";
import { ZodError } from "zod";
import AppError from "./AppError.js";

const fromZod = (error) =>
  AppError.badRequest(
    "Validation failed",
    error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  );

// With the pg driver adapter the violated constraint arrives either as field names or as the
// index name ("Unit_projectId_code_key") — return the field names either way.
const uniqueFields = (meta) => {
  const constraint = meta?.driverAdapterError?.cause?.constraint;
  if (constraint?.fields) return constraint.fields;
  if (constraint?.index) {
    const table = meta.driverAdapterError.cause.table ?? meta.modelName ?? "";
    return [constraint.index.replace(`${table}_`, "").replace(/_key$/, "").replace(/_/g, ", ")];
  }
  return meta?.target ?? [];
};

// https://www.prisma.io/docs/orm/reference/error-reference
const fromPrisma = (error) => {
  switch (error.code) {
    case "P2002": {
      const fields = [].concat(uniqueFields(error.meta)).join(", ");
      return AppError.conflict(
        fields ? `Duplicate value for: ${fields}` : "Duplicate value",
        fields ? fields.split(", ").map((path) => ({ path, message: "Already exists" })) : [],
      );
    }
    case "P2025":
      return AppError.notFound(error.meta?.cause ?? "Record not found");
    case "P2003":
      return AppError.conflict("Operation blocked by a related record");
    default:
      return null;
  }
};

/** Converts any thrown value into an AppError (or null when it's an unexpected error). */
export default function normalizeError(error) {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) return fromZod(error);
  if (error?.name === "PrismaClientKnownRequestError") return fromPrisma(error);
  if (error?.name === "MulterError") {
    return error.code === "LIMIT_FILE_SIZE"
      ? new AppError(StatusCodes.REQUEST_TOO_LONG, "File is too large", [
          { path: "file", message: "File is too large" },
        ])
      : AppError.badRequest(error.message, [
          { path: error.field ?? "file", message: error.message },
        ]);
  }
  if (error?.type === "entity.parse.failed") return AppError.badRequest("Malformed JSON body");
  if (error?.type === "entity.too.large") {
    return new AppError(StatusCodes.REQUEST_TOO_LONG, "Request body too large");
  }
  return null;
}
