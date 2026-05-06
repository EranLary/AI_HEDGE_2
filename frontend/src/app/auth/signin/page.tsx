import Image from "next/image";
import { SignInButton } from "@/components/auth/signin-button";

type SearchParams = Promise<{ callbackUrl?: string; error?: string }>;

const FEATURES: { title: string; body: string }[] = [
  {
    title: "Institutional valuations",
    body: "DCF, multiples, scenario analysis, and a Dream Team second opinion — generated end to end in minutes.",
  },
  {
    title: "Bull vs bear, by design",
    body: "Every report ships with both narratives, an explicit set of assumptions, and a confidence-adjusted call.",
  },
  {
    title: "Source-grounded",
    body: "Pulls live financials, cross-checks against filings, and cites everything so you can audit the math.",
  },
];

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const { callbackUrl, error } = await searchParams;
  const target = callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/";

  return (
    <div className="hib-landing relative isolate flex min-h-screen flex-col overflow-hidden">
      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="hib-landing-brand inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em]">
          <span aria-hidden className="relative inline-flex h-8 w-8 items-center justify-center">
            <Image
              src="/hedge-logo-dark.png"
              alt=""
              width={32}
              height={32}
              priority
              className="hib-brand-logo-dark h-8 w-8 object-contain"
            />
            <Image
              src="/hedge-logo-light.png"
              alt=""
              width={32}
              height={32}
              priority
              className="hib-brand-logo-light h-8 w-8 object-contain"
            />
          </span>
          <span>Hedge in a Box</span>
        </div>
        <span className="hib-landing-meta hidden text-[11px] uppercase tracking-[0.22em] sm:inline">
          Institutional valuation, on demand
        </span>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-12 px-6 pb-12 pt-6 sm:px-10 lg:flex-row lg:items-start lg:gap-20 lg:pb-16 lg:pt-16">
        <section className="flex flex-1 flex-col text-center lg:text-left">
          <span className="hib-landing-eyebrow inline-flex w-fit items-center gap-2 self-center rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.22em] lg:self-start">
            <span className="hib-landing-dot" aria-hidden />
            Private beta
          </span>
          <h1 className="mt-5 text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            The valuation desk that fits in your browser.
          </h1>
          <p className="hib-landing-sub mt-5 max-w-md text-balance text-base sm:text-lg lg:max-w-lg">
            Run an institutional-grade equity analysis on any ticker — DCF, scenarios, flags, and a
            second-opinion Dream Team — in the time it takes to make coffee.
          </p>
        </section>

        <section className="w-full max-w-md lg:w-[24rem] lg:flex-none">
          <div className="hib-landing-card relative flex flex-col gap-5 rounded-2xl p-7">
            <div className="flex items-center justify-between">
              <span className="hib-landing-meta text-[11px] uppercase tracking-[0.22em]">Sign in</span>
              <span className="hib-landing-meta text-[11px] uppercase tracking-[0.22em]">Required</span>
            </div>
            <div>
              <div className="text-2xl font-semibold tracking-tight">Continue to your desk</div>
              <p className="hib-landing-sub mt-1.5 text-sm">
                Use your Google account to access dashboards and run new valuations.
              </p>
            </div>

            <div className="mt-1 flex flex-col items-stretch gap-3">
              <SignInButton callbackUrl={target} />
              <p className="hib-landing-meta text-center text-[11px] uppercase tracking-[0.18em]">
                No card required · Read-only by default
              </p>
              {error ? (
                <p className="hib-landing-error mt-1 rounded-md px-3 py-2 text-center text-xs">
                  {error === "AccessDenied"
                    ? "Sign-in was blocked. Try again."
                    : "Something went wrong. Please try again."}
                </p>
              ) : null}
            </div>

            <div className="mt-1 border-t border-white/10 pt-4">
              <p className="hib-landing-meta text-[11px] leading-relaxed">
                By continuing you agree this is for informational purposes only — not investment advice.
              </p>
            </div>
          </div>
        </section>
      </main>

      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-12 sm:px-10">
        <ul className="grid gap-3 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="hib-landing-feature rounded-xl p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em]">{f.title}</div>
              <div className="hib-landing-meta mt-1.5 text-[12px] leading-relaxed">{f.body}</div>
            </li>
          ))}
        </ul>
      </section>

      <footer className="relative z-10 border-t border-white/5 px-6 py-3 text-center text-[11px] sm:px-10">
        <span className="hib-landing-meta">
          AI-generated. For informational purposes only. Not investment advice. No guarantee of accuracy or results.
        </span>
      </footer>
    </div>
  );
}
