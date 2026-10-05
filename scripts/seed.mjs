/**
 * Seed the showcase database with mock catalogue data.
 *
 *   npm run seed
 *
 * Everything this script writes is FAKE: invented product names, invented
 * descriptions, generated SVG placeholders, and one demo account with a
 * published password. No production data, no real assets, no real addresses.
 *
 * The script is idempotent -- it truncates the catalogue tables and re-inserts,
 * so running it twice leaves the same state. Run it against a scratch database
 * only; it WILL delete rows.
 */

import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Plain `node` does not load .env.local the way Next.js does, so read it here.
function loadEnvFile() {
  try {
    const raw = readFileSync('.env.local', 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
      const value = m[2].replace(/^["']|["']$/g, '');
      if (!process.env[m[1]]) process.env[m[1]] = value;
    }
  } catch {
    // No .env.local -- assume DATABASE_URL is already exported.
  }
}
loadEnvFile();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.'
  );
  process.exit(1);
}

const sql = neon(url);

// -- Mock catalogue definitions --------------------------------------------
//
// Names are deliberately generic. Categories must match utils/categories.ts,
// which is what the sidebar and the filter queries read.

const CATEGORIES = [
  { slug: 'tops', name: 'Tops', parent: null },
  { slug: 't-shirts', name: 'T-Shirts', parent: 'tops' },
  { slug: 'blouses', name: 'Blouses', parent: 'tops' },
  { slug: 'bottoms', name: 'Bottoms', parent: null },
  { slug: 'trousers', name: 'Trousers', parent: 'bottoms' },
  { slug: 'skirts', name: 'Skirts', parent: 'bottoms' },
  { slug: 'dresses', name: 'Dresses', parent: null },
  { slug: 'midi-dresses', name: 'Midi Dresses', parent: 'dresses' },
  { slug: 'outerwear', name: 'Outerwear', parent: null },
  { slug: 'accessories', name: 'Accessories', parent: null },
];

const COLORS = [
  { name: 'Black', hex: '#1c1c1c' },
  { name: 'Ivory', hex: '#f4f0e6' },
  { name: 'Sage', hex: '#9aa88f' },
  { name: 'Clay', hex: '#b4796a' },
  { name: 'Navy', hex: '#2b3a55' },
  { name: 'Sand', hex: '#d9c7a7' },
];

const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

const MATERIALS = [
  'Cotton',
  'Linen blend',
  'Merino wool',
  'Recycled polyester',
  'Tencel',
];

const FITS = ['Regular', 'Relaxed', 'Slim', 'Oversized', 'Cropped'];

/** Invented catalogue of 20 items. */
const PRODUCTS = [
  { name: 'Placeholder Linen Shirt', category: 'blouses', price: 68, featured: true },
  { name: 'Sample Everyday Tee', category: 't-shirts', price: 24, featured: true },
  { name: 'Mock Knit Cardigan', category: 'blouses', price: 92, featured: false },
  { name: 'Example Wrap Dress', category: 'dresses', price: 118, featured: true },
  { name: 'Demo Pleated Midi', category: 'midi-dresses', price: 134, featured: false },
  { name: 'Test Wide-Leg Trouser', category: 'trousers', price: 88, featured: false },
  { name: 'Sample A-Line Skirt', category: 'skirts', price: 62, featured: false },
  { name: 'Placeholder Trench Coat', category: 'outerwear', price: 195, featured: true },
  { name: 'Demo Wool Scarf', category: 'accessories', price: 34, featured: false },
  { name: 'Sample Cotton Blouse', category: 'blouses', price: 58, featured: false },
  { name: 'Mock Striped Tee', category: 't-shirts', price: 29, featured: false },
  { name: 'Example Denim Jacket', category: 'outerwear', price: 142, featured: false },
  { name: 'Test Slip Dress', category: 'dresses', price: 108, featured: true },
  { name: 'Sample Pleated Skirt', category: 'skirts', price: 66, featured: false },
  { name: 'Placeholder Jogger', category: 'bottoms', price: 72, featured: false },
  { name: 'Demo Satin Blouse', category: 'blouses', price: 84, featured: false },
  { name: 'Mock Graphic Tee', category: 't-shirts', price: 26, featured: false },
  { name: 'Example Wrap Skirt', category: 'skirts', price: 59, featured: false },
  { name: 'Test Quilted Vest', category: 'outerwear', price: 118, featured: false },
  { name: 'Sample Wool Beanie', category: 'accessories', price: 28, featured: false },
];

