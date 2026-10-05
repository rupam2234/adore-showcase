import { rawQuery, sql, isDatabaseConfigured } from './db';
import {
  getDemoFacets,
  getDemoProduct,
  getDemoProducts,
  getDemoSlugs,
} from './demo-data';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import {
  CATEGORY_CHILDREN,
  CATEGORY_TREE,
  type CategoryRow,
  type CategorySlug,
} from './categories';
import type {
  ProductCardData,
  ProductCategory,
  ProductImage,
} from './product-format';
import { sortSizes } from './product-format';

export type { CategoryRow, CategorySlug, ProductCardData, ProductImage };

/**
 * The shape one product row comes back as. Everything the UI needs is already
 * assembled by SQL — see `getProductsForSection`.
 */
type ProductRow = {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  details: string[] | null;
  material: string | null;
  fit: string | null;
  is_featured: boolean;
  categories: Array<{
    slug: string;
    name: string;
    parent_slug: string | null;
  }> | null;
  price: string;
  compare_at_price: string | null;
  currency: string;
  colors: Array<{ name: string; hex: string | null }> | null;
  sizes: Array<{
    size: string;
    stock: number;
    price: string;
    compare_at_price: string | null;
  }> | null;
  variants: Array<{
    id: string;
    color: string;
    color_hex: string | null;
    size: string;
    price: string;
    compare_at_price: string | null;
    stock: number;
  }> | null;
  total_stock: number | null;
  images: Array<{
    id: string;
    public_id: string;
    alt_text: string | null;
    is_primary: boolean;
  }> | null;
};

/** Whitelisted sort options — mapped to SQL below, never interpolated raw. */
export type ProductSort = 'featured' | 'newest' | 'price-asc' | 'price-desc';

const SORT_CLAUSES: Record<ProductSort, string> = {
  featured: 'p.is_featured DESC, p.created_at DESC',
  newest: 'p.created_at DESC',
  'price-asc': 'min_active.price ASC',
  'price-desc': 'min_active.price DESC',
};

type QueryOptions = {
  /** Category slug, e.g. "dress". Parent slugs include children. */
  categorySlug?: string;
  /** Include child categories when filtering by a parent. Defaults to true. */
  includeChildren?: boolean;
  featuredOnly?: boolean;
  /** Case-insensitive search over name / short description. */
  search?: string;
  /** Result ordering (whitelisted, no user input reaches SQL raw). */
  sort?: ProductSort;
  /** Only products with an active variant in one of these colour names. */
  colors?: string[];
  /** Only products with an active variant in one of these sizes. */
  sizes?: string[];
  /** Only products with at least one in-stock variant. */
  inStockOnly?: boolean;
  /** Cheapest-variant price floor (inclusive). */
  minPrice?: number;
  /** Cheapest-variant price ceiling (inclusive). */
  maxPrice?: number;
  /** Max products to return (default 8). */
  limit?: number;
};

/**
 * Expand a category slug to itself + known children (e.g. "tops" to
 * ["tops", "t-shirts"]). Unknown slugs pass through unchanged so DB-driven
 * categories keep working without a code change.
 */
export function expandCategorySlugs(slug: string): string[] {
  const children = CATEGORY_CHILDREN[slug as CategorySlug];
  return children ? [slug, ...children] : [slug];
}

/**
 * Cache tags for the shop read models that every listing shares.
 */
export const SHOP_FACETS_TAG = 'shop-facets';
export const SHOP_CATEGORIES_TAG = 'shop-categories';

/**
 * Backstop TTL for those caches, matching app/shop/layout.tsx's ISR window: if a
 * tag invalidation is ever missed, the read model is at most this stale.
 */
const SHOP_CACHE_SECONDS = 300;

/**
 * Category slugs a query should match: a parent slug includes its children;
 * "all"/undefined means no filter. Shared by the product query and the facet
 * query so both scope identically — a facet list that disagreed with the
 * results it filters would show options that return nothing.
 */
function categorySlugsFor(
  categorySlug: string | undefined,
  includeChildren: boolean
): string[] | null {
  if (!categorySlug || categorySlug === 'all') return null;
  return includeChildren ? expandCategorySlugs(categorySlug) : [categorySlug];
}

