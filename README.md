# Adore — Sanitized Engineering Showcase

A production e-commerce platform for a clothing brand, built with Next.js (App
Router), TypeScript, Drizzle ORM, Neon (serverless Postgres), Tailwind CSS and
JWT session auth. This repository is a **sanitized extract** built so reviewers
can assess the engineering — the architecture, the query model, the caching and
session design — without access to the proprietary source, the real catalogue,
the vendor integrations or any credential. The live product is at
**https://adore.ind.in** — *This is a sanitized showcase. The production source
is private.*

The patterns here are real: the SQL, the cache boundaries, the token lifecycle
and the rate limiter are the actual implementations, with real reasoning intact.
What is substituted is the data (invented products, generated placeholder
images), the branding (neutral copy, no logo or photography), and the
integrations (payments, admin, courier, email — all omitted).

---

## Tech stack

| Layer | Choice | Why |
| ----- | ------ | --- |
| Framework | Next.js 16 (App Router), React 19 | Server Components let catalogue reads run on the server with no client-side waterfall |
| Language | TypeScript (strict) | The read-model shapes are the contract between SQL and UI |
| ORM | Drizzle ORM 0.45 | SQL-shaped, typed, no runtime query engine between us and Postgres |
| Database | Postgres via Neon serverless HTTP | Edge-compatible; `json_agg` + `LATERAL` do the heavy lifting |
| Styling | Tailwind CSS 4 | Utility-first; design tokens in `app/globals.css` |
| Auth | `jose` (HS256 JWT) + `bcryptjs` | Stateless access tokens, revocable sessions, no auth framework lock-in |
| Caching | ISR (`revalidate`), `unstable_cache` + tags, React `cache()` | Three distinct lifetimes for three distinct read paths |
| Hosting | Vercel | Edge middleware, ISR, cron |

---

## Architecture

```mermaid
graph TB
  subgraph Client["Browser"]
    UI["Server-rendered pages<br/>+ client filter panel"]
  end

  subgraph Edge["Vercel Edge"]
    MW["middleware.ts<br/>verifies JWT, guards /account"]
  end

  subgraph App["Next.js Server Runtime"]
    PAGES["App Router pages<br/>Home / Shop / Product"]
    API["API routes<br/>/api/products · /api/auth/*"]
    RL["rateLimit()<br/>sliding window per client"]
    AUTH["auth.ts<br/>sign / verify / rotate"]
    SESS[("sessions table<br/>server-side revocation")]
  end

  subgraph Cache["Cache Layers"]
    ISR["ISR page cache<br/>revalidate: 300"]
    TAG["unstable_cache<br/>tags: shop-facets, shop-categories"]
    REQ["React cache()<br/>per-request dedupe"]
  end

  DB[("Neon Postgres<br/>products · variants · images")]

  UI --> MW --> PAGES
  UI --> API
  API --> RL
  API --> AUTH
  AUTH <--> SESS
  PAGES --> ISR
  PAGES --> TAG
  PAGES --> REQ
  ISR --> DB
  TAG --> DB
  REQ --> DB
  SESS --> DB

  style DB fill:#e8f0e4,stroke:#5C6B4B
  style Cache fill:#f4efe4,stroke:#8a7a5c
  style Edge fill:#eceaf2,stroke:#6b6480
```

**Three cache lifetimes, deliberately distinct:**

## Key engineering decisions

### Why SSG / ISR

The catalogue is **read far more often than it is written** — 300+ product
listings, edited occasionally. Rendering it per request meant paying a
catalogue query on every hit; shipping it fully static would mean a product edit
waiting for the next deploy. ISR splits the difference:

- `generateStaticParams` prerenders every shippable product at build time, and
  `dynamicParams = false` makes that set **exhaustive** — an unknown slug 404s
  immediately instead of triggering an on-demand render. With a catalogue this
  size that also removes the "probe for valid slugs" vector, since a rejected
  URL never reaches the database.
- `revalidate = 300` bounds staleness on a cache miss. In production an admin
  product write also calls `revalidatePath`/`revalidateTag`, so an edit appears
  immediately and the TTL is only a backstop.

`getActiveProductSlugs` deliberately uses the **same predicate** as
`getProductBySlug` (ACTIVE + at least one active variant). If the two
disagreed, the build would emit static pages that render `notFound()` — URLs
that can never work.

