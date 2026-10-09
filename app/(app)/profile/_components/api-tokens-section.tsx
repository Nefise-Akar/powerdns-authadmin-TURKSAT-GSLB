"use client";

/**
 * app/(app)/profile/_components/api-tokens-section.tsx
 *
 * Self-service personal access token management. Lists existing
 * tokens + Add form (name, optional expiry, scope checkboxes
 * limited to the user's effective permissions). Shown-once panel
 * after a successful issue (S-8 reveal pattern).
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDialog } from "@/components/ui/dialog";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { LocalTime } from "@/components/ui/local-time";
import { apiFetch, mutate } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface Props {
  initialTokens: TokenRow[];
  /**
   * Subset of the master vocab the user actually holds today -
   * computed on the server so the client doesn't import
   * `lib/rbac/permissions`. Used to render the checkbox list.
   */
  availablePermissions: string[];
}

export function ApiTokensSection({ initialTokens, availablePermissions }: Props) {
  const router = useRouter();
  const { confirm, toast } = useDialog();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [issuing, setIssuing] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{
    name: string;
    prefix: string;
    secret: string;
  } | null>(null);

  function toggleScope(p: string) {
    const next = new Set(selectedScopes);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setSelectedScopes(next);
  }

  function reset() {
    setOpen(false);
    setName("");
    setExpiresAt("");
    setSelectedScopes(new Set());
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast({ kind: "error", description: "Give the token a name." });
      return;
    }
    setIssuing(true);
    setRevealed(null);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        scopes: Array.from(selectedScopes),
      };
      if (expiresAt) {
        // DateTimePicker already returns ISO. Round-trip through Date
        // is a defensive normalization (whitespace, malformed paste).
        body["expiresAt"] = new Date(expiresAt).toISOString();
      }
      const result = await mutate(`/api/profile/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Issue failed",
          description: result.error,
        });
        return;
      }
      const minted = result.data as {
        token: { id: string; name: string; prefix: string };
        revealToken: string;
      };
      const revealRes = await apiFetch(
        `/api/profile/tokens/${encodeURIComponent(minted.token.id)}/reveal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: minted.revealToken }),
        },
      );
      if (!revealRes.ok) {
        toast({
          kind: "error",
          title: "Reveal failed",
          description:
            "Token created but the one-time secret could not be retrieved. Revoke and re-issue.",
        });
        router.refresh();
        return;
      }
      const secret = await revealRes.text();
      setRevealed({
        name: minted.token.name,
        prefix: minted.token.prefix,
        secret,
      });
      reset();
      toast({ kind: "success", description: "Token issued. Copy now." });
      router.refresh();
    } finally {
      setIssuing(false);
    }
  }

  async function handleRevoke(row: TokenRow) {
    const ok = await confirm({
      title: `Revoke ${row.name}?`,
      description:
        "Clients still using this token will start receiving 401 on the next request. Revoked tokens cannot be restored.",
      confirmLabel: "Revoke",
      variant: "danger",
    });
    if (!ok) return;
    setRevoking(row.id);
    try {
      const res = await apiFetch(`/api/profile/tokens/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast({ kind: "error", description: "Revoke failed." });
        return;
      }
      toast({ kind: "success", description: `Revoked ${row.name}.` });
      router.refresh();
    } finally {
      setRevoking(null);
    }
  }

  // Show active tokens first; revoked rows tucked underneath for the
  // "did I really revoke that?" recall, with their revocation date.
  const active = initialTokens.filter((t) => !t.revokedAt);
  const revoked = initialTokens.filter((t) => t.revokedAt);

  return (
    <section className="border-border bg-background rounded-md border p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-h3 text-foreground">Personal access tokens</h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={buttonClass({ size: "sm" })}
        >
          {open ? "Cancel" : "Issue token"}
        </button>
      </header>

      <p className="text-muted-foreground mb-3 text-xs">
        Tokens authenticate API calls via <code>Authorization: Bearer pda_pat_…</code>. Scope a
        token to the minimum permissions the consumer needs - empty scopes inherit your full current
        permission set.
      </p>

      {revealed ? (
        <Alert
          className="mb-3"
          title="token shown once"
          action={
            <button
              type="button"
              onClick={() => setRevealed(null)}
              className={buttonClass({ variant: "link", size: "xs" })}
            >
              Dismiss
            </button>
          }
        >
          <p>Copy it now; the secret won&apos;t be shown again and reloading the page loses it.</p>
          <code className="bg-card text-mono-sm mt-2 block rounded-sm p-2 font-mono break-all">
            {revealed.secret}
          </code>
        </Alert>
      ) : null}

      {open ? (
        <div className="border-border bg-card mb-4 space-y-3 rounded border p-3">
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
            <div>
              <label htmlFor="tk-name" className="block text-xs font-medium">
                Name
              </label>
              <input
                id="tk-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ci-pipeline"
                className={`mt-1 w-full ${inputClass}`}
              />
            </div>
            <div>
              <label htmlFor="tk-exp" className="block text-xs font-medium">
                Expires (optional)
              </label>
              <div className="mt-1">
                <DateTimePicker
                  id="tk-exp"
                  value={expiresAt}
                  onChange={setExpiresAt}
                  side="point"
                  placeholder="Never expires"
                  minDate={new Date()}
                />
              </div>
            </div>
          </div>
          <fieldset>
            <legend className="text-xs font-medium">
              Scopes (leave all unchecked to inherit your permissions)
            </legend>
            {availablePermissions.length === 0 ? (
              <p className="text-muted-foreground mt-1 text-xs italic">
                You have no permissions to scope a token to.
              </p>
            ) : (
              <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {availablePermissions.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedScopes.has(p)}
                      onChange={() => toggleScope(p)}
                    />
                    <code>{p}</code>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={issuing}
              className={buttonClass({ size: "sm" })}
            >
              Cancel
            </button>
            <button
              aria-busy={issuing}
              type="button"
              onClick={handleCreate}
              disabled={issuing}
              className={buttonClass({ variant: "primary", size: "sm" })}
            >
              Issue
            </button>
          </div>
        </div>
      ) : null}

      {active.length === 0 && revoked.length === 0 ? (
        <p className="text-muted-foreground text-xs">You have no tokens.</p>
      ) : null}

      {active.length > 0 ? (
        <ul className="space-y-2">
          {active.map((t) => (
            <TokenRowView
              key={t.id}
              row={t}
              onRevoke={() => handleRevoke(t)}
              revoking={revoking === t.id}
            />
          ))}
        </ul>
      ) : null}

      {revoked.length > 0 ? (
        <details className="mt-4">
          <summary className="text-muted-foreground cursor-pointer text-xs">
            Show revoked ({revoked.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {revoked.map((t) => (
              <TokenRowView key={t.id} row={t} revoked />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function TokenRowView({
  row,
  onRevoke,
  revoking,
  revoked,
}: {
  row: TokenRow;
  onRevoke?: () => void;
  revoking?: boolean;
  revoked?: boolean;
}) {
  return (
    <li
      className={
        revoked
          ? "border-border bg-background rounded border p-3 text-sm opacity-60"
          : "border-border bg-card rounded border p-3 text-sm"
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{row.name}</div>
          <div className="text-muted-foreground font-mono text-xs">pda_pat_{row.prefix}…</div>
        </div>
        {!revoked && onRevoke ? (
          <button
            aria-busy={revoking}
            type="button"
            onClick={onRevoke}
            disabled={revoking}
            className={buttonClass({ variant: "destructive", size: "sm", className: "shrink-0" })}
          >
            Revoke
          </button>
        ) : revoked ? (
          <span className="text-muted-foreground text-xs">revoked</span>
        ) : null}
      </div>
      <dl className="text-muted-foreground text-caption mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
        <dt>Created</dt>
        <dd>
          <LocalTime ts={row.createdAt} />
        </dd>
        {row.expiresAt ? (
          <>
            <dt>Expires</dt>
            <dd>
              <LocalTime ts={row.expiresAt} />
            </dd>
          </>
        ) : null}
        {row.lastUsedAt ? (
          <>
            <dt>Last used</dt>
            <dd>
              <LocalTime ts={row.lastUsedAt} />
            </dd>
          </>
        ) : null}
        {row.revokedAt ? (
          <>
            <dt>Revoked</dt>
            <dd>
              <LocalTime ts={row.revokedAt} />
            </dd>
          </>
        ) : null}
      </dl>
      {row.scopes.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {row.scopes.map((s) => (
            <span
              key={s}
              className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap"
            >
              {s}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-caption mt-2 italic">
          Inherits all of your current permissions.
        </p>
      )}
    </li>
  );
}
