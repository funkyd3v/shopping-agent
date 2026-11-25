type ProductThumbProps = {
  imageUrl: string | null;
  name: string;
  category: string;
  className?: string;
};

/** Catalog images are optional; render a calm placeholder until a URL exists. */
export function ProductThumb({ imageUrl, name, category, className }: ProductThumbProps) {
  if (imageUrl) {
    // Plain <img> keeps remote catalog URLs provider-agnostic; the seed ships nulls.
    return (
      // biome-ignore lint/performance/noImgElement: catalog URLs are provider-agnostic; the seed ships nulls.
      <img src={imageUrl} alt={name} className={`size-full object-cover ${className ?? ''}`} />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`flex size-full items-center justify-center bg-linear-to-br from-muted via-accent-soft to-muted ${className ?? ''}`}
    >
      <span className="font-display text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
        {category}
      </span>
    </div>
  );
}