The `revalidate = 300` on `app/shop/layout.tsx` is set on the **layout**, not
the page, so the nav, the filter panel and the product grid share one
revalidation boundary and can never be half-updated relative to each other.

### The atomic query model

A product card needs images, the cheapest active price, the colour list, the
per-size stock, the full variant matrix, and its categories. Written naively
that is `1 + 6` queries per listing — the classic N+1 — and because the page
waits for all of them, latency is the **sum**, not the maximum.

`getProductsForSection` (`utils/products.ts`) instead folds every relation into
the driving row:

```sql
SELECT
  p.id, p.slug, p.name, …,
  (SELECT json_agg(…) FROM product_images    WHERE product_id = p.id) AS images,
  (SELECT json_agg(…) FROM …                  GROUP BY v.size)          AS sizes,
  (SELECT json_agg(…) FROM product_variants  WHERE product_id = p.id) AS variants,
  (SELECT COALESCE(SUM(stock_quantity), 0) …)                          AS total_stock
FROM products p
JOIN LATERAL (
  SELECT price, currency, compare_at_price
  FROM product_variants
  WHERE product_id = p.id AND is_active
  ORDER BY price ASC LIMIT 1
) min_active ON TRUE
```

Result: **one statement, one round trip, one plan** for a whole grid. Details
worth noting:

- The `JOIN LATERAL` is an **inner** join, so products with no active variant
  are filtered out in SQL rather than surfacing as priceless cards downstream.
- Price is the cheapest *active* variant — which is what "from $X" means.
- The size rollup uses `SUM(stock)`, `MIN(price)` and
  `array_agg(compare_at_price ORDER BY price)[1]` to collapse the colour × size
  matrix to one row per size, keeping the compare-at price that actually belongs
  to the cheapest variant.
- `idx_product_variants_product_active (product_id, is_active, price)` is
  ordered so the LATERAL's `ORDER BY price ASC LIMIT 1` is served by the index
  itself — removing both a Sort and a Filter node from the plan.
### Rate limiting

`utils/rate-limit.ts` — a sliding-window counter, deliberately kept small and
explicit about its limits rather than pulling in a dependency.

- **Sliding, not fixed.** Timestamps within the window are kept per key, so an
  attacker cannot idle up to a boundary and then fire a fresh burst.
- **Keyed per client, not per IP alone.** For `/api/products` the key is the
  refresh-token cookie when present, falling back to the first entry of
  `x-forwarded-for`. An IP-only key on serverless lumps unrelated users behind a
  platform proxy together, which punishes a whole office or NAT'd household for
  one noisy client.
- **Two dimensions for login.** `/api/auth/login` keys on `hash(ip + email)`,
  so one attacker cannot lock out an entire office (IP-only) or spray across
  many accounts unthrottled (email-only). The email is hashed so the in-memory
  map never holds plaintext addresses.
- **Bounded memory.** The map is cleared once it exceeds 10 000 keys.
- **429s carry `Retry-After`**, a header clients already know how to honour.

Stated limitation, not hidden: the map is **per server instance** and resets on
redeploy, so on serverless it bounds a burst but is not a hard global cap. That
is the right trade at this scale — it costs nothing and needs no extra
infrastructure. If it ever needs to be exact, swap the `Map` for Redis/Upstash;
the call sites would not change.

### JWT session security

Access + refresh token pair, both in `httpOnly` cookies (`utils/auth.ts`):

| | Access | Refresh |
| --- | --- | --- |
| Lifetime | 1 hour | 1 day |
| Signing key | `JWT_SECRET` | `JWT_REFRESH_SECRET` |
| Stored server-side | no | yes, in `sessions` |
| Purpose | authorizes requests | mints new access tokens |

- **Separate signing secrets.** A leaked access token cannot be replayed as a
  refresh token to mint a long-lived session — the classic token-confusion
  escalation.
- **`httpOnly` + `secure` + `sameSite=lax`.** `httpOnly` keeps the token out of
  reach of page scripts, so an XSS bug is not fatal for session theft.
  `sameSite=lax` still blocks the cookie on cross-site POSTs (the CSRF-vulnerable
  case) while allowing normal top-level navigation.
- **Server-side sessions make revocation real.** A signature check alone is not
  enough: `/api/auth/refresh` requires the token to be a live row in
  `sessions`, so logout actually invalidates it even though the JWT is still
  cryptographically valid until it expires.
- **Refresh rotation.** Every refresh revokes the presented token and issues a
  new pair, so a captured refresh token is usable at most once before it is
  burned.
- **Device cap.** Login/refresh prunes expired rows and keeps the 10 most
  recent sessions per user.
- **Fail closed on misconfiguration.** There is no `?? 'dev-secret'` fallback;
  a short or missing secret is rejected rather than silently used, so the app
  never signs tokens with a guessable string.
- **No enumeration.** Login returns one message for both "no such user" and
  "wrong password".
- **No token in JavaScript.** The login response body carries only
  display-safe fields; the tokens are set as cookies by the server.

A third, `httpOnly: false` cookie is a **hint** only (`1`/`0`) letting the
client skip `/api/auth/me` for guests. It grants nothing: every request is still
authorized server-side, so a forged value costs at worst one wasted 401.

### Caching strategy

Three lifetimes, one per access pattern (see the table above). The subtle part
is the split between the **facets** and the **product query**:

Filter facets (available colours/sizes) depend on the *category* only, never on
the active filters. So they are wrapped in `unstable_cache` with a tag. A filter
click therefore costs **one** database round trip instead of two, and the facets
stay correct across every filter combination. An admin write calls
`revalidateTag(..., { expire: 0 })`, with the 300s TTL as a backstop.

For `getProductBySlug`, React's `cache()` dedupes within a single render pass —
its token key is per-request, so two components asking for the same product cost
one query with no risk of one user's data reaching another.

---

## Performance: 4s → 1.5s

---

## What's intentionally omitted

This showcase demonstrates engineering, not the business. The following is
**deliberately absent** and should not be read as an oversight:

| Omitted | Why |
| ------- | --- |
| **Payments / checkout** | Payment provider integration, webhook verification, order ledger, promo codes. Highest-density proprietary and PCI-adjacent logic. |
| **Admin tooling** | The entire `/admin` area and `utils/admin-*.ts`: product CRUD, promos, order ledger, returns triage. |
| **Returns & refunds** | Return eligibility rules, fraud scoring, refund reconciliation — core business IP. |
| **Courier / shipping** | Shipment creation, rate estimation, tracking webhooks, serviceability by PIN. Vendor-specific. |
| **Transactional email** | Templates, queue draining, delivery webhooks. Contains real reply-to addresses and brand copy. |
| **Cart & accounts** | Cart merge-on-login, saved addresses, order history, profile. |
| **Reviews** | Review submission, moderation, eligibility rules. |
| **Real data** | All 20 products are invented. No real customer, order or review data exists here. |
| **Brand assets** | No logo, photography or marketing copy. See below. |

### Placeholder assets

