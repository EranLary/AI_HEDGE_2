import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { shouldBypassAuthForHostname } from "@/lib/auth-bypass";

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
  },
});
