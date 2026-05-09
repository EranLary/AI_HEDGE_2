import { SignInButton } from "@/components/auth/signin-button";

type SearchParams = Promise<{ callbackUrl?: string; error?: string }>;

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const { callbackUrl, error } = await searchParams;
  const target = callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/";

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          padding: 32,
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            opacity: 0.6,
            textTransform: "uppercase",
            letterSpacing: 0.4,
            marginBottom: 8,
          }}
        >
          Internal · Observability
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 6 }}>
          Hedge Observability — sign in
        </h1>
        <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 24 }}>
          Restricted to admins. Use the Google account that&apos;s on the obs allowlist.
        </p>

        <SignInButton callbackUrl={target} />

        {error ? (
          <p
            style={{
              marginTop: 16,
              fontSize: 12,
              padding: "8px 12px",
              borderRadius: 6,
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.4)",
              color: "var(--color-danger)",
              textAlign: "center",
            }}
          >
            {error === "AccessDenied"
              ? "Sign-in was blocked. You may not be on the admin allowlist."
              : "Something went wrong. Please try again."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
