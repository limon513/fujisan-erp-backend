import { describe, expect, it } from "vitest";
import { z } from "zod";
import normalizeError from "#core/errors/normalizeError.js";
import AppError from "#core/errors/AppError.js";
import { buildListArgs, listQuerySchema, paginationMeta } from "#core/utils/listQuery.js";

describe("normalizeError", () => {
  it("maps zod errors to 400 with field paths", () => {
    const result = z.object({ name: z.string().min(1) }).safeParse({ name: "" });
    const error = normalizeError(result.error);
    expect(error.statusCode).toBe(400);
    expect(error.errors[0].path).toBe("name");
  });

  it("maps a unique violation (index name form) to 409 with fields", () => {
    const error = normalizeError({
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      meta: {
        modelName: "Unit",
        driverAdapterError: {
          cause: { table: "Unit", constraint: { index: "Unit_projectId_code_key" } },
        },
      },
    });
    expect(error.statusCode).toBe(409);
    expect(error.errors.map((e) => e.path)).toEqual(["projectId", "code"]);
  });

  it("passes AppError through and returns null for unknown errors", () => {
    const appError = AppError.forbidden();
    expect(normalizeError(appError)).toBe(appError);
    expect(normalizeError(new Error("boom"))).toBeNull();
  });
});

describe("listQuery", () => {
  const schema = listQuerySchema({ sortable: ["createdAt", "name"] });

  it("applies defaults and coerces numbers", () => {
    expect(schema.parse({ page: "2" })).toEqual({
      page: 2,
      limit: 20,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
  });

  it("caps the page size and rejects unknown sort fields", () => {
    expect(schema.safeParse({ limit: "500" }).success).toBe(false);
    expect(schema.safeParse({ sortBy: "password" }).success).toBe(false);
  });

  it("builds prisma args and pagination meta", () => {
    const query = schema.parse({ page: "3", limit: "10", search: "dhaka", sortBy: "name" });
    const args = buildListArgs(query, ["name", "code"]);
    expect(args).toMatchObject({ skip: 20, take: 10, orderBy: { name: "desc" } });
    expect(args.searchWhere.OR).toHaveLength(2);
    expect(paginationMeta(query, 45)).toEqual({ page: 3, limit: 10, total: 45, totalPages: 5 });
  });
});
