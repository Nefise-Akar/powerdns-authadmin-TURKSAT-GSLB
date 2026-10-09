"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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

  return (
    <section className="border-border space-y-4 rounded-md border p-5">
      <header>
        <h2 className="text-h3 text-foreground">Members ({props.members.length})</h2>
      </header>

      {props.members.length === 0 ? (
        <p className="text-muted-foreground text-sm">No members yet.</p>
      ) : (
        <div className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-border bg-background text-label text-muted-foreground border-y text-left">
              <tr>
                <th className="h-9 px-2 font-medium first:pl-3">Email</th>
                <th className="h-9 px-2 font-medium first:pl-3">Role</th>
                <th className="h-9 px-2 font-medium first:pl-3">Joined</th>
                <th className="h-9 px-2 font-medium first:pl-3"></th>
              </tr>
            </thead>
            <tbody>
              {props.members.map((m) => (
                <tr
                  key={m.userId}
                  className="border-border even:bg-background hover:bg-background border-t transition-colors"
                >
                  <td className="px-2 py-2 align-top first:pl-3">
                    <div className="font-medium">{m.email}</div>
                    {m.name ? <div className="text-muted-foreground text-xs">{m.name}</div> : null}
                  </td>
                  <td className="px-2 py-2 align-top text-xs first:pl-3">
                    {props.canManage ? (
                      <SelectMenu
                        value={m.teamRole}
                        onChange={(v) => handleSetRole(m.userId, v)}
                        options={[
                          { value: "member", label: "member" },
                          { value: "owner", label: "owner" },
                        ]}
                        ariaLabel="Team role"
                        className="w-32 text-xs"
                      />
                    ) : (
                      m.teamRole
                    )}
                  </td>
                  <td className="px-2 py-2 align-top text-xs first:pl-3">
                    <LocalTime ts={m.addedAt} />
                  </td>
                  <td className="px-2 py-2 text-right align-top first:pl-3">
                    {props.canManage ? (
                      <button
                        aria-busy={removing === m.userId}
                        type="button"
                        onClick={() => handleRemove(m.userId)}
                        disabled={removing === m.userId}
                        className="text-destructive text-xs hover:underline disabled:opacity-45"
                      >
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
