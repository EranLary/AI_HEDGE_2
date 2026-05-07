import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

import { shouldBypassAuthForHostname } from "@/lib/auth-bypass";
import { upsertUserOnSignIn } from "@/lib/users-db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      isGuest?: boolean;
      authProvider?: string;
    } & DefaultSession["user"];
  }
  interface User {
    dbId?: string;
    isGuest?: boolean;
    authProvider?: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    isGuest?: boolean;
    authProvider?: string;
  }
}

function makeGuestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `guest:${crypto.randomUUID().slice(0, 8)}`;
    }
  } catch {
    // ignore and fall back
  }
  return `guest:${Date.now().toString(36)}`;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google,
    Credentials({
      id: "guest",
      name: "Guest",
      credentials: {},
      async authorize() {
        const guestId = makeGuestId();
        return {
          id: guestId,
          name: "Guest",
          dbId: guestId,
          isGuest: true,
          authProvider: "guest",
        };
      },
    }),
  ],
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
      if (account?.provider === "guest") {
        user.dbId = user.dbId || user.id || makeGuestId();
        user.isGuest = true;
        user.authProvider = "guest";
        return true;
      }

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
      user.isGuest = false;
      user.authProvider = "google";
      return true;
    },
    async jwt({ token, user, account }) {
      if (user?.dbId) {
        token.uid = user.dbId;
      }
      if (typeof user?.isGuest === "boolean") {
        token.isGuest = user.isGuest;
      } else if (account?.provider === "guest") {
        token.isGuest = true;
      }
      if (user?.authProvider) {
        token.authProvider = user.authProvider;
      } else if (account?.provider) {
        token.authProvider = account.provider;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) session.user.id = token.uid;
      session.user.isGuest = Boolean(token.isGuest);
      session.user.authProvider = typeof token.authProvider === "string" ? token.authProvider : undefined;
      return session;
    },
  },
});
