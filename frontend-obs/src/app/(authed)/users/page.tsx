import { isSuper, listAdmins } from "@/lib/admin-db";
import { requireAdmin } from "@/lib/auth-helpers";

import { AddAdminForm, RemoveAdminButton } from "./users-client";

export const dynamic = "force-dynamic";

export default async function ManageUsersPage() {
  const { email: actor } = await requireAdmin();
  const [admins, actorIsSuper] = await Promise.all([listAdmins(), isSuper(actor)]);

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Manage admins</h1>
        <p style={{ opacity: 0.7, fontSize: 14 }}>
          Anyone on this list can sign into observability and add others.
          Super admins can remove other super admins.
        </p>
      </div>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.7, marginBottom: 8 }}>
          Add admin
        </h2>
        <AddAdminForm />
      </section>

      <section>
        <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: 0.4, opacity: 0.7, marginBottom: 8 }}>
          Current admins ({admins.length})
        </h2>
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "var(--color-muted, rgba(0,0,0,0.04))" }}>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Added</Th>
                <Th>Added by</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => {
                const isSelf = a.email === actor;
                const removeDisabledReason = isSelf
                  ? "Can't remove yourself"
                  : a.is_super && !actorIsSuper
                  ? "Only a super admin can remove a super admin"
                  : null;
                return (
                  <tr key={a.email} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <Td>
                      <span style={{ fontFamily: "var(--font-mono)" }}>{a.email}</span>
                      {isSelf ? <span style={{ marginLeft: 8, opacity: 0.6, fontSize: 12 }}>(you)</span> : null}
                    </Td>
                    <Td>
                      {a.is_super ? (
                        <span
                          style={{
                            background: "rgba(99,102,241,0.18)",
                            color: "#a5b4fc",
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 500,
                            textTransform: "uppercase",
                            letterSpacing: 0.4,
                          }}
                        >
                          Super
                        </span>
                      ) : (
                        <span style={{ opacity: 0.6, fontSize: 12 }}>admin</span>
                      )}
                    </Td>
                    <Td>{new Date(a.added_at).toLocaleDateString()}</Td>
                    <Td>
                      <span style={{ opacity: 0.7, fontSize: 12 }}>{a.added_by ?? "(seed)"}</span>
                    </Td>
                    <Td align="right">
                      <RemoveAdminButton
                        email={a.email}
                        isSuper={a.is_super}
                        disabledReason={removeDisabledReason}
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      style={{
        textAlign: align ?? "left",
        padding: "10px 14px",
        fontWeight: 500,
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        opacity: 0.7,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td style={{ textAlign: align ?? "left", padding: "10px 14px", verticalAlign: "middle" }}>
      {children}
    </td>
  );
}
