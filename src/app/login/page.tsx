import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/permissions";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.permissions));

  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "";
  const expired = params.expired === "1";

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-bg px-5 py-12">
      <span aria-hidden className="brand-mark pointer-events-none absolute -bottom-56 -right-48 size-[44rem] text-ink opacity-[0.04]" />

      <div className="relative w-full max-w-sm">
        <div className="mb-10 flex items-center gap-3">
          <span className="brand-mark size-9 text-ink" aria-hidden />
          <div>
            <p className="text-base font-semibold leading-tight tracking-tight">Legacy Flow</p>
            <p className="text-xs text-ink-3">Lone Star Legacy</p>
          </div>
        </div>

        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-ink-3">
          {expired ? "Your session ended. Sign in again to continue." : "Use the email and password your administrator gave you."}
        </p>

        <LoginForm next={next} />

        <p className="mt-10 text-xs leading-relaxed text-ink-3">
          Activity in Legacy Flow is recorded for quality and security. Forgot your password? Ask your administrator to reset it.
        </p>
      </div>
    </main>
  );
}
