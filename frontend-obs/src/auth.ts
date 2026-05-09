import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { isAdmin, isSuper } from "@/lib/admin-db";
import { shouldBypassAuthForHostname } from "@/lib/auth-bypass";

const ADMIN_TTL_MS = 10 * 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    authorized({ auth, request }) {
      const hostname = request?.nextUrl?.hostname || "";
      if (shouldBypassAuthForHostname(hostname)) return true;

      const pathname = request?.nextUrl?.pathname || "";
      const isPublic = pathname.startsWith("/auth/") || pathname.startsWith("/api/auth/");
      if (isPublic) return true;

      return Boolean(auth?.user);
    },
    async signIn({ account, user }) {
      if (account?.provider !== "google") return false;
      return Boolean(user.email);
    },
    async jwt({ token, trigger }) {
      const email = (token.email || "").toLowerCase();
      const checkedAt = typeof token.adminCheckedAt === "number" ? token.adminCheckedAt : 0;
      const stale = Date.now() - checkedAt > ADMIN_TTL_MS;
      const force = trigger === "signIn" || trigger === "signUp" || trigger === "update";

      if (email && (force || stale || token.isAdmin === undefined)) {
        const [adminFlag, superFlag] = await Promise.all([isAdmin(email), isSuper(email)]);
        token.isAdmin = adminFlag;
        token.isSuper = superFlag;
        token.adminCheckedAt = Date.now();
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.isAdmin = Boolean(token.isAdmin);
        session.user.isSuper = Boolean(token.isSuper);
      }
      return session;
    },
  },
});
