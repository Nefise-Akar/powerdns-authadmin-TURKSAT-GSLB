"use client";

/**
 * Per-template Zone-settings editor. Mirrors the zone-detail Zone-settings
 * panel: zone Type (kind), SOA-EDIT, SOA-EDIT-API, API-RECTIFY toggle,
 * plus SOA timers. When a zone is created from this template the apply
 * path (in app/api/admin/pdns/zones/route.ts) PUTs these fields onto the
 * created zone via the same `updateZoneSettings` client call.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDialog } from "@/components/ui/dialog";
import { mutate } from "@/lib/client/api-fetch";
import { Switch } from "@/components/ui/switch";
import { SelectMenu, type SelectOption } from "@/components/ui/select-menu";
import { NumberInput } from "@/components/ui/number-input";
import { buttonClass } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

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

// The empty value means "unset" - zones created from the template then follow
// the server-wide default - so it is offered as a pickable option.
const UNSET_OPTION: SelectOption<string> = { value: "", label: "(server default)" };

const SOA_EDIT_OPTIONS: ReadonlyArray<SelectOption<string>> = [
  UNSET_OPTION,
  ...["DEFAULT", "INCREASE", "EPOCH", "INCEPTION-INCREMENT", "INCEPTION-EPOCH", "NONE"].map(
    (value) => ({ value, label: value }),
  ),
];

const SOA_EDIT_API_OPTIONS: ReadonlyArray<SelectOption<string>> = [
  UNSET_OPTION,
  ...["DEFAULT", "INCREASE", "SOA-EDIT", "SOA-EDIT-INCREASE", "EPOCH", "NONE"].map((value) => ({
    value,
    label: value,
  })),
];

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
        <Field label="Zone Type" hint="Default kind applied at zone create.">
          <SelectMenu value={kind} options={ZONE_KINDS} onChange={setKind} disabled={!canEdit} />
        </Field>
        <Field label="API-RECTIFY" hint="Auto-rectify zone after every API change.">
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
        <Field label="SOA-EDIT" hint="Algorithm for the serial sent to secondaries.">
          <SelectMenu
            value={soaEdit}
            options={SOA_EDIT_OPTIONS}
            onChange={setSoaEdit}
            disabled={!canEdit}
          />
        </Field>
        <Field label="SOA-EDIT-API" hint="Algorithm for serial bumps after API edits.">
          <SelectMenu
            value={soaEditApi}
            options={SOA_EDIT_API_OPTIONS}
            onChange={setSoaEditApi}
            disabled={!canEdit}
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
            Use this template by default for these PowerDNS servers
            <span className="text-muted-foreground text-caption ml-2 block">
              When ticked, the create-zone form auto-selects this template the moment the operator
              picks one of the chosen primaries.
            </span>
          </span>
        </label>

        {defaultForOn ? (
          primaries.length === 0 ? (
            <p className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap">
              No active PowerDNS primaries configured.
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