/** `EXISTS` over the matching categories (parameterized); `TRUE` when unfiltered. */
function categoryFilterSql(slugs: string[] | null) {
  return slugs
    ? sql`EXISTS (
            SELECT 1 FROM product_categories pc
            JOIN categories c ON c.id = pc.category_id
            WHERE pc.product_id = p.id AND c.slug IN (${sql.join(
              slugs.map(s => sql`${s}`),
              sql`, `
            )}))`
    : sql`TRUE`;
}

/** Map a raw SQL row (products + variant + image aggregates) to ProductCardData. */
function mapProductRow(row: ProductRow): ProductCardData {
  const sizes = (row.sizes ?? []).map(s => {
    const raw = s as unknown as Record<string, unknown>;
    const price = (raw.price ?? row.price) as string;
    const compareAtPrice = (raw.compare_at_price ?? null) as string | null;
    return {
      size: String(raw.size),
      stock: Number(raw.stock ?? 0),
      price: String(price),
      compareAtPrice,
    };
  });
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortDescription: row.short_description,
    details: row.details ?? [],
    material: row.material,
    fit: row.fit,
    categories: (row.categories ?? []).map((c): ProductCategory => ({
      slug: c.slug,
      name: c.name,
      parentSlug: c.parent_slug,
    })),
    price: row.price,
    compareAtPrice: row.compare_at_price,
    isFeatured: row.is_featured,
    currency: row.currency,
    colors: row.colors ?? [],
    sizes,
    variants: (row.variants ?? []).map(v => ({
      id: v.id,
      color: v.color,
      colorHex: v.color_hex,
      size: v.size,
      price: v.price,
      compareAtPrice: v.compare_at_price,
      stock: Number(v.stock),
    })),
    totalStock: Number(row.total_stock ?? 0),
    images: (row.images ?? []).map((img): ProductImage => ({
      id: img.id,
      // In production this is a media-provider delivery URL built from the
      // public_id. Here the seed stores a local /images/*.svg path.
      url: img.public_id,
      alt: img.alt_text,
      isPrimary: img.is_primary,
    })),
  };
}

/**
 * Fetch products for a homepage/shop section in ONE round trip.
 *
 * THE ATOMIC QUERY MODEL
 * ----------------------
 * A product card needs images, the cheapest active price, the colour list, the
 * per-size stock, the full variant matrix and its categories. Written naively
 * that is 1 + 6 queries for a listing of N products (the classic N+1), and the
 * page only renders once every one of them has returned -- so latency is the
 * SUM, not the max.
 *
 * Instead every one of those relations is folded into the row as a scalar
 * subquery using json_agg, and the cheapest price comes from a JOIN LATERAL.
 * Postgres builds each aggregate per row of the driving table, so the whole
 * grid is one statement, one round trip, one plan.
 *
 * - No N+1: images/categories/colors/sizes/variants are all pre-aggregated.
 * - The LATERAL also filters out products with no active variant (INNER JOIN),
 *   so nothing downstream has to handle a priceless product.
 * - Price is the cheapest ACTIVE variant, which is what "from $X" means.
 * - Every filter is an EXISTS (parameterized IN list) or a parameterized
 *   ILIKE -- no user input is ever concatenated into SQL.
 */
