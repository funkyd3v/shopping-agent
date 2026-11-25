import Link from 'next/link';

const features = [
  {
    title: 'Ask in plain language',
    body: 'Describe what you need and get relevant products from the store catalog — no filter maze required.',
    icon: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.6-3.6" />
      </>
    ),
  },
  {
    title: 'Cart and orders together',
    body: 'Add items, check out, and review your order history without leaving the conversation.',
    icon: (
      <>
        <path d="M6 8h12l-1 12H7L6 8Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </>
    ),
  },
  {
    title: 'Answers you can check',
    body: 'Shipping, returns, and warranty answers come from the store’s own policy documents.',
    icon: (
      <>
        <path d="M4 6h16v10H9l-5 4V6Z" />
        <path d="M8 10h8M8 13h5" />
      </>
    ),
  },
];

export default function HomePage() {
  return (
    <>
      <section className="mx-auto w-full max-w-5xl px-6 pt-16 pb-12 sm:pt-24 sm:pb-16">
        <div className="max-w-2xl space-y-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
            AI-assisted shopping
          </p>

          <h1 className="font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Shop by conversation, not clicks.
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
            Ask for what you need, compare products, and manage your cart and orders in plain
            language. Every answer stays grounded in the store’s own catalog and policies.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/register" className="btn btn-primary">
              Create an account
            </Link>
            <Link href="/login" className="btn btn-secondary">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 pb-20">
        <ul className="grid gap-4 sm:grid-cols-3">
          {features.map((feature) => (
            <li key={feature.title} className="rounded-2xl border border-border bg-card p-6">
              <span
                aria-hidden="true"
                className="mb-4 inline-flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-5"
                >
                  {feature.icon}
                </svg>
              </span>
              <h2 className="font-display text-base font-semibold tracking-tight">
                {feature.title}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
