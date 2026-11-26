import { z } from 'zod';

/** Trimmed optional text; empty strings normalize to `undefined` (never stored as ''). */
const optionalTrimmed = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).optional(),
  );

/** Address is required at registration (one saved address per user, PLAN §5). */
export const addressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: optionalTrimmed(200),
  city: z.string().trim().min(1).max(100),
  region: optionalTrimmed(100),
  postalCode: z.string().trim().min(1).max(20),
  country: z.string().trim().min(2).max(56),
});

export type AddressInput = z.infer<typeof addressSchema>;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'invalid email');

export const passwordSchema = z.string().min(8).max(128);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(100),
  address: addressSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const updateAddressSchema = addressSchema;

/**
 * Server-derived idempotency input for `POST /cart/checkout` (PLAN §9.3):
 * the browser generates one value per checkout click and reuses it on retry.
 */
export const clientRequestIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, 'clientRequestId must be URL-safe');

export type ClientRequestId = z.infer<typeof clientRequestIdSchema>;

/** Safe user shape returned by /auth/me and /users/me (never the hash). */
export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  createdAt: z.string(),
  address: addressSchema.nullable(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;