/**
 * Deterministic pseudo-random in [0,1).
 *
 * A fixed seed means re-running the script produces the SAME catalogue --
 * colour/size/stock assignment, image tints and all. That makes screenshots and
 * the README reproducible, and it means a diff of the output tells you the
 * generator changed rather than that the random draw did.
 */
function makeRng(seed = 42) {
  let state = seed >>> 0;
  return () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng();
const pick = arr => arr[Math.floor(rng() * arr.length)];

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Rough garment outlines per category, purely to give the grid variety. */
function silhouette(category, W, H) {
  const cx = W / 2;
  if (category === 't-shirts' || category === 'blouses')
    return `<path d="M${cx - 110} 250 L${cx - 30} 205 L${cx} 230 L${cx + 30} 205 L${cx + 110} 250 L${cx + 80} 320 L${cx + 62} 300 L${cx + 62} 590 L${cx - 62} 590 L${cx - 62} 300 L${cx - 80} 320 Z"/>`;
  if (category === 'trousers' || category === 'bottoms')
    return `<path d="M${cx - 70} 220 L${cx + 70} 220 L${cx + 86} 620 L${cx + 16} 620 L${cx} 380 L${cx - 16} 620 L${cx - 86} 620 Z"/>`;
  if (category === 'skirts')
    return `<path d="M${cx - 62} 240 L${cx + 62} 240 L${cx + 110} 560 L${cx - 110} 560 Z"/>`;
  if (category === 'outerwear')
    return `<path d="M${cx - 120} 230 L${cx - 34} 190 L${cx} 220 L${cx + 34} 190 L${cx + 120} 230 L${cx + 96} 600 L${cx - 96} 600 Z"/>`;
  if (category === 'accessories')
    return `<circle cx="${cx}" cy="340" r="96"/><path d="M${cx - 96} 340 L${cx + 96} 340"/>`;
  // dresses / midi-dresses
  return `<path d="M${cx - 52} 210 L${cx + 52} 210 L${cx + 66} 330 L${cx + 108} 620 L${cx - 108} 620 L${cx - 66} 330 Z"/>`;
}

function escapeXml(s) {
  return s.replace(
    /[<>&'"]/g,
    c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[
        c
      ]
  );
}

/**
 * Generate a neutral placeholder image as an SVG.
 *
 * Deliberately NOT a real photograph: no brand assets and no third-party
 * images are reproduced. The seed varies hue and the garment silhouette by
 * category so the grid reads as varied, and labels the image as a placeholder
 * so nobody mistakes it for product photography.
 */
function placeholderSvg({ name, category, tint }) {
  const W = 600;
  const H = 800;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Placeholder image">
  <rect width="${W}" height="${H}" fill="${tint}"/>
  <g fill="none" stroke="#2B2620" stroke-opacity="0.28" stroke-width="6" stroke-linejoin="round">
    ${silhouette(category, W, H)}
  </g>
  <text x="${W / 2}" y="${H - 96}" text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="#2B2620" fill-opacity="0.72">${escapeXml(name)}</text>
  <text x="${W / 2}" y="${H - 56}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="19" fill="#2B2620" fill-opacity="0.5">placeholder -- not a real product</text>
</svg>
`;
}

const TINTS = ['#e9e2d6', '#dfe5dc', '#e8ded9', '#e2e0ea', '#dfe7ea', '#efe6d9'];

async function main() {
  console.log('Seeding showcase data...');

  // -- Schema --------------------------------------------------------------
  // Plain DDL rather than migrations: this is a demo fixture, and the point is
  // that `npm run seed` works on an empty database with no extra steps. The
  // definitions match utils/schema.ts.
  await sql`
    CREATE TABLE IF NOT EXISTS categories (
      id          text PRIMARY KEY,
      slug        text NOT NULL UNIQUE,
      name        text NOT NULL,
      description text,
      parent_id   text
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id                 text PRIMARY KEY,
      name               text NOT NULL,
      slug               text NOT NULL UNIQUE,
      short_description  text,
      details            jsonb,
      material           text,
      fit                text,
      status             text NOT NULL DEFAULT 'DRAFT',
      is_featured        boolean NOT NULL DEFAULT false,
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS product_variants (
      id                text PRIMARY KEY,
      product_id        text NOT NULL,
      sku               text,
      color             text NOT NULL,
      color_hex         text,
      size              text NOT NULL,
      price             numeric(10,2) NOT NULL,
      compare_at_price  numeric(10,2),
      currency          text NOT NULL DEFAULT 'USD',
      stock_quantity    integer NOT NULL DEFAULT 0,
      is_active         boolean NOT NULL DEFAULT true,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT product_variants_product_color_size_key
        UNIQUE (product_id, color, size)
    )`;

  // Matches the composite index declared in utils/schema.ts: the listing's
  // `WHERE product_id = ? AND is_active` plus `ORDER BY price ASC LIMIT 1`
  // are both satisfied by this index order, removing a Sort node.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_product_variants_product_active
      ON product_variants (product_id, is_active, price)`;

  await sql`
    CREATE TABLE IF NOT EXISTS product_categories (
      product_id  text NOT NULL,
      category_id text NOT NULL
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS product_images (
      id          text PRIMARY KEY,
      product_id  text NOT NULL,
      public_id   text NOT NULL,
      secure_url  text,
      alt_text    text,
      width       integer,
      height      integer,
      sort_order  integer NOT NULL DEFAULT 0,
      is_primary  boolean NOT NULL DEFAULT false
    )`;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_product_images_product_id
      ON product_images (product_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            text PRIMARY KEY,
      email         text NOT NULL UNIQUE,
      name          text NOT NULL,
      role          text NOT NULL DEFAULT 'user',
      password_hash text NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      user_id    text NOT NULL,
      token      text PRIMARY KEY,
      expires_at timestamptz NOT NULL
    )`;

  // -- Reset ---------------------------------------------------------------
  await sql`DELETE FROM sessions`;
  await sql`DELETE FROM product_images`;
  await sql`DELETE FROM product_categories`;
  await sql`DELETE FROM product_variants`;
  await sql`DELETE FROM products`;
  await sql`DELETE FROM categories`;

  // -- Categories ----------------------------------------------------------
  const categoryIds = new Map();
  for (const c of CATEGORIES.filter(c => !c.parent)) {
    const id = randomUUID();
    categoryIds.set(c.slug, id);
    await sql`INSERT INTO categories (id, slug, name) VALUES (${id}, ${c.slug}, ${c.name})`;
  }
  for (const c of CATEGORIES.filter(c => c.parent)) {
    const id = randomUUID();
    categoryIds.set(c.slug, id);
    await sql`
      INSERT INTO categories (id, slug, name, parent_id)
      VALUES (${id}, ${c.slug}, ${c.name}, ${categoryIds.get(c.parent)})`;
  }
  console.log(`  categories: ${categoryIds.size}`);

  const imageDir = join(process.cwd(), 'public', 'images');
  mkdirSync(imageDir, { recursive: true });

  // -- Products -----------------------------------------------------------
  let variantCount = 0;
  for (const [i, p] of PRODUCTS.entries()) {
    const id = randomUUID();
    const slug = slugify(p.name);
    const tint = TINTS[i % TINTS.length];

    // Two placeholder angles per product, primary first.
    const imageUrls = [];
    for (let n = 0; n < 2; n++) {
      const file = `placeholder-${slug}-${n + 1}.svg`;
      const svg = placeholderSvg({
        name: p.name,
        category: p.category,
        tint: n === 0 ? tint : TINTS[(i + 3) % TINTS.length],
      });
      writeFileSync(join(imageDir, file), svg, 'utf8');
      imageUrls.push(`/images/${file}`);
    }

    // Stagger created_at so "newest" ordering is deterministic and the
    // featured/newest sections differ.
    const createdAt = new Date(
      Date.now() - (PRODUCTS.length - i) * 86_400_000
    );

    await sql`
      INSERT INTO products
        (id, name, slug, short_description, details, material, fit, status, is_featured, created_at, updated_at)
      VALUES (
        ${id},
        ${p.name},
        ${slug},
        ${`Placeholder ${p.category.replace('-', ' ')} sample product used to demonstrate the catalogue read model.`},
        ${JSON.stringify([
          'Sample item -- placeholder content only',
          'Fabric and care details are illustrative',
          'No real product is represented here',
        ])},
        ${pick(MATERIALS)},
        ${pick(FITS)},
        ${'ACTIVE'},
        ${p.featured},
        ${createdAt.toISOString()},
        ${createdAt.toISOString()}
      )`;

    await sql`
      INSERT INTO product_categories (product_id, category_id)
      VALUES (${id}, ${categoryIds.get(p.category)})`;

    for (const [n, imageUrl] of imageUrls.entries()) {
      await sql`
        INSERT INTO product_images
          (id, product_id, public_id, secure_url, alt_text, width, height, sort_order, is_primary)
        VALUES (
          ${randomUUID()}, ${id}, ${imageUrl}, ${null},
          ${`Placeholder illustration for ${p.name}`},
          600, 800, ${n}, ${n === 0}
        )`;
    }

    // Variants: 2 colours x the size run, so the size rollup and the
    // cheapest-active-price LATERAL both have something to do.
    const chosenColors = [...COLORS].sort(() => rng() - 0.5).slice(0, 2);
    const sizes = SIZES.slice(0, 3 + Math.floor(rng() * 3));

    for (const color of chosenColors) {
      for (const size of sizes) {
        // A small deterministic spread, so "from $X" differs from variant to
        // variant and the cheapest-variant logic is actually exercised.
        const price = (p.price + Math.round(rng() * 20 - 10)).toFixed(2);
        const onSale = rng() < 0.3;
        const compareAt = onSale ? (Number(price) + 15).toFixed(2) : null;
        await sql`
          INSERT INTO product_variants
            (id, product_id, sku, color, color_hex, size, price, compare_at_price, currency, stock_quantity, is_active)
          VALUES (
            ${randomUUID()}, ${id},
            ${`SKU-${slug.toUpperCase().slice(0, 12)}-${color.name.slice(0, 3).toUpperCase()}-${size}`},
            ${color.name}, ${color.hex}, ${size},
            ${price}, ${compareAt}, ${'USD'},
            ${Math.floor(rng() * 14)},
            ${true}
          )`;
        variantCount++;
      }
    }

    process.stdout.write(`  product ${i + 1}/${PRODUCTS.length}: ${p.name}\n`);
  }
  console.log(`  products: ${PRODUCTS.length}, variants: ${variantCount}`);

  // -- Demo user ----------------------------------------------------------
  // The password is deliberately published in the README: this account is a
  // fixture for a sandbox database, and a hard-to-guess password here would
  // only make the showcase harder to evaluate.
  const DEMO_PASSWORD = 'showcase-demo-password';
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await sql`
    INSERT INTO users (id, email, name, role, password_hash)
    VALUES (
      ${randomUUID()}, 'demo@example.com', 'Demo User', 'user', ${passwordHash}
    )
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`;

  console.log(`
Done.

  Demo login   demo@example.com / ${DEMO_PASSWORD}
  Products     ${PRODUCTS.length} (all ACTIVE)
  Images       ${PRODUCTS.length * 2} generated SVGs in public/images/

Run \`npm run dev\` and open http://localhost:3000.
`);
}

main().catch(err => {
  console.error('\nSeed failed:', err.message);
  if (err.cause) console.error('Cause:', err.cause.message ?? err.cause);
  process.exit(1);
});
