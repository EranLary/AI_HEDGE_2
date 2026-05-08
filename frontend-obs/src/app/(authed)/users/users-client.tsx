"use client";

import { useState, useTransition } from "react";

import { addAdminAction, removeAdminAction } from "./actions";

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  background: "var(--color-muted, rgba(0,0,0,0.04))",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  color: "var(--color-foreground)",
  fontSize: 14,
};

const buttonStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "var(--color-accent)",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
};

export function AddAdminForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await addAdminAction(formData);
      if (!res.ok) {
        setError(res.error);
      } else {
        setSuccess(true);
        setEmail("");
      }
    });
  }

  return (
    <form action={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
      <input
        type="email"
        name="email"
        placeholder="someone@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        style={inputStyle}
        disabled={pending}
      />
      <button type="submit" style={{ ...buttonStyle, opacity: pending ? 0.6 : 1 }} disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </button>
      {error ? (
        <span style={{ alignSelf: "center", fontSize: 12, color: "var(--color-danger)" }}>{error}</span>
      ) : null}
      {success ? (
        <span style={{ alignSelf: "center", fontSize: 12, color: "#86efac" }}>Added</span>
      ) : null}
    </form>
  );
}

export function RemoveAdminButton({
  email,
  isSuper,
  disabledReason,
}: {
  email: string;
  isSuper: boolean;
  disabledReason: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (disabledReason) {
    return (
      <span style={{ fontSize: 12, opacity: 0.5 }} title={disabledReason}>
        —
      </span>
    );
  }

  function handleClick() {
    if (!confirm(`Remove ${email} from admins?`)) return;
    setError(null);
    const fd = new FormData();
    fd.set("email", email);
    fd.set("is_super", String(isSuper));
    startTransition(async () => {
      const res = await removeAdminAction(fd);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        style={{
          padding: "4px 10px",
          background: "transparent",
          color: "var(--color-danger)",
          border: "1px solid var(--color-danger)",
          borderRadius: 6,
          fontSize: 12,
          opacity: pending ? 0.5 : 1,
        }}
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      {error ? <span style={{ fontSize: 11, color: "var(--color-danger)" }}>{error}</span> : null}
    </span>
  );
}
