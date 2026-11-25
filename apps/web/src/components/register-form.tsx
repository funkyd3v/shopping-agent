'use client';

import { type RegisterInput, registerSchema } from '@shopping-agent/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, authApi } from '@/lib/api';
import {
  type FieldErrors,
  firstMessage,
  stripNestedPrefix,
  toFieldErrors,
} from '@/lib/form-errors';
import { ErrorSummary } from './error-summary';
import { TextField } from './text-field';

const addressShape = registerSchema.shape.address.shape;

const fieldSchemas = {
  name: registerSchema.shape.name,
  email: registerSchema.shape.email,
  password: registerSchema.shape.password,
  line1: addressShape.line1,
  line2: addressShape.line2,
  city: addressShape.city,
  region: addressShape.region,
  postalCode: addressShape.postalCode,
  country: addressShape.country,
} as const;

type FieldKey = keyof typeof fieldSchemas;
type Values = Record<FieldKey, string>;

const initialValues: Values = {
  name: '',
  email: '',
  password: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
};

function toInput(values: Values): RegisterInput {
  return {
    name: values.name,
    email: values.email,
    password: values.password,
    address: {
      line1: values.line1,
      line2: values.line2,
      city: values.city,
      region: values.region,
      postalCode: values.postalCode,
      country: values.country,
    },
  };
}

export function RegisterForm() {
  const router = useRouter();
  const [values, setValues] = useState<Values>(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<string>();
  const [pending, setPending] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);

  function validateField(field: FieldKey, value: string): void {
    const result = fieldSchemas[field].safeParse(value);
    setErrors((previous) => {
      const next = { ...previous };
      if (result.success) delete next[field];
      else next[field] = firstMessage(result.error.issues[0]?.message);
      return next;
    });
  }

  function handleChange(field: FieldKey, value: string): void {
    setValues((previous) => ({ ...previous, [field]: value }));
    if (errors[field]) validateField(field, value);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const parsed = registerSchema.safeParse(toInput(values));
    if (!parsed.success) {
      setErrors(stripNestedPrefix(toFieldErrors(parsed.error.issues)));
      setAlert(undefined);
      setFocusRequest((count) => count + 1);
      return;
    }

    setErrors({});
    setAlert(undefined);
    setPending(true);
    try {
      await authApi.register(parsed.data);
      router.replace('/');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
        setErrors({ email: error.message });
      } else if (error instanceof ApiError) {
        const fieldErrors = stripNestedPrefix(toFieldErrors(error.issues));
        if (Object.keys(fieldErrors).length > 0) {
          setErrors(fieldErrors);
          setAlert(undefined);
        } else {
          setAlert(error.message);
        }
      } else {
        setAlert('Unable to reach the server. Please try again.');
      }
      setFocusRequest((count) => count + 1);
    } finally {
      setPending(false);
    }
  }

  const summaryItems = Object.entries(errors).map(([fieldId, message]) => ({ fieldId, message }));

  return (
    <form noValidate onSubmit={handleSubmit} aria-busy={pending} className="space-y-6">
      <ErrorSummary items={summaryItems} message={alert} focusRequest={focusRequest} />

      <fieldset className="space-y-4">
        <legend className="mb-1 font-display text-lg font-semibold tracking-tight">Account</legend>

        <TextField
          id="name"
          label="Full name"
          autoComplete="name"
          required
          value={values.name}
          error={errors.name}
          onChange={(event) => handleChange('name', event.target.value)}
          onBlur={(event) => validateField('name', event.target.value)}
        />

        <TextField
          id="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={values.email}
          error={errors.email}
          onChange={(event) => handleChange('email', event.target.value)}
          onBlur={(event) => validateField('email', event.target.value)}
        />

        <TextField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          required
          value={values.password}
          error={errors.password}
          onChange={(event) => handleChange('password', event.target.value)}
          onBlur={(event) => validateField('password', event.target.value)}
        />
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 font-display text-lg font-semibold tracking-tight">
          Shipping address
        </legend>

        <TextField
          id="line1"
          label="Street address"
          autoComplete="address-line1"
          required
          value={values.line1}
          error={errors.line1}
          onChange={(event) => handleChange('line1', event.target.value)}
          onBlur={(event) => validateField('line1', event.target.value)}
        />

        <TextField
          id="line2"
          label="Apartment, suite, etc. (optional)"
          autoComplete="address-line2"
          value={values.line2}
          error={errors.line2}
          onChange={(event) => handleChange('line2', event.target.value)}
          onBlur={(event) => validateField('line2', event.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="city"
            label="City"
            autoComplete="address-level2"
            required
            value={values.city}
            error={errors.city}
            onChange={(event) => handleChange('city', event.target.value)}
            onBlur={(event) => validateField('city', event.target.value)}
          />

          <TextField
            id="region"
            label="State / region (optional)"
            autoComplete="address-level1"
            value={values.region}
            error={errors.region}
            onChange={(event) => handleChange('region', event.target.value)}
            onBlur={(event) => validateField('region', event.target.value)}
          />

          <TextField
            id="postalCode"
            label="Postal code"
            autoComplete="postal-code"
            required
            value={values.postalCode}
            error={errors.postalCode}
            onChange={(event) => handleChange('postalCode', event.target.value)}
            onBlur={(event) => validateField('postalCode', event.target.value)}
          />

          <TextField
            id="country"
            label="Country"
            autoComplete="country-name"
            required
            value={values.country}
            error={errors.country}
            onChange={(event) => handleChange('country', event.target.value)}
            onBlur={(event) => validateField('country', event.target.value)}
          />
        </div>
      </fieldset>

      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? 'Creating account…' : 'Create account'}
      </button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href="/login"
          className="font-medium text-accent underline underline-offset-4 hover:text-accent/80"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
