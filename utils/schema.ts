import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle schema — the catalogue tables this showcase actually queries.
 *
 * The production schema is considerably larger (carts, orders, returns, payment
 * disputes, email jobs, webhook events…). Those are omitted here on purpose:
 * they are core business logic and are listed under "What's intentionally
 * omitted" in the README. What is kept is the *shape* of a catalogue schema and
 * the index rationale behind it, which is the part worth reviewing.
 *
 * Note on column typing choices:
 * - Ids are declared `text` regardless of the underlying uuid/text type —
 *   Postgres casts the bound parameter automatically.
 * - `status` is a DB enum column typed via $type<> so we don't have to
 *   redeclare pgEnum values; the builder still sends plain string params that
 *   Postgres casts to the enum type.
 * - Money columns are `numeric` (Drizzle returns string, which avoids the
 *   float drift you get from JS numbers for currency).
 */
import type { ProductStatus } from './admin-schema';

// Ids are generated app-side so the same seed/insert path works on a fresh
// database with no defaults configured.
const randomId = () => crypto.randomUUID();

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(randomId),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role').$type<'admin' | 'user'>().notNull().default('user'),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable('sessions', {
  userId: text('user_id').notNull(),
  token: text('token').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const products = pgTable('products', {
  id: text('id').primaryKey().$defaultFn(randomId),
  // Length notes: Drizzle does not enforce these, Postgres does. Keeping them
  // documented next to the columns is how they stay honest across hand-written
  // migrations. `short_description` / `material` / `fit` are unlimited text —
  // an earlier varchar(50) limit truncated the prose rendered on product pages.
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  shortDescription: text('short_description'),
  details: jsonb('details').$type<string[]>(),
  material: text('material'),
  fit: text('fit'),
  status: text('status').$type<ProductStatus>().notNull().default('DRAFT'),
  isFeatured: boolean('is_featured').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const productVariants = pgTable(
  'product_variants',
  {
    id: text('id').primaryKey().$defaultFn(randomId),
    productId: text('product_id').notNull(),
    sku: text('sku'),
    color: text('color').notNull(),
    colorHex: text('color_hex'),
    size: text('size').notNull(),
    price: numeric('price', { precision: 10, scale: 2 }).notNull(),
    compareAtPrice: numeric('compare_at_price', { precision: 10, scale: 2 }),
    currency: text('currency').notNull().default('USD'),
    stockQuantity: integer('stock_quantity').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [
    uniqueIndex('product_variants_product_color_size_key').on(
      t.productId,
      t.color,
      t.size
    ),
    // Every product-page/listing subquery reads `WHERE product_id = ? AND
    // is_active` (colors, sizes, variants, total_stock and the min-price
    // LATERAL). `price` as the 3rd column lets the LATERAL's
    // `ORDER BY price ASC LIMIT 1` be satisfied by the index order, which
    // removes both the Sort and the `is_active` Filter node.
    index('idx_product_variants_product_active').on(
      t.productId,
      t.isActive,
      t.price
    ),
  ]
);

export const categories = pgTable('categories', {
  id: text('id').primaryKey().$defaultFn(randomId),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  parentId: text('parent_id'),
});

export const productCategories = pgTable('product_categories', {
  productId: text('product_id').notNull(),
  categoryId: text('category_id').notNull(),
});

export const productImages = pgTable(
  'product_images',
  {
    id: text('id').primaryKey().$defaultFn(randomId),
    productId: text('product_id').notNull(),
    // A media-provider public id in production, plus its delivered URL.
    // In the showcase this holds a local /images/*.svg path.
    publicId: text('public_id').notNull(),
    secureUrl: text('secure_url'),
    altText: text('alt_text'),
    width: integer('width'),
    height: integer('height'),
    sortOrder: integer('sort_order').notNull().default(0),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  t => [
    // The images aggregate is resolved per product on every product page
    // and every listing card. Without this the planner has no choice but a
    // seq scan on product_images (the largest of the product tables).
    index('idx_product_images_product_id').on(t.productId),
  ]
);