export async function getProductsForSection(
  options: QueryOptions = {}
): Promise<ProductCardData[]> {
  const {
    categorySlug,
    includeChildren = true,
    featuredOnly = false,
    search,
    sort = 'featured',
    colors,
    sizes,
    inStockOnly = false,
    minPrice,
    maxPrice,
    limit = 8,
  } = options;

  // Demo transport: no database configured, so serve the in-memory catalogue.
  // Same read model and same filtering semantics, without needing Postgres.
  if (!isDatabaseConfigured) return getDemoProducts(options);

  const categoryFilter = categoryFilterSql(
    categorySlugsFor(categorySlug, includeChildren)
  );

  const searchPattern = search ? `%${search}%` : null;
  const searchFilter = searchPattern
    ? sql`(p.name ILIKE ${searchPattern}
        OR p.short_description ILIKE ${searchPattern})`
    : sql`TRUE`;

  const variantIn = (column: 'color' | 'size', values: string[]) =>
    sql`EXISTS (
          SELECT 1 FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active
            AND v.${sql.raw(column)} IN (${sql.join(
              values.map(v => sql`${v}`),
              sql`, `
            )}))`;

  const colorFilter = colors?.length ? variantIn('color', colors) : sql`TRUE`;
  const sizeFilter = sizes?.length ? variantIn('size', sizes) : sql`TRUE`;
  const stockFilter = inStockOnly
    ? sql`EXISTS (
          SELECT 1 FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active AND v.stock_quantity > 0)`
    : sql`TRUE`;
  const priceFilter =
    minPrice != null && maxPrice != null
      ? sql`min_active.price BETWEEN ${minPrice} AND ${maxPrice}`
      : minPrice != null
        ? sql`min_active.price >= ${minPrice}`
        : maxPrice != null
          ? sql`min_active.price <= ${maxPrice}`
          : sql`TRUE`;

  // WHITELIST before interpolating: `sort` arrives from the URL, and sql.raw()
  // is the one place in this file where text becomes SQL. It may only ever
  // receive a key of SORT_CLAUSES, never the request value itself.
  const sortClause = SORT_CLAUSES[sort] ?? SORT_CLAUSES.featured;

  const rows = await rawQuery<ProductRow>(sql`
    SELECT
      p.id,
      p.slug,
      p.name,
      p.short_description,
      p.details,
      p.material,
      p.fit,
      p.is_featured,
      (
        SELECT json_agg(
          json_build_object('slug', c.slug, 'name', c.name, 'parent_slug', parent.slug)
          ORDER BY c.slug
        )
        FROM product_categories pc
        JOIN categories c ON c.id = pc.category_id
        LEFT JOIN categories parent ON parent.id = c.parent_id
        WHERE pc.product_id = p.id
      ) AS categories,
      min_active.price AS price,
      min_active.currency AS currency,
      min_active.compare_at_price AS compare_at_price,
      (
        SELECT json_agg(
          json_build_object('name', c.name, 'hex', c.hex)
          ORDER BY c.name
        )
        FROM (
          -- DISTINCT ON keeps one row per colour while still taking the
          -- colour_hex off an arbitrary variant of that colour.
          SELECT DISTINCT ON (v.color) v.color AS name, v.color_hex AS hex
          FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active
        ) c
      ) AS colors,
      (
        SELECT json_agg(
          json_build_object('size', s.size, 'stock', s.stock, 'price', s.price, 'compare_at_price', s.compare_at_price)
          ORDER BY s.size
        )
        FROM (
          -- Roll the colour x size matrix up to one row per size: summed stock,
          -- cheapest price, and the compare-at price belonging to that
          -- cheapest variant (array_agg picks the first by price).
          SELECT v.size, SUM(v.stock_quantity) AS stock, MIN(v.price) AS price,
                 (array_agg(v.compare_at_price ORDER BY v.price ASC))[1] AS compare_at_price
          FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active
          GROUP BY v.size
        ) s
      ) AS sizes,
      (
        SELECT json_agg(
          json_build_object(
            'id', v.id,
            'color', v.color,
            'color_hex', v.color_hex,
            'size', v.size,
            'price', v.price,
            'compare_at_price', v.compare_at_price,
            'stock', v.stock_quantity
          ) ORDER BY v.color, v.size
        )
        FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active
      ) AS variants,
      (
        SELECT COALESCE(SUM(v.stock_quantity), 0)
        FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active
      ) AS total_stock,
      (
        SELECT json_agg(
          json_build_object(
            'id', pi.id,
            'public_id', pi.public_id,
            'alt_text', pi.alt_text,
            'is_primary', pi.is_primary
          ) ORDER BY pi.is_primary DESC, pi.sort_order ASC
        )
        FROM product_images pi
        WHERE pi.product_id = p.id
      ) AS images
    FROM products p
    JOIN LATERAL (
      SELECT v.price, v.currency, v.compare_at_price
      FROM product_variants v
      WHERE v.product_id = p.id AND v.is_active
      ORDER BY v.price ASC
      LIMIT 1
    ) min_active ON TRUE
    WHERE p.status = 'ACTIVE'
      AND ${categoryFilter}
      AND ${searchFilter}
      AND ${colorFilter}
      AND ${sizeFilter}
      AND ${stockFilter}
      AND ${priceFilter}
      AND (${featuredOnly} = FALSE OR p.is_featured)
    ORDER BY ${sql.raw(sortClause)}
    LIMIT ${limit}
  `);

  return rows.map(mapProductRow);
}

