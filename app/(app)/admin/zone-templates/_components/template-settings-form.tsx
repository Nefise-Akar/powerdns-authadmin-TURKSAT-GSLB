"use client";

/**
 * Per-template Zone-settings editor. Mirrors the zone-detail Zone-settings
 * panel: zone Type (kind), SOA-EDIT, SOA-EDIT-API, API-RECTIFY toggle,
 * plus SOA timers. When a zone is created from this template the apply
 * path (in app/api/admin/pdns/zones/route.ts) PUTs these fields onto the
 * created zone via the same `updateZoneSettings` client call.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "@/components/ui/dialog";
import { mutate } from "@/lib/client/api-fetch";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui/number-input";
import { buttonClass } from "@/components/ui/button";

interface InitialState {
  id: string;
  kind: string;
  soaEdit: string | null;
  soaEditApi: string | null;
  apiRectify: boolean | null;
  soaTtl: number;
  soaRefresh: number;
  soaRetry: number;
  soaExpire: number;
  soaMinimum: number;
  defaultForPrimaryIds: string[];
}

export interface PrimaryOption {
  id: string;
  name: string;
}

interface Props {
  initial: InitialState;
  canEdit: boolean;
  primaries: PrimaryOption[];
}

// PDNS Authoritative still accepts `Master`/`Slave` only for the zone-kind
// wire value (config settings + pdnsutil moved to Primary/Secondary, but the
// `POST /zones { kind }` payload didn't). Label the picker with the modern
// terminology but keep the value as the legacy string.
const ZONE_KINDS = [
  { value: "Native", label: "Native", description: "No replication." },
  {
    value: "Master",
    label: "Primary",
    description: "Sends AXFR/NOTIFY to Secondaries.",
  },
  {
    value: "Slave",
    label: "Secondary",
    description: "Pulls AXFR from Primaries.",
  },
] as const;

const SOA_EDIT_OPTIONS = [
  "DEFAULT",
  "INCREASE",
  "EPOCH",
  "INCEPTION-INCREMENT",
  "INCEPTION-EPOCH",
  "NONE",
] as const;

const SOA_EDIT_API_OPTIONS = [
  "DEFAULT",
  "INCREASE",
  "SOA-EDIT",
  "SOA-EDIT-INCREASE",
  "EPOCH",
  "NONE",
] as const;

export function TemplateSettingsForm({ initial, canEdit, primaries }: Props) {
  const router = useRouter();
  const { toast } = useDialog();

  const initialKind = normalizeKind(initial.kind);
  const [kind, setKind] = useState(initialKind);
  const [soaEdit, setSoaEdit] = useState(initial.soaEdit ?? "");
  const [soaEditApi, setSoaEditApi] = useState(initial.soaEditApi ?? "");
  const [apiRectify, setApiRectify] = useState(initial.apiRectify ?? false);
  const [soaTtl, setSoaTtl] = useState(initial.soaTtl);
  const [soaRefresh, setSoaRefresh] = useState(initial.soaRefresh);
  const [soaRetry, setSoaRetry] = useState(initial.soaRetry);
  const [soaExpire, setSoaExpire] = useState(initial.soaExpire);
  const [soaMinimum, setSoaMinimum] = useState(initial.soaMinimum);
  const [defaultForOn, setDefaultForOn] = useState(initial.defaultForPrimaryIds.length > 0);
  const [defaultForIds, setDefaultForIds] = useState<string[]>(initial.defaultForPrimaryIds);
  const [saving, setSaving] = useState(false);

  const initialDefaultForSorted = [...initial.defaultForPrimaryIds].sort();
  const currentDefaultForSorted = (defaultForOn ? defaultForIds : []).slice().sort();
  const defaultForChanged =
    initialDefaultForSorted.length !== currentDefaultForSorted.length ||
    initialDefaultForSorted.some((id, i) => id !== currentDefaultForSorted[i]);

  const dirty =
    kind !== initialKind ||
    soaEdit !== (initial.soaEdit ?? "") ||
    soaEditApi !== (initial.soaEditApi ?? "") ||
    apiRectify !== (initial.apiRectify ?? false) ||
    soaTtl !== initial.soaTtl ||
    soaRefresh !== initial.soaRefresh ||
    soaRetry !== initial.soaRetry ||
    soaExpire !== initial.soaExpire ||
    soaMinimum !== initial.soaMinimum ||
    defaultForChanged;

  function togglePrimaryId(id: string) {
    setDefaultForIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body = {
        kind,
        soaEdit: soaEdit || null,
        soaEditApi: soaEditApi || null,
        apiRectify,
        soaTtl,
        soaRefresh,
        soaRetry,
        soaExpire,
        soaMinimum,
        defaultForPrimaryIds: defaultForOn ? defaultForIds : [],
      };
      const result = await mutate(`/api/admin/zone-templates/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!result.ok) {
        toast({
          kind: "error",
          title: "Save failed",
          description: result.error,
        });
        return;
      }
      toast({ kind: "success", description: "Zone settings saved." });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Zone Type" help="Default kind applied at zone create.">
          <KindSelect value={kind} onChange={setKind} disabled={!canEdit} />
        </Field>
        <Field label="API-RECTIFY" help="Auto-rectify zone after every API change.">
          <div className="flex items-center gap-2">
            <Switch
              checked={apiRectify}
              onChange={setApiRectify}
              disabled={!canEdit}
              ariaLabel="API-RECTIFY"
            />
            <span className="font-mono text-xs">{apiRectify ? "enabled" : "disabled"}</span>
          </div>
        </Field>
        <Field label="SOA-EDIT" help="Algorithm for the serial sent to secondaries.">
          <EnumSelect
            value={soaEdit}
            options={SOA_EDIT_OPTIONS}
            onChange={setSoaEdit}
            disabled={!canEdit}
            placeholder="(server default)"
          />
        </Field>
        <Field label="SOA-EDIT-API" help="Algorithm for serial bumps after API edits.">
          <EnumSelect
            value={soaEditApi}
            options={SOA_EDIT_API_OPTIONS}
            onChange={setSoaEditApi}
            disabled={!canEdit}
            placeholder="(server default)"
          />
        </Field>
      </div>

      <div>
        <h3 className="text-h3 text-foreground mb-2">SOA timers</h3>
        <div className="grid gap-3 sm:grid-cols-5">
          <Field label="TTL">
            <NumberInput
              value={soaTtl}
              onChange={setSoaTtl}
              min={0}
              disabled={!canEdit}
              className="border-border bg-card block w-full rounded border px-2 py-1 font-mono text-xs"
            />
          </Field>
          <Field label="Refresh">
            <NumberInput
              value={soaRefresh}
              onChange={setSoaRefresh}
              min={0}
              disabled={!canEdit}
              className="border-border bg-card block w-full rounded border px-2 py-1 font-mono text-xs"
            />
          </Field>
          <Field label="Retry">
            <NumberInput
              value={soaRetry}
              onChange={setSoaRetry}
              min={0}
              disabled={!canEdit}
              className="border-border bg-card block w-full rounded border px-2 py-1 font-mono text-xs"
            />
          </Field>
          <Field label="Expire">
            <NumberInput
              value={soaExpire}
              onChange={setSoaExpire}
              min={0}
              disabled={!canEdit}
              className="border-border bg-card block w-full rounded border px-2 py-1 font-mono text-xs"
            />
          </Field>
          <Field label="Minimum">
            <NumberInput
              value={soaMinimum}
              onChange={setSoaMinimum}
              min={0}
              disabled={!canEdit}
              className="border-border bg-card block w-full rounded border px-2 py-1 font-mono text-xs"
            />
          </Field>
        </div>
      </div>

      <div className="border-border bg-background space-y-2 rounded-md border p-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={defaultForOn}
            disabled={!canEdit}
            onChange={(e) => setDefaultForOn(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Use this template by default for these PDNS servers
            <span className="text-muted-foreground text-caption ml-2 block">
              When ticked, the create-zone form auto-selects this template the moment the operator
              picks one of the chosen primaries.
            </span>
          </span>
        </label>

        {defaultForOn ? (
          primaries.length === 0 ? (
            <p className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap">
              No active PDNS primaries configured.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 pt-1">
              {primaries.map((p) => {
                const checked = defaultForIds.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={`text-body-sm inline-flex h-6 items-center gap-2 rounded-sm border px-2 ${
                      checked ? "border-primary bg-accent" : "border-border bg-card"
                    } ${canEdit ? "cursor-pointer" : "cursor-default opacity-45"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canEdit}
                      onChange={() => togglePrimaryId(p.id)}
                    />
                    {p.name}
                  </label>
                );
              })}
            </div>
          )
        ) : null}
      </div>

      {canEdit ? (
        <div className="flex items-center gap-3">
          <button
            aria-busy={saving}
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className={buttonClass({ variant: "primary", size: "sm" })}
          >
            Save settings
          </button>
          {!dirty ? (
            <span className="text-muted-foreground text-caption">No unsaved changes</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function normalizeKind(raw: string): string {
  if (raw === "Primary") return "Master";
  if (raw === "Secondary") return "Slave";
  return raw;
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      {children}
      {help ? <p className="text-muted-foreground text-caption mt-1">{help}</p> : null}
    </div>
  );
}

interface KindSelectProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

function KindSelect({ value, onChange, disabled }: KindSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const current = ZONE_KINDS.find((k) => k.value === value) ?? ZONE_KINDS[0];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="border-input bg-card text-body focus-visible:border-ring focus-visible:shadow-focus-ring flex h-8 w-full items-center justify-between rounded-md border px-3 text-left focus-visible:outline-hidden disabled:opacity-45"
      >
        <span>{current.label}</span>
        <span className="ml-2 opacity-60">▾</span>
      </button>
      {open ? (
        <ul className="border-border bg-card absolute right-0 left-0 z-10 mt-1 overflow-hidden rounded-md border py-1 text-xs">
          {ZONE_KINDS.map((k) => (
            <li
              key={k.value}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(k.value);
                setOpen(false);
              }}
              className={`cursor-pointer px-2 py-1.5 ${
                k.value === value ? "bg-background font-medium" : "hover:bg-background"
              }`}
            >
              <div>{k.label}</div>
              <div className="text-muted-foreground text-caption">{k.description}</div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface EnumSelectProps {
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

function EnumSelect({ value, options, onChange, disabled, placeholder }: EnumSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="border-input bg-card text-body focus-visible:border-ring focus-visible:shadow-focus-ring flex h-8 w-full items-center justify-between rounded-md border px-3 text-left font-mono focus-visible:outline-hidden disabled:opacity-45"
      >
        <span className={value ? "" : "text-muted-foreground"}>
          {value !== "" ? value : (placeholder ?? "Select…")}
        </span>
        <span className="ml-2 opacity-60">▾</span>
      </button>
      {open ? (
        <ul className="border-border bg-card absolute right-0 left-0 z-10 mt-1 max-h-60 overflow-auto rounded-md border py-1 text-xs">
          <li
            onMouseDown={(e) => {
              e.preventDefault();
              onChange("");
              setOpen(false);
            }}
            className={`text-muted-foreground cursor-pointer px-2 py-1.5 italic ${
              value === "" ? "bg-background" : "hover:bg-background"
            }`}
          >
            (unset - server default)
          </li>
          {options.map((o) => (
            <li
              key={o}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(o);
                setOpen(false);
              }}
              className={`cursor-pointer px-2 py-1.5 font-mono ${
                o === value ? "bg-background font-medium" : "hover:bg-background"
              }`}
            >
              {o}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
