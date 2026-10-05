export type ClassValue = string | false | null | undefined;

/** Joins the truthy class names with spaces. */
export function cx(...values: ClassValue[]): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');
}