/**
 * Distinct colours and sizes available across active products -- the facet
 * options for the advanced filter panel.
 *
 * Facets depend on the category only, never on the active filters, so the
 * result is cached across requests: a filter click then costs one DB round
 * trip (the product query) instead of two.
 */
const fetchFilterFacets = unstable_cache(
  async (categorySlug: string) => {
    const categoryFilter = categoryFilterSql(
      categorySlugsFor(categorySlug, true)
    );

    // Postgres rejects `SELECT DISTINCT` when an ORDER BY expression is missing
    // from the select list (42P10), so the size-rank key is projected as
    // `size_rank` and referenced by its output name in ORDER BY.
    const rows = await rawQuery<{
      color: string;
      color_hex: string | null;
      size: string;
      size_rank: number;
    }>(sql`
    SELECT DISTINCT
      v.color,
      v.color_hex,
      v.size,
      CASE v.size WHEN 'XS' THEN 1 WHEN 'S' THEN 2 WHEN 'M' THEN 3 WHEN 'L' THEN 4 WHEN 'XL' THEN 5 ELSE 99 END AS size_rank
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    WHERE v.is_active AND p.status = 'ACTIVE' AND ${categoryFilter}
    ORDER BY v.color, size_rank
  `);

    const colorMap = new Map<string, string | null>();
    const sizeSet = new Set<string>();
    for (const row of rows) {
      if (!colorMap.has(row.color)) colorMap.set(row.color, row.color_hex);
      sizeSet.add(row.size);
    }

    return {
      colors: [...colorMap].map(([name, hex]) => ({ name, hex })),
      sizes: sortSizes([...sizeSet]),
    };
  },
  ['shop-filter-facets'],
  { tags: [SHOP_FACETS_TAG], revalidate: SHOP_CACHE_SECONDS }
);

export async function getFilterFacets(categorySlug?: string): Promise<{
  colors: { name: string; hex: string | null }[];
  sizes: string[];
}> {
  // "all" is the key for the unfiltered listing (categorySlugsFor maps it to
  // null, i.e. no category filter) -- the argument doubles as the cache key.
  if (!isDatabaseConfigured) return getDemoFacets(categorySlug);
  return fetchFilterFacets(categorySlug ?? 'all');
}

/**
 * Fetch a single product by slug for the product detail page.
 *
 * Wrapped in React's cache(), which memoizes per request render pass: if the
 * layout and the page both ask for the same product, the query runs once. The
 * token key is per-request, so this dedupes within a render without ever
 * serving one user's data to another.
 */
