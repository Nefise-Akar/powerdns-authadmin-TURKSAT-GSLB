"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDialog } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";
import { Check } from "lucide-react";
import { inputClass, textareaClass } from "@/components/ui/field";

const STRATEGIES = [
  {
    value: "round_robin",
    label: "Round-robin",
    hint: "Rotate evenly across active peers. Cheapest; no DB read per write.",
  },
  {
    value: "lowest_latency",
    label: "Lowest latency",
    hint: "Pick the peer with the lowest recent p50 latency from pdns_server_stats.",
  },
  { value: "random", label: "Random", hint: "Uniform random pick." },
  {
    value: "least_load",
    label: "Least load",
    hint: "Pick the peer with the fewest recent zone-count samples.",
  },
] as const;

type Strategy = (typeof STRATEGIES)[number]["value"];

/** A backend offered as an initial group member on the create form. */
export interface AssignableServer {
  id: string;
  name: string;
  slug: string;
  /** Short capability summary, e.g. "primary" or "primary + secondary". */
  role: string;
}

export interface ClusterFormProps {
  mode: "create" | "edit";
  /**
   * Show the peer-selection strategy. Only meaningful for a multi-primary
   * cluster (≥2 writable peers); hidden for a primary+secondaries group, which
   * has a single write target (ADR-0014). Defaults off - the create form has no
   * members yet, so it can't be a multi-primary cluster.
   */
  showStrategy?: boolean;
  /**
   * Ungrouped backends the operator can add as initial members (create mode).
   * Omitted/empty hides the picker.
   */
  assignableServers?: AssignableServer[];
  clusterId?: string;
  initialSlug?: string;
  initialName?: string;
  initialDescription?: string;
  initialWriteStrategy?: Strategy;
}

const SLUG_RE = /^[a-z][a-z0-9-]*$/;

