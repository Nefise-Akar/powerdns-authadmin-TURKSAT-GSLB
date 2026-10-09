/**
 * app/(app)/change-email/page.tsx
 *
 * Landing page for the email-change confirmation link. The user
 * arrives here authenticated (the layout enforces auth); we extract
 * the token from the query string and render a thin client form
 * that POSTs to /api/profile/email/change/confirm.
 *
 * Lives under (app) - not (auth) - because confirming requires an
 * authenticated session. A leaked link is still useless without the
 * user's password and active session.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmEmailChangeForm } from "./confirm-form";

export const metadata: Metadata = { title: "Confirm email change" };

export default async function ChangeEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="mx-auto max-w-md space-y-6">
      <header>
        <h1 className="text-h1">Confirm email change</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Click the button below to swap your account email and revoke all current sessions.
          You&apos;ll sign back in with the new email.
        </p>
      </header>
      {token ? (
        <ConfirmEmailChangeForm token={token} />
      ) : (
        <p className="text-destructive text-sm">
          Missing token. Open the link from the audit log again.
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        <Link href="/profile" className="underline">
          ← Back to profile
        </Link>
      </p>
    </div>
  );
}