export const getProductBySlug = cache(async function getProductBySlug(
  slug: string
): Promise<ProductCardData | null> {
  if (!isDatabaseConfigured) return getDemoProduct(slug);

  // Slug is a bound parameter, never interpolated -- an attacker-controlled
  // slug cannot break out of the string literal.
  const rows = await rawQuery<ProductRow>(sql`
    SELECT
      p.id,
      p.slug,
      p.name,
      p.short_description,
      p.details,
      p.material,
      p.fit,
      p.is_featured,
      (
        SELECT json_agg(
          json_build_object('slug', c.slug, 'name', c.name, 'parent_slug', parent.slug)
          ORDER BY c.slug
        )
        FROM product_categories pc
        JOIN categories c ON c.id = pc.category_id
        LEFT JOIN categories parent ON parent.id = c.parent_id
        WHERE pc.product_id = p.id
      ) AS categories,
      min_active.price AS price,
      min_active.currency AS currency,
      min_active.compare_at_price AS compare_at_price,
      (
        SELECT json_agg(
          json_build_object('name', c.name, 'hex', c.hex) ORDER BY c.name
        )
        FROM (
          SELECT DISTINCT ON (v.color) v.color AS name, v.color_hex AS hex
          FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active
        ) c
      ) AS colors,
      (
        SELECT json_agg(
          json_build_object('size', s.size, 'stock', s.stock, 'price', s.price, 'compare_at_price', s.compare_at_price)
          ORDER BY s.size
        )
        FROM (
          SELECT v.size, SUM(v.stock_quantity) AS stock, MIN(v.price) AS price,
                 (array_agg(v.compare_at_price ORDER BY v.price ASC))[1] AS compare_at_price
          FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active
          GROUP BY v.size
        ) s
      ) AS sizes,
      (
        SELECT json_agg(
          json_build_object(
            'id', v.id,
            'color', v.color,
            'color_hex', v.color_hex,
            'size', v.size,
            'price', v.price,
            'compare_at_price', v.compare_at_price,
            'stock', v.stock_quantity
          ) ORDER BY v.color, v.size
        )
        FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active
      ) AS variants,
      (
        SELECT COALESCE(SUM(v.stock_quantity), 0)
        FROM product_variants v
        WHERE v.product_id = p.id AND v.is_active
      ) AS total_stock,
      (
        SELECT json_agg(
          json_build_object(
            'id', pi.id,
            'public_id', pi.public_id,
            'alt_text', pi.alt_text,
            'is_primary', pi.is_primary
          ) ORDER BY pi.is_primary DESC, pi.sort_order ASC
        )
        FROM product_images pi
        WHERE pi.product_id = p.id
      ) AS images
    FROM products p
    JOIN LATERAL (
      SELECT v.price, v.currency, v.compare_at_price
      FROM product_variants v
      WHERE v.product_id = p.id AND v.is_active
      ORDER BY v.price ASC
      LIMIT 1
    ) min_active ON TRUE
    WHERE p.slug = ${slug}
      AND p.status = 'ACTIVE'
    LIMIT 1
  `);

  const row = rows[0];
  return row ? mapProductRow(row) : null;
});

/**
 * Slugs of every shippable product (ACTIVE, with at least one active variant).
 *
 * Mirrors the inner `JOIN LATERAL` in `getProductBySlug`, which drops products
 * with no active variant -- so we never prerender a page that would 404.
 * Feeds `generateStaticParams` on the product route.
 */
  export async function getActiveProductSlugs(): Promise<string[]> {
  if (!isDatabaseConfigured) return getDemoSlugs();

  const rows = await rawQuery<{ slug: string }>(sql`
    SELECT p.slug
    FROM products p
    WHERE p.status = 'ACTIVE'
      AND EXISTS (
        SELECT 1
        FROM product_variants v
        WHERE v.product_id = p.id
          AND v.is_active
      )
    ORDER BY p.created_at DESC
  `);
  return rows.map(row => row.slug);
}

/**
 * Fetch every category with its parent link (for nav / filters). Cached across
 * requests: the table only changes when a product's categories are edited.
 */
const fetchCategories = unstable_cache(
  async (): Promise<CategoryRow[]> => {
    const rows = await rawQuery<CategoryRow>(sql`
    SELECT
      child.id,
      child.slug,
      child.name,
      child.description,
      parent.id AS "parentId"
    FROM categories child
    LEFT JOIN categories parent ON parent.id = child.parent_id
    ORDER BY child.slug
  `);
    return rows;
  },
  ['shop-categories'],
  { tags: [SHOP_CATEGORIES_TAG], revalidate: SHOP_CACHE_SECONDS }
);

  export async function getCategories(): Promise<CategoryRow[]> {
  if (!isDatabaseConfigured) {
    // Flatten the taxonomy for the demo transport, mirroring what the cached
    // SQL query returns.
    return CATEGORY_TREE.flatMap(parent =>
      [parent, ...(parent.children ?? [])].map(node => ({
        id: node.slug,
        slug: node.slug,
        name: node.name,
        description: node.description ?? null,
        parentId: node.slug === parent.slug ? null : parent.slug,
      }))
    );
  }

  return fetchCategories();
}