export function ClusterForm({
  mode,
  showStrategy = false,
  assignableServers = [],
  clusterId,
  initialSlug = "",
  initialName = "",
  initialDescription = "",
  initialWriteStrategy = "round_robin",
}: ClusterFormProps) {
  const router = useRouter();
  const { toast } = useDialog();
  const [slug, setSlug] = useState(initialSlug);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [writeStrategy, setWriteStrategy] = useState<Strategy>(initialWriteStrategy);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const showMemberPicker = mode === "create" && assignableServers.length > 0;

  function toggleMember(id: string) {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFieldErrors({});
    try {
      const url =
        mode === "create" ? "/api/admin/pdns/clusters" : `/api/admin/pdns/clusters/${clusterId}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const body =
        mode === "create"
          ? {
              slug,
              name,
              description: description.trim() === "" ? undefined : description,
              // Only send the strategy when it's surfaced (multi-primary).
              // Otherwise let the server default / preserve it.
              ...(showStrategy ? { writeStrategy } : {}),
              ...(selectedMembers.size > 0 ? { memberServerIds: [...selectedMembers] } : {}),
            }
          : {
              name,
              description: description.trim() === "" ? null : description,
              ...(showStrategy ? { writeStrategy } : {}),
            };
      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
          details?: { fieldErrors?: Record<string, string[]> };
        } | null;
        if (data?.details?.fieldErrors) setFieldErrors(data.details.fieldErrors);
        toast({
          kind: "error",
          title: mode === "create" ? "Could not create group" : "Could not save group",
          description: data?.error ?? "Unexpected error.",
        });
        return;
      }
      if (mode === "create") {
        const data = (await res.json()) as { cluster: { id: string } };
        toast({ kind: "success", description: "Group created." });
        router.push(`/admin/clusters/${data.cluster.id}`);
        router.refresh();
      } else {
        toast({ kind: "success", description: "Group saved." });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const slugValid = mode === "edit" || SLUG_RE.test(slug);
  const canSubmit = slugValid && name.trim().length > 0 && !busy;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-1">
        <label className="block text-sm font-medium" htmlFor="cluster-slug">
          Slug
        </label>
        <input
          id="cluster-slug"
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={mode === "edit" || busy}
          placeholder="prod"
          className={`w-full font-mono ${inputClass}`}
        />
        <p className="text-muted-foreground text-xs">
          {mode === "edit"
            ? "Slug is immutable; provisioning YAML cluster_slug references rely on this value."
            : "Lowercase letters, digits, and hyphens. Starts with a letter."}
        </p>
        {fieldErrors["slug"] ? (
          <p className="text-destructive text-xs">{fieldErrors["slug"].join("; ")}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium" htmlFor="cluster-name">
          Name
        </label>
        <input
          id="cluster-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          placeholder="Production cluster"
          className={`w-full ${inputClass}`}
        />
        {fieldErrors["name"] ? (
          <p className="text-destructive text-xs">{fieldErrors["name"].join("; ")}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium" htmlFor="cluster-description">
          Description
        </label>
        <textarea
          id="cluster-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
          rows={2}
          className={`w-full ${textareaClass}`}
        />
      </div>

      {showStrategy ? (
        <div className="space-y-2">
          <label className="block text-sm font-medium">Peer selection strategy</label>
          <p className="text-muted-foreground text-xs">
            How the app picks which writable peer to route a read/write through. Only applies to
            multi-primary clusters (≥2 writable peers).
          </p>
          <div className="space-y-2">
            {STRATEGIES.map((s) => (
              <label
                key={s.value}
                className="border-border bg-background flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"
              >
                <input
                  type="radio"
                  name="write-strategy"
                  value={s.value}
                  checked={writeStrategy === s.value}
                  onChange={() => setWriteStrategy(s.value)}
                  disabled={busy}
                  className="accent-primary mt-0.5 cursor-pointer"
                />
                <span>
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted-foreground mt-0.5 block text-xs">{s.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {showMemberPicker ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium">Members</label>
            <span className="text-muted-foreground text-xs">{selectedMembers.size} selected</span>
          </div>
          <p className="text-muted-foreground text-xs">
            Add ungrouped backends now, or assign them later from each server&rsquo;s page. Only
            servers that don&rsquo;t already belong to a group are listed.
          </p>
          <ServerMultiSelect
            servers={assignableServers}
            selected={selectedMembers}
            onToggle={toggleMember}
            onSelectAll={() => setSelectedMembers(new Set(assignableServers.map((s) => s.id)))}
            onClear={() => setSelectedMembers(new Set())}
            disabled={busy}
          />
          {fieldErrors["memberServerIds"] ? (
            <p className="text-destructive text-xs">{fieldErrors["memberServerIds"].join("; ")}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3 pt-4">
        <button
          type="button"
          onClick={() => router.back()}
          disabled={busy}
          className={buttonClass()}
        >
          Cancel
        </button>
        <button type="submit" disabled={!canSubmit} className={buttonClass({ variant: "primary" })}>
          {busy ? "Saving…" : mode === "create" ? "Create group" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

interface ServerMultiSelectProps {
  servers: AssignableServer[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  disabled?: boolean;
}

/**
 * Themed multi-select list of backends - clickable rows with a custom check
 * indicator (no native checkbox, per the project's form-control conventions).
 * The whole row is the hit target; select-all / clear live in the header.
 */
function ServerMultiSelect({
  servers,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  disabled,
}: ServerMultiSelectProps) {
  const allSelected = selected.size === servers.length && servers.length > 0;
  return (
    <div className="border-border overflow-hidden rounded-md border">
      <div className="border-border bg-background text-muted-foreground flex items-center justify-between gap-3 border-b px-3 py-1.5 text-xs">
        <span>
          {servers.length} ungrouped server{servers.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={allSelected ? onClear : onSelectAll}
          disabled={disabled}
          className="text-primary hover:text-primary-hover hover:underline disabled:opacity-45"
        >
          {allSelected ? "Clear all" : "Select all"}
        </button>
      </div>
      <ul className="divide-border max-h-64 divide-y overflow-auto">
        {servers.map((s) => {
          const isSelected = selected.has(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onToggle(s.id)}
                disabled={disabled}
                aria-pressed={isSelected}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                  isSelected ? "bg-accent" : "hover:bg-background"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex size-4 shrink-0 items-center justify-center rounded-sm border ${
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-card"
                  }`}
                >
                  {isSelected ? <Check size={12} strokeWidth={2.25} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.name}</span>
                  <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                    <code className="font-mono">{s.slug}</code>
                    <span className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap">
                      {s.role}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
