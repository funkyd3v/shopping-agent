'use client';

import { loginSchema } from '@shopping-agent/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, authApi } from '@/lib/api';
import { type FieldErrors, firstMessage, toFieldErrors } from '@/lib/form-errors';
import { ErrorSummary } from './error-summary';
import { TextField } from './text-field';

const fieldSchemas = {
  email: loginSchema.shape.email,
  password: loginSchema.shape.password,
} as const;

type FieldKey = keyof typeof fieldSchemas;
type Values = Record<FieldKey, string>;

const initialValues: Values = { email: '', password: '' };

export function LoginForm() {
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
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error.issues));
      setAlert(undefined);
      setFocusRequest((count) => count + 1);
      return;
    }

    setErrors({});
    setAlert(undefined);
    setPending(true);
    try {
      await authApi.login(parsed.data);
      router.replace('/');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = toFieldErrors(error.issues);
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
    <form noValidate onSubmit={handleSubmit} aria-busy={pending} className="space-y-5">
      <ErrorSummary items={summaryItems} message={alert} focusRequest={focusRequest} />

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
        autoComplete="current-password"
        required
        value={values.password}
        error={errors.password}
        onChange={(event) => handleChange('password', event.target.value)}
        onBlur={(event) => validateField('password', event.target.value)}
      />

      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="text-center text-sm text-muted-foreground">
        New here?{' '}
        <Link
          href="/register"
          className="font-medium text-accent underline underline-offset-4 hover:text-accent/80"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
