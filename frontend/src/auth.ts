import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";

import { shouldBypassAuthForHostname } from "@/lib/auth-bypass";
import { upsertUserOnSignIn } from "@/lib/users-db";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
  interface User {
    dbId?: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
  }
}

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
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return false;
      const sub = (profile?.sub as string | undefined) ?? account.providerAccountId;
      const email = user.email;
      if (!sub || !email) return false;
      const dbId = await upsertUserOnSignIn({
        googleSub: sub,
        email,
        name: user.name ?? null,
        imageUrl: user.image ?? null,
      });
      user.dbId = dbId;
      return true;
    },
    async jwt({ token, user }) {
      if (user?.dbId) {
        token.uid = user.dbId;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) session.user.id = token.uid;
      return session;
    },
  },
});
