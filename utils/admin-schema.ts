/**
 * Payload validation for catalogue writes.
 *
 * Kept in the application rather than relying on database constraints because a
 * constraint violation reports a SQLSTATE, while these produce per-field
 * messages a form can render next to the offending input. Postgres still
 * enforces the same limits — this layer is about a usable error, not the only
 * line of defence.
 */

export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export type FieldErrors = Partial<Record<string, string>>;

export type ProductPayload = {
  name: string;
  slug: string;
  shortDescription?: string;
  details?: string[];
  material?: string;
  fit?: string;
  status: ProductStatus;
  isFeatured?: boolean;
};

export const MAX_NAME = 200;
export const MAX_SLUG = 180;
export const MAX_SHORT_DESCRIPTION = 500;

/**
 * URL-safe slug. Non-ASCII is stripped rather than transliterated so the result
 * is stable and reversible enough for a URL: two different inputs can collide
 * to the same slug, which is why the slug column is UNIQUE and the insert can
 * still conflict.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG);
}

const STATUSES: ProductStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];

/**
 * Returns a map of field -> message, empty when valid. Returning errors rather
 * than throwing keeps the call site (a route handler) a straight-line branch.
 */
export function validateProductPayload(
  input: unknown
): { errors: FieldErrors; payload: ProductPayload | null } {
  const errors: FieldErrors = {};
  if (typeof input !== 'object' || input === null) {
    return { errors: { form: 'Invalid request body' }, payload: null };
  }
  const o = input as Record<string, unknown>;

  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name) errors.name = 'Name is required';
  else if (name.length > MAX_NAME)
    errors.name = `Name must be ${MAX_NAME} characters or fewer`;

  const slug = typeof o.slug === 'string' ? o.slug.trim() : slugify(name);
  if (!slug) errors.slug = 'Slug is required';
  else if (slug.length > MAX_SLUG)
    errors.slug = `Slug must be ${MAX_SLUG} characters or fewer`;

  const shortDescription =
    typeof o.shortDescription === 'string' ? o.shortDescription.trim() : '';
  if (shortDescription.length > MAX_SHORT_DESCRIPTION)
    errors.shortDescription = `Must be ${MAX_SHORT_DESCRIPTION} characters or fewer`;

  const status = STATUSES.includes(o.status as ProductStatus)
    ? (o.status as ProductStatus)
    : 'DRAFT';

  const details = Array.isArray(o.details)
    ? o.details.filter((d): d is string => typeof d === 'string')
    : [];

  if (Object.keys(errors).length > 0) return { errors, payload: null };

  return {
    errors,
    payload: {
      name,
      slug,
      shortDescription: shortDescription || undefined,
      details,
      material: typeof o.material === 'string' ? o.material.trim() : undefined,
      fit: typeof o.fit === 'string' ? o.fit.trim() : undefined,
      status,
      isFeatured: o.isFeatured === true,
    },
  };
}