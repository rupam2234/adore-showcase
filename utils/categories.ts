/**
 * The category taxonomy.
 *
 * Production derives the nav and the filter sidebar from these constants rather
 * than from the database, because the sidebar must render identically during
 * static generation — a DB-driven nav would make every build depend on a live
 * query. The database copy of the tree (`categories`) is what the *queries*
 * filter against, and the two are kept in step by the seed script.
 */

export type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
};

export type CategoryNode = {
  slug: string;
  name: string;
  description?: string;
  children?: CategoryNode[];
};

export const CATEGORY_TREE: CategoryNode[] = [
  {
    slug: 'tops',
    name: 'Tops',
    children: [
      { slug: 't-shirts', name: 'T-Shirts' },
      { slug: 'blouses', name: 'Blouses' },
    ],
  },
  {
    slug: 'bottoms',
    name: 'Bottoms',
    children: [
      { slug: 'trousers', name: 'Trousers' },
      { slug: 'skirts', name: 'Skirts' },
    ],
  },
  {
    slug: 'dresses',
    name: 'Dresses',
    children: [{ slug: 'midi-dresses', name: 'Midi Dresses' }],
  },
  { slug: 'outerwear', name: 'Outerwear' },
  { slug: 'accessories', name: 'Accessories' },
];

export type CategorySlug = string;

/** Flatten the tree to a slug list, so nav and sitemap share one source. */
export const ALL_CATEGORIES: CategorySlug[] = CATEGORY_TREE.flatMap(c => [
  c.slug,
  ...(c.children ?? []).map(k => k.slug),
]);

/** Parent slug -> child slugs, used to expand a filter to its whole subtree. */
export const CATEGORY_CHILDREN: Record<string, string[]> = Object.fromEntries(
  CATEGORY_TREE.filter(c => c.children?.length).map(c => [
    c.slug,
    c.children!.map(k => k.slug),
  ])
);

export const CATEGORY_PARENTS = CATEGORY_TREE.filter(c => c.children?.length);

export function findCategory(slug: string): CategoryNode | null {
  for (const parent of CATEGORY_TREE) {
    if (parent.slug === slug) return parent;
    const child = parent.children?.find(c => c.slug === slug);
    if (child) return child;
  }
  return null;
}

export function categoryPageMetadata(slug: string): {
  title: string;
  description: string;
} {
  const node = findCategory(slug);
  return {
    title: node?.name ?? 'Shop',
    description:
      node?.description ?? `Browse the ${node?.name ?? 'full'} collection.`,
  };
}