"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "@/components/ui/dialog";
import { mutate } from "@/lib/client/api-fetch";
import { KIND_SPECS, getKindSpec, isKindApiWritable } from "./kind-specs";
import { MetadataValuesInput } from "./metadata-values-input";
import { buttonClass } from "@/components/ui/button";

interface Props {
  zoneIdEncoded: string;
  serverSlug: string;
  existingKinds: readonly string[];
}

interface KindOption {
  kind: string;
  description: string;
}

const KIND_OPTIONS: KindOption[] = Object.entries(KIND_SPECS)
  .filter(([kind]) => isKindApiWritable(kind))
  .map(([kind, spec]) => ({ kind, description: spec.description }))
  .sort((a, b) => a.kind.localeCompare(b.kind));

export function AddMetadataKind({ zoneIdEncoded, serverSlug, existingKinds }: Props) {
  const router = useRouter();
  const { toast } = useDialog();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const existing = new Set(existingKinds);
  const available = KIND_OPTIONS.filter((o) => !existing.has(o.kind));
  const spec = kind ? getKindSpec(kind) : null;

  function reset() {
    setKind(null);
    setValues([]);
    setOpen(false);
  }

  async function handleSave() {
    if (!kind) return;
    setSaving(true);
    try {
      const cleaned = values.map((s) => s.trim()).filter((s) => s.length > 0);
      const result = await mutate(
        `/api/admin/pdns/zones/${zoneIdEncoded}/metadata/${encodeURIComponent(kind)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverSlug, values: cleaned }),
        },
      );
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Add failed",
          description: result.error,
        });
        return;
      }
      toast({ kind: "success", description: `Added ${kind}.` });
      reset();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass({ variant: "primary", size: "sm" })}
      >
        + Add metadata kind
      </button>
    );
  }

  return (
    <div className="border-border bg-card space-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Add metadata kind</h3>
        <button
          type="button"
          onClick={reset}
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          Cancel
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium">Kind</label>
          <KindCombobox
            value={kind}
            onChange={(next) => {
              setKind(next);
              setValues([]);
            }}
            options={available}
          />
          {spec ? (
            <p className="text-muted-foreground text-caption mt-1">{spec.description}</p>
          ) : null}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Value{listy(spec) ? "s" : ""}</label>
          {kind ? (
            <MetadataValuesInput kind={kind} values={values} onChange={setValues} />
          ) : (
            <p className="text-muted-foreground text-caption">Pick a kind first.</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          aria-busy={saving}
          type="button"
          onClick={handleSave}
          disabled={!kind || saving}
          className={buttonClass({ variant: "primary", size: "sm" })}
        >
          Add
        </button>
      </div>
    </div>
  );
}

function listy(spec: ReturnType<typeof getKindSpec> | null): boolean {
  return spec?.type === "list";
}

interface KindComboboxProps {
  value: string | null;
  onChange: (next: string) => void;
  options: readonly KindOption[];
}

function KindCombobox({ value, onChange, options }: KindComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filtered = options.filter(
    (o) =>
      query.trim() === "" ||
      o.kind.toLowerCase().includes(query.trim().toLowerCase()) ||
      o.description.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  function pick(kind: string) {
    onChange(kind);
    setQuery("");
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[highlight]) {
        pick(filtered[highlight].kind);
      } else {
        setOpen(true);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="border-input bg-card text-body focus-visible:border-ring focus-visible:shadow-focus-ring flex h-8 w-full items-center justify-between rounded-md border px-3 text-left font-mono focus-visible:outline-hidden disabled:opacity-45"
      >
        <span className={value ? "" : "text-muted-foreground"}>{value ?? "Select a kind…"}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden
          className="text-muted-foreground ml-2"
        >
          <path
            d="M2 4l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div className="border-border bg-card absolute right-0 left-0 z-10 mt-1 overflow-hidden rounded-md border">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Filter kinds…"
            className="border-border bg-card block w-full border-b px-2 py-1.5 text-xs outline-none"
            aria-controls={listId}
            aria-autocomplete="list"
          />
          <ul
            id={listId}
            role="listbox"
            className="max-h-60 overflow-auto py-1 text-xs"
            onMouseLeave={() => setHighlight(-1)}
          >
            {filtered.length === 0 ? (
              <li className="text-muted-foreground px-2 py-2">No kinds match.</li>
            ) : (
              filtered.map((o, i) => (
                <li
                  key={o.kind}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o.kind);
                  }}
                  className={`cursor-pointer px-2 py-1.5 ${
                    i === highlight ? "bg-background" : "hover:bg-background"
                  }`}
                >
                  <div className="font-mono">{o.kind}</div>
                  <div className="text-muted-foreground text-caption">{o.description}</div>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
