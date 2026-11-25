export type FieldIssue = { path: string; message: string };
export type FieldErrors = Record<string, string>;

type IssueLike = {
  path: ReadonlyArray<PropertyKey> | string;
  message: string;
};

/**
 * Collapses zod/server issues into one message per field path.
 * Zod paths are dotted (`address.line1`); server issues already arrive that way.
 */
export function toFieldErrors(issues: ReadonlyArray<IssueLike>): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = Array.isArray(issue.path) ? issue.path.map(String).join('.') : String(issue.path);
    if (key && errors[key] === undefined) errors[key] = issue.message;
  }
  return errors;
}

/** Registration errors are nested under `address.*`; fields use the leaf name as their id. */
export function stripNestedPrefix(errors: FieldErrors, prefix = 'address.'): FieldErrors {
  return Object.fromEntries(
    Object.entries(errors).map(([key, message]) => [key.replace(prefix, ''), message]),
  );
}

export function firstMessage(message: string | undefined): string {
  return message && message.trim() !== '' ? message : 'Invalid value.';
}
