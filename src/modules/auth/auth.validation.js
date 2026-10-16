import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { passwordSchema } from "#core/utils/validators.js";

const identifier = z
  .string()
  .trim()
  .min(3)
  .max(150)
  .meta({ description: "Username, email or mobile number", example: "superadmin" });

const login = z.object({
  identifier,
  password: z.string().min(1).max(128),
  deviceName: z.string().trim().max(100).optional().meta({ example: "Chrome on Windows" }),
});

const changePassword = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  })
  .refine((body) => body.currentPassword !== body.newPassword, {
    path: ["newPassword"],
    message: "New password must be different from the current password",
  });

const forgotPassword = z.object({ identifier });

const resetPassword = z.object({
  identifier,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Code must be 6 digits"),
  newPassword: passwordSchema,
});

const sessionParams = z.object({ id: z.uuid() });

const loginHistoryQuery = listQuerySchema({ sortable: ["createdAt"] });

export const AuthValidation = {
  login,
  changePassword,
  forgotPassword,
  resetPassword,
  sessionParams,
  loginHistoryQuery,
};
