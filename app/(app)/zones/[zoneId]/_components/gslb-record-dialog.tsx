"use client";

/**
 * app/(app)/zones/[zoneId]/_components/gslb-record-dialog.tsx
 *
 * Switch GSLB on for a record, or edit it while on (ADR-0024 §3, §5).
 *
 * Progressive disclosure: the main body asks only for what most operators
 * change - backend (when there's a choice), health check, and members with
 * their region (pre-selected from the IP). Mode, per-member weight and TTL sit
 * in a collapsed "Advanced settings" section with defaults (Failover, 10,
 * 30 s); it opens by itself when the values in effect differ. Last-used
 * settings of a name are offered (never applied) when switching it on again.
 * The server validates and audits every field either way.
 */

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { Dialog, useDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { SelectMenu } from "@/components/ui/select-menu";
import {
  GSLB_DEFAULT_MODE,
  GSLB_DEFAULT_TTL,
  type GslbMode,
  type GslbRecordKind,
} from "@/lib/gslb/model";
import { useGslbFetch } from "@/app/(app)/admin/gslb/_lib/use-gslb-fetch";
import {
  AdvancedFields,
  advancedDiffers,
  confirmUnassignedRegions,
  memberDraft,
  MemberRows,
  membersPayload,
  monitorDraftFrom,
  MonitorFields,
  monitorFromDraft,
  type MemberDraft,
  type MonitorDraft,
} from "@/app/(app)/admin/gslb/_components/gslb-settings-fields";
import type { GslbRecordView, GslbTableContext } from "../_lib/gslb-context";

interface ResponseBody {
  error?: string;
  newZone?: boolean;
  details?: { fieldErrors?: Record<string, string[]> };
}

export interface GslbDialogTarget {
  name: string;
  /** Owner name as shown in the table (`www`, `@`). */
  displayName: string;
  kind: GslbRecordKind;
  /** Current parent contents - the enable prefill. */
  currentContents: string[];
  /** Saved settings when GSLB is already on. */
  existing: GslbRecordView | null;
}

interface Props {
  target: GslbDialogTarget;
  context: GslbTableContext;
  zoneIdEncoded: string;
  serverSlug: string;
  onClose: () => void;
}

const KEY_BASE = 1000;

export function GslbRecordDialog({ target, context, zoneIdEncoded, serverSlug, onClose }: Props) {
  const router = useRouter();
  const { toast, confirm } = useDialog();
  const gslbFetch = useGslbFetch();
  const existing = target.existing;
  const isEdit = existing !== null;

  // Last settings for this name (GSLB was on before) - offered as the
  // starting point, applied only when the operator confirms.
  const preset = existing ? null : (context.presets[target.name] ?? null);
  const presetBackendUsable =
    preset !== null && context.backends.some((b) => b.id === preset.backendId);

  const defaultBackend =
    context.zoneBackendId ??
    context.backends.find((b) => b.nameserverReady)?.id ??
    context.backends[0]?.id ??
    "";
  const [backendId, setBackendId] = useState(
    presetBackendUsable && context.zoneBackendId === null ? preset.backendId : defaultBackend,
  );
  const backend = context.backends.find((b) => b.id === backendId) ?? null;
  const showBackendPicker = context.zoneBackendId === null && context.backends.length > 1;
  const newZone = context.zoneBackendId === null;
  const regions = backend?.regions ?? [];

  const sameContent = (a: string, b: string) =>
    a.replace(/\.$/, "").toLowerCase() === b.replace(/\.$/, "").toLowerCase();

  /** Members from the current contents, with a preset's region/weight where it still matches. */
  function membersFromCurrent(usePreset: boolean): MemberDraft[] {
    return target.currentContents.map((content, index) => {
      const remembered = usePreset
        ? preset?.members.find((m) => sameContent(m.content, content))
        : undefined;
      return memberDraft(index, content.replace(/\.$/, ""), regions, remembered);
    });
  }

  const [members, setMembers] = useState<MemberDraft[]>(() =>
    existing
      ? existing.members.map((m, index) =>
          memberDraft(index, m.content.replace(/\.$/, ""), regions, m),
        )
      : membersFromCurrent(true),
  );
  const [monitor, setMonitor] = useState<MonitorDraft>(() =>
    monitorDraftFrom(existing?.monitor ?? preset?.monitor ?? null, target.kind),
  );
  const [mode, setMode] = useState<GslbMode>(existing?.mode ?? preset?.mode ?? GSLB_DEFAULT_MODE);
  const [ttl, setTtl] = useState(existing?.ttl ?? preset?.ttl ?? GSLB_DEFAULT_TTL);
  const [presetLoaded, setPresetLoaded] = useState(preset !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);

  const nextKey = KEY_BASE + members.reduce((max, m) => Math.max(max, m.key), 0) + 1;
  const loaded = existing ?? preset;
  const openAdvanced = loaded !== null && advancedDiffers(loaded);

  function resetToDefaults() {
    setMembers(membersFromCurrent(false));
    setMonitor(monitorDraftFrom(null, target.kind));
    setMode(GSLB_DEFAULT_MODE);
    setTtl(GSLB_DEFAULT_TTL);
    setBackendId(defaultBackend);
    setPresetLoaded(false);
  }

  function changeBackend(next: string) {
    // Regions belong to a backend; drop picks the new one doesn't have.
    const slugs = new Set(context.backends.find((b) => b.id === next)?.regions.map((r) => r.slug));
    setMembers((list) =>
      list.map((m) =>
        m.region && !slugs.has(m.region) ? { ...m, region: "", regionAuto: false } : m,
      ),
    );
    setBackendId(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!(await confirmUnassignedRegions(confirm, members, regions.length))) return;
    setError(null);
    setFieldErrors([]);
    setSaving(true);
    const body: Record<string, unknown> = {
      serverSlug,
      name: target.name,
      mode,
      ttl,
      monitor: monitorFromDraft(monitor),
      members: membersPayload(members),
    };
    if (!isEdit) {
      body["expected"] = context.expected[target.name] ?? [];
      if (showBackendPicker) body["backendId"] = backendId;
    }
    try {
      const res = await gslbFetch(`/api/admin/pdns/zones/${zoneIdEncoded}/gslb`, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as ResponseBody | null;
      if (!res.ok) {
        setError(data?.error ?? "Saving failed.");
        setFieldErrors(Object.values(data?.details?.fieldErrors ?? {}).flat());
        return;
      }
      const title = isEdit ? "GSLB settings saved" : `GSLB is on for ${target.displayName}`;
      if (data?.newZone) {
        toast({
          kind: "success",
          title,
          description:
            "This zone's GSLB subzone is new; it can take up to ~5 minutes before PowerGSLB starts answering for it.",
        });
      } else {
        toast({ kind: "success", description: `${title}.` });
      }
      onClose();
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        isEdit
          ? `GSLB settings for ${target.displayName}`
          : `Switch on GSLB for ${target.displayName}`
      }
      description={
        isEdit
          ? undefined
          : "PowerGSLB will answer for this name, sending clients to healthy servers - their own site first."
      }
      maxWidthClass="max-w-2xl"
      dismissOnBackdrop={false}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {showBackendPicker ? (
          <Field label="GSLB backend">
            <SelectMenu
              value={backendId}
              onChange={changeBackend}
              ariaLabel="GSLB backend"
              options={context.backends.map((b) => ({ value: b.id, label: b.name }))}
            />
          </Field>
        ) : null}

        {presetLoaded ? (
          <p className="text-muted-foreground text-xs">
            Last used settings loaded.{" "}
            <button
              type="button"
              onClick={resetToDefaults}
              className={buttonClass({ variant: "link", size: "xs", className: "px-0" })}
            >
              Reset to defaults
            </button>
          </p>
        ) : null}

        {newZone && backend && !backend.nameserverReady ? (
          <Alert title="nameserver missing">
            {backend.name} has no nameserver host and addresses. Set them on the GSLB backend page -
            this zone delegates its gslb subzone to that nameserver.
          </Alert>
        ) : null}
        {newZone && !isEdit ? (
          <p className="text-muted-foreground text-xs">
            This is the first GSLB record in this zone: the panel also adds the zone&apos;s gslb
            subzone and its delegation. A new subzone can take up to ~5 minutes before PowerGSLB
            answers for it.
          </p>
        ) : null}

        <MonitorFields kind={target.kind} value={monitor} onChange={setMonitor} />
        <MemberRows
          kind={target.kind}
          members={members}
          regions={regions}
          onChange={setMembers}
          nextKey={nextKey}
        />
        <AdvancedFields
          mode={mode}
          onMode={setMode}
          ttl={ttl}
          onTtl={setTtl}
          members={members}
          onMembers={setMembers}
          defaultOpen={openAdvanced}
        />

        {error ? (
          <Alert variant="destructive" live>
            {/* Field messages say what to fix; the generic "Invalid input." adds nothing. */}
            {fieldErrors.length > 0 ? fieldErrors.join(" ") : error}
          </Alert>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={buttonClass()}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || (newZone && !backend?.nameserverReady)}
            aria-busy={saving}
            className={buttonClass({ variant: "primary" })}
            data-dialog-focus="true"
          >
            {saving ? "Saving…" : isEdit ? "Save GSLB settings" : "Switch on GSLB"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