All product imagery is **generated SVG** written by `scripts/seed.mjs` — a
tinted rectangle, a generic garment silhouette and the text "placeholder — not a
real product". There are no real photographs, no logo, no brand typeface and no
marketing copy anywhere in this repository. Product names ("Sample Everyday
Tee"), materials, fits and descriptions are invented. The single email address
present, `demo@example.com`, is a reserved-example-domain fixture created by the
seed script.

---

## Setup

**Requirements:** Node.js 20+ and a reachable Postgres database (any provider;
the original used Neon's serverless Postgres).

```bash
# 1. Clone
git clone <your-fork-or-clone-url>
cd adore-showcase

# 2. Install
npm install

# 3. Configure
cp .env.example .env.local
#    Then edit .env.local and set DATABASE_URL, plus two distinct
#    32+ character secrets:
#      openssl rand -base64 48   # JWT_SECRET
#      openssl rand -base64 48   # JWT_REFRESH_SECRET
#
#    Quick local Postgres alternative:
#      docker run -d --name adore-pg -p 5432:5432 \
#        -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=adore_showcase postgres:16
#      # DATABASE_URL="postgresql://postgres:postgres@localhost:5432/adore_showcase"

# 4. Seed — creates the schema, 20 mock products with variants,
#    categories and generated placeholder images
npm run seed

# 5. Run
npm run dev
```

Open <http://localhost:3000>. Sign in with the demo account the seed prints:

```
demo@example.com / showcase-demo-password
```

> `JWT_SECRET` and `JWT_REFRESH_SECRET` must be **different** values. The app
> will refuse to start with a secret shorter than 32 characters.

### Scripts

| Command | Does |
## Project layout

```
app/
  layout.tsx              Root layout + metadata
  page.tsx                Homepage — ISR, parallel featured/latest reads
  shop/
    layout.tsx            Shared ISR window + category nav
    page.tsx              Listing, URL-driven filters
  products/[slug]/page.tsx SSG: generateStaticParams + dynamicParams=false
  login/                  Sign-in form (posts to the API, never touches tokens)
  api/
    products/route.ts     Rate-limited JSON listing
    auth/{login,logout,me,refresh}/route.ts
utils/
  schema.ts               Drizzle schema + index rationale
  db.ts                   Neon + Drizzle, rawQuery, describeDbError
  products.ts             Atomic read model, facet cache, SSG slugs
  auth.ts                 JWT sign/verify/rotate, sessions
  auth-cookies.ts         Leaf module of cookie names
  request-user.ts         Server-side session user lookup
  rate-limit.ts           Sliding-window limiter
  random.ts               Unbiased sampling without replacement
  filter-params.ts        URL filter parsing/validation
  product-format.ts       Read-model types + pure formatters
  categories.ts           Category taxonomy
  admin-schema.ts         Payload validation
middleware.ts             Edge route guard
scripts/seed.mjs          Schema + 20 mock products + placeholder SVGs
```

Two files are worth reading first: **`utils/products.ts`** (the atomic query
model and caching strategy) and **`utils/auth.ts`** (the token lifecycle).

---

## Screenshots

Screenshots and a short recording belong in
[`docs/screenshots/`](docs/screenshots/) — see the README there for the intended
filenames and embed snippets.

---

## Security notes

This repository has been scanned for credentials and contains none. Specifically:

- `.env.local` and every other real env file are excluded and `.env*` is
  gitignored; only `.env.example` (names and comments, no values) is committed.
- No API keys, tokens, database URLs, payment or webhook secrets, courier
  credentials or admin credentials are present.
- All email addresses use the reserved `example.com` domain.
- No production domains or internal hostnames appear in the code.
- `git log` contains a **single** initial commit — the history was not carried
  over from the private repository, so no old commit messages or diffs leak.

If you fork this, keep it that way: run a secret scanner (`gitleaks detect`,
`trufflehog git`) before publishing.

---

## License

MIT — see [LICENSE](LICENSE).

Note that the license covers **this sanitized showcase only**. The production
Adore source and the Adore brand remain private and unlicensed.
| ------- | ---- |
| `npm run dev` | Development server |
| `npm run build` | Production build (runs `generateStaticParams` for every product) |
| `npm run seed` | Reset and reseed the mock catalogue |
| `npm run type-check` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

---
The production homepage went from **~4s to ~1.5s** perceived load. Four changes,
in rough order of impact:

1. **Eliminated the N+1.** The listing previously issued a follow-up query per
   product per relation. Collapsing the grid into the single atomic query
   described above turned ~150 serial round trips per page into **1**. This was
   the largest single win and the reason the atomic query model exists.
2. **ISR.** The homepage and product pages became statically generated with a
   5-minute window. After the first hit, repeat visitors are served from the
   edge with **zero** database queries — which is what took repeat-view latency
   below the cold path's floor.
3. **Indexed the variants table.** `idx_product_variants_product_active
   (product_id, is_active, price)` lets the cheapest-price `LATERAL` be served
   by index order, removing a Sort and a Filter node per product row.
4. **Parallelised independent reads.** The homepage's featured and latest
   queries use `Promise.all`, so page latency is the slower of the two rather
   than their sum.

The 300-product catalogue is what made #1 and #2 worth doing: at 20 products the
N+1 would have been survivable, and the work would not have generalised.
- Every filter is an `EXISTS` over a parameterized `IN` list, or a
  parameterized `ILIKE`. No user input is ever concatenated into SQL, and the
  one `sql.raw()` (the sort clause) is fed only by a whitelist lookup.

The payoff is that `ProductCardData` is a **complete** read model. The card
component never fetches anything itself, and because the page and the JSON API
call the same function, the two can never drift apart.
| Layer | Scope | Lifetime | Used for |
| ----- | ----- | -------- | -------- |
| React `cache()` | one render pass | request | `getProductBySlug` when layout + page both need it |
| `unstable_cache` + tags | across requests | 300s + tag invalidation | Filter facets, category nav — change only when a product is edited |
| ISR (`revalidate`) | across requests | 300s | Homepage, shop, product pages |

---