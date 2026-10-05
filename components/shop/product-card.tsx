import Image from 'next/image';
import Link from 'next/link';
import {
  formatPrice,
  primaryImage,
  type ProductCardData,
} from '@/utils/product-format';

/**
 * The one component that renders a product anywhere — homepage section, shop
 * grid, or a related-products rail. It works from `ProductCardData` alone,
 * which is the payoff of the atomic query model: the read model is assembled by
 * SQL, so this never fetches anything itself.
 */
export function ProductCard({ product }: { product: ProductCardData }) {
  const image = primaryImage(product);

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group block rounded-xl bg-white p-3 shadow-sm transition hover:shadow-md"
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-[#2B2620]/5">
        {image ? (
          <Image
            src={image.url}
            alt={image.alt ?? product.name}
            fill
            // Placeholder SVGs are vector and scale cleanly, so let them fill
            // the box rather than being upscaled from a fixed source size.
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[#2B2620]/40">
            No image
          </div>
        )}
      </div>

      <h3 className="mt-3 font-medium leading-snug">{product.name}</h3>
      {product.shortDescription && (
        <p className="mt-1 line-clamp-2 text-sm text-[#2B2620]/60">
          {product.shortDescription}
        </p>
      )}

      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-semibold">
          {formatPrice(product.price, product.currency)}
        </span>
        {product.compareAtPrice && (
          <span className="text-sm text-[#2B2620]/40 line-through">
            {formatPrice(product.compareAtPrice, product.currency)}
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-[#2B2620]/50">
        {product.colors.length} colour{product.colors.length === 1 ? '' : 's'} ·{' '}
        {product.sizes.length} size{product.sizes.length === 1 ? '' : 's'}
      </p>
    </Link>
  );
}