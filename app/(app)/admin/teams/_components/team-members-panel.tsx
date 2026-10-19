"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { useDialog } from "@/components/ui/dialog";
import { LocalTime } from "@/components/ui/local-time";
import { SelectMenu } from "@/components/ui/select-menu";
import { apiFetch, mutate } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

interface Member {
  userId: string;
  email: string;
  name: string | null;
  teamRole: "owner" | "member";
  addedAt: string;
}

interface PanelProps {
  teamId: string;
  canManage: boolean;
  members: Member[];
}

export function TeamMembersPanel(props: PanelProps) {
  const router = useRouter();
  const { confirm, toast } = useDialog();
  const [email, setEmail] = useState("");
  const [teamRole, setTeamRole] = useState<"owner" | "member">("member");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/teams/${props.teamId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, teamRole }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Could not add member.");
        return;
      }
      setEmail("");
      toast({ kind: "success", description: "Member added." });
      router.refresh();
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(userId: string) {
    const ok = await confirm({
      title: "Remove this member?",
      description: "They lose access scoped through this team. Their account stays active.",
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    setRemoving(userId);
    try {
      const result = await mutate(`/api/admin/teams/${props.teamId}/members/${userId}`, {
        method: "DELETE",
      });
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Could not remove member",
          description: result.error,
        });
        return;
      }
      toast({ kind: "success", description: "Member removed." });
      router.refresh();
    } finally {
      setRemoving(null);
    }
  }

  async function handleSetRole(userId: string, next: "owner" | "member") {
    const result = await mutate(`/api/admin/teams/${props.teamId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamRole: next }),
    });
    if (!result.ok) {
      toast({
        kind: "error",
        title: "Could not update role",
        description: result.error,
      });
      return;
    }
    toast({ kind: "success", description: `Role set to ${next}.` });
    router.refresh();
  }

  // Shared <DataTable> so the list reflows to cards under `md` like every
  // other list; the role select and Remove button are per-row cells.
  const columns = useMemo<Array<ColumnDef<Member, unknown>>>(
    () => [
      {
        accessorKey: "email",
        header: "Email",
        cell: (ctx) => {
          const m = ctx.row.original;
          return (
            <>
              <div className="font-medium break-words">{m.email}</div>
              {m.name ? <div className="text-muted-foreground text-xs">{m.name}</div> : null}
            </>
          );
        },
      },
      {
        accessorKey: "teamRole",
        header: "Role",
        cell: (ctx) => {
          const m = ctx.row.original;
          return props.canManage ? (
            <SelectMenu
              value={m.teamRole}
              onChange={(v) => handleSetRole(m.userId, v)}
              options={[
                { value: "member", label: "member" },
                { value: "owner", label: "owner" },
              ]}
              ariaLabel={`Team role for ${m.email}`}
              className="w-32 text-xs"
            />
          ) : (
            <span className="text-xs">{m.teamRole}</span>
          );
        },
      },
      {
        accessorKey: "addedAt",
        header: "Joined",
        cell: (ctx) => (
          <span className="text-xs">
            <LocalTime ts={ctx.getValue<string>()} />
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: (ctx) => {
          const m = ctx.row.original;
          return props.canManage ? (
            <button
              type="button"
              onClick={() => handleRemove(m.userId)}
              disabled={removing === m.userId}
              aria-busy={removing === m.userId}
              className="text-destructive text-xs hover:underline disabled:opacity-45"
            >
              Remove
              <span className="sr-only"> {m.email}</span>
            </button>
          ) : null;
        },
      },
    ],
    // handleRemove / handleSetRole close over props + router only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.canManage, props.teamId, removing],
  );

  return (
    <section className="border-border space-y-4 rounded-md border p-5">
      <header>
        <h2 className="text-h3 text-foreground">Members ({props.members.length})</h2>
      </header>

      <DataTable
        columns={columns}
        data={props.members}
        pageSize={Math.max(props.members.length, 10)}
        hideSearch
        hidePagination
        noDataMessage={
          props.canManage ? "No members yet - add one below." : "No members in this team yet."
        }
      />

      {props.canManage ? (
        <form
          onSubmit={handleAdd}
          className="border-border bg-background space-y-3 rounded-md border border-dashed p-4"
        >
          <p className="text-caption text-muted-foreground">Add member</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_max-content_max-content]">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              aria-label="Email of the user to add"
              className={inputClass}
            />
            <SelectMenu
              value={teamRole}
              onChange={(v) => setTeamRole(v)}
              options={[
                { value: "member", label: "member" },
                { value: "owner", label: "owner" },
              ]}
              ariaLabel="Team role"
              className="w-32 text-sm"
            />
            <button
              aria-busy={adding}
              type="submit"
              disabled={adding}
              className={buttonClass({ variant: "primary" })}
            >
              Add
            </button>
          </div>
          {error ? (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
