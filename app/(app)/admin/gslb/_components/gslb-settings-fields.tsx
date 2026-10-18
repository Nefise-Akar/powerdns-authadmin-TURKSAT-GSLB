"use client";

/**
 * app/(app)/admin/gslb/_components/gslb-settings-fields.tsx
 *
 * The health-check, member and advanced-settings fields of the zone record
 * GSLB dialog, plus the helpers that turn drafts into request shapes
 * (ADR-0024 §5).
 *
 * Members get an automatic region: typing an IP pre-selects the region whose
 * CIDR rules contain it (longest prefix wins), marked "auto" until the
 * operator picks a region themselves.
 */

import { Checkbox } from "@/components/ui/checkbox";
import { buttonClass } from "@/components/ui/button";
import { Tag } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, inputClass } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { SelectMenu } from "@/components/ui/select-menu";
import {
  GSLB_DEFAULT_EXPECTED_STATUS,
  GSLB_DEFAULT_HTTP_PATH,
  GSLB_DEFAULT_MODE,
  GSLB_DEFAULT_TTL,
  GSLB_DEFAULT_WEIGHT,
  GSLB_MAX_MEMBERS,
  GSLB_MAX_TTL,
  GSLB_MAX_WEIGHT,
  GSLB_MIN_TTL,
  type GslbMember,
  type GslbMode,
  type GslbMonitorConfig,
  type GslbMonitorType,
  type GslbRecordKind,
} from "@/lib/gslb/model";
import { unassignedRegionWarning } from "@/lib/gslb/model";
import { regionForAddress } from "@/lib/validators/gslb-region-rules";
import type { ConfirmOptions } from "@/components/ui/dialog";

export interface RegionChoice {
  slug: string;
  name: string;
  rules: readonly string[];
}

export interface MemberDraft {
  key: number;
  content: string;
  /** "" = All clients. */
  region: string;
  /** The region was picked from the IP, not by the operator. */
  regionAuto: boolean;
  weight: number;
}

export interface MonitorDraft {
  type: GslbMonitorType;
  port: number;
  path: string;
  expectedStatus: string;
  tlsVerify: boolean;
}

const MONITOR_LABELS: Record<GslbMonitorType, string> = {
  http: "HTTP request",
  https: "HTTPS request",
  tcp: "TCP connect",
  tls: "TLS handshake",
  icmp: "ICMP ping",
};

const DEFAULT_PORT: Record<"tcp" | "tls", number> = { tcp: 80, tls: 443 };

export function monitorDraftFrom(
  config: GslbMonitorConfig | null,
  kind: GslbRecordKind,
): MonitorDraft {
  // Certificates are rarely issued for bare IPs, so verification starts off
  // for address members and on for host-name members.
  const base: MonitorDraft = {
    type: "http",
    port: DEFAULT_PORT.tls,
    path: GSLB_DEFAULT_HTTP_PATH,
    expectedStatus: GSLB_DEFAULT_EXPECTED_STATUS,
    tlsVerify: kind === "cname",
  };
  if (!config) return base;
  return {
    ...base,
    type: config.type,
    ...("port" in config ? { port: config.port } : {}),
    ...("path" in config ? { path: config.path, expectedStatus: config.expectedStatus } : {}),
    ...("tlsVerify" in config ? { tlsVerify: config.tlsVerify } : {}),
  };
}

export function monitorFromDraft(draft: MonitorDraft): GslbMonitorConfig {
  switch (draft.type) {
    case "icmp":
      return { type: "icmp" };
    case "tcp":
      return { type: "tcp", port: draft.port };
    case "tls":
      return { type: "tls", port: draft.port, tlsVerify: draft.tlsVerify };
    case "http":
      return { type: "http", path: draft.path, expectedStatus: draft.expectedStatus };
    case "https":
      return {
        type: "https",
        path: draft.path,
        expectedStatus: draft.expectedStatus,
        tlsVerify: draft.tlsVerify,
      };
  }
}

/** A draft for a member, with the region filled from the IP when not given. */
export function memberDraft(
  key: number,
  content: string,
  regions: readonly RegionChoice[],
  saved?: { region: string | null; weight: number },
): MemberDraft {
  const known = saved?.region && regions.some((r) => r.slug === saved.region) ? saved.region : "";
  if (known) {
    return {
      key,
      content,
      region: known,
      regionAuto: false,
      weight: saved?.weight ?? GSLB_DEFAULT_WEIGHT,
    };
  }
  const auto = regionForAddress(content, regions);
  return {
    key,
    content,
    region: auto ?? "",
    regionAuto: auto !== null,
    weight: saved?.weight ?? GSLB_DEFAULT_WEIGHT,
  };
}

export function membersPayload(members: readonly MemberDraft[]): GslbMember[] {
  return members.map((m) => ({
    content: m.content.trim(),
    region: m.region === "" ? null : m.region,
    weight: m.weight,
  }));
}

/** Advanced settings differ from the defaults - open the section so nothing in effect is hidden. */
export function advancedDiffers(settings: {
  mode: GslbMode;
  ttl: number;
  members: ReadonlyArray<{ weight: number }>;
}): boolean {
  return (
    settings.mode !== GSLB_DEFAULT_MODE ||
    settings.ttl !== GSLB_DEFAULT_TTL ||
    settings.members.some((m) => m.weight !== GSLB_DEFAULT_WEIGHT)
  );
}

export function MonitorFields({
  kind,
  value,
  onChange,
}: {
  kind: GslbRecordKind;
  value: MonitorDraft;
  onChange: (next: MonitorDraft) => void;
}) {
  const types: GslbMonitorType[] =
    kind === "cname" ? ["http", "https"] : ["http", "https", "tcp", "tls", "icmp"];
  const showPath = value.type === "http" || value.type === "https";
  const showPort = value.type === "tcp" || value.type === "tls";
  const showVerify = value.type === "https" || value.type === "tls";
  return (
    <fieldset className="space-y-3">
      <legend className="text-label text-foreground">Health check</legend>
      <SelectMenu
        value={value.type}
        onChange={(type) =>
          onChange({
            ...value,
            type,
            ...(type === "tcp" || type === "tls" ? { port: DEFAULT_PORT[type] } : {}),
          })
        }
        ariaLabel="Health check"
        options={types.map((t) => ({ value: t, label: MONITOR_LABELS[t] }))}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {showPath ? (
          <>
            <Field label="Path">
              <input
                value={value.path}
                onChange={(e) => onChange({ ...value, path: e.target.value })}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field label="Healthy status codes" hint="e.g. 200-399 or 200,204">
              <input
                value={value.expectedStatus}
                onChange={(e) => onChange({ ...value, expectedStatus: e.target.value })}
                className={`${inputClass} font-mono`}
              />
            </Field>
          </>
        ) : null}
        {showPort ? (
          <Field label="Port">
            <NumberInput
              value={value.port}
              min={1}
              max={65535}
              onChange={(port) => onChange({ ...value, port })}
            />
          </Field>
        ) : null}
      </div>
      {showVerify ? (
        <Checkbox
          checked={value.tlsVerify}
          onChange={(tlsVerify) => onChange({ ...value, tlsVerify })}
          label="Verify the TLS certificate (checked against the member's address or host name)"
        />
      ) : null}
    </fieldset>
  );
}

export function MemberRows({
  kind,
  members,
  regions,
  onChange,
  nextKey,
}: {
  kind: GslbRecordKind;
  members: MemberDraft[];
  regions: readonly RegionChoice[];
  onChange: (next: MemberDraft[]) => void;
  /** A key no current member uses. */
  nextKey: number;
}) {
  const regionOptions = [
    { value: "", label: "All clients" },
    ...regions.map((r) => ({ value: r.slug, label: r.name })),
  ];
  const update = (key: number, patch: Partial<MemberDraft>) =>
    onChange(members.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  function setContent(member: MemberDraft, content: string) {
    // Re-derive the region while it is still empty or automatic; never
    // overwrite one the operator picked.
    if (member.region === "" || member.regionAuto) {
      const auto = kind === "address" ? regionForAddress(content, regions) : null;
      update(member.key, { content, region: auto ?? "", regionAuto: auto !== null });
    } else {
      update(member.key, { content });
    }
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-label text-foreground">Members</legend>
      <p className="text-muted-foreground text-xs">
        Each member answers for its region first; if every member of a region is down, clients there
        get the others.
        {kind === "cname" ? " Members are host names (one answer at a time)." : ""}
      </p>
      {members.map((member, index) => (
        <div key={member.key} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            aria-label={`Member ${index + 1} ${kind === "cname" ? "host name" : "address"}`}
            value={member.content}
            onChange={(e) => setContent(member, e.target.value)}
            placeholder={kind === "cname" ? "app.site-a.example.com" : "192.0.2.10"}
            className={`${inputClass} font-mono sm:flex-1`}
            required
          />
          <span className="flex items-center gap-1.5 sm:w-56">
            <SelectMenu
              value={member.region}
              onChange={(region) => update(member.key, { region, regionAuto: false })}
              ariaLabel={`Member ${index + 1} region`}
              options={regionOptions}
              className="min-w-0 flex-1"
            />
            {member.regionAuto && member.region !== "" ? (
              <Tag title="Picked from the address and this backend's region ranges. Choose another region to override.">
                auto
              </Tag>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => onChange(members.filter((m) => m.key !== member.key))}
            disabled={members.length <= 1}
            className={buttonClass({ size: "sm", variant: "ghost" })}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...members,
            {
              key: nextKey,
              content: "",
              region: "",
              regionAuto: false,
              weight: GSLB_DEFAULT_WEIGHT,
            },
          ])
        }
        disabled={members.length >= GSLB_MAX_MEMBERS}
        className={buttonClass({ size: "sm" })}
      >
        + Add member
      </button>
      {regions.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          This backend has no regions yet, so every member serves all clients. Add regions on the
          GSLB backend page to answer each site with its own members.
        </p>
      ) : null}
      {members.length === 1 ? (
        <p className="text-warning text-xs">
          One member gives health-checked answers but nothing to fail over to. Add at least two.
        </p>
      ) : null}
    </fieldset>
  );
}

export function AdvancedFields({
  mode,
  onMode,
  ttl,
  onTtl,
  members,
  onMembers,
  defaultOpen,
}: {
  mode: GslbMode;
  onMode: (mode: GslbMode) => void;
  ttl: number;
  onTtl: (ttl: number) => void;
  members: MemberDraft[];
  onMembers: (next: MemberDraft[]) => void;
  defaultOpen: boolean;
}) {
  return (
    <Disclosure label="Advanced settings" defaultOpen={defaultOpen} bodyClassName="mt-3 space-y-4">
      <Field
        label="Mode"
        hint="Both modes fail over automatically when a server is down; the mode only decides whether healthy servers in the same region share traffic."
      >
        <SelectMenu
          value={mode}
          onChange={onMode}
          ariaLabel="Mode"
          options={[
            {
              value: "failover",
              label: "Failover",
              description: "Answer from the highest-weight healthy members",
            },
            {
              value: "distribute",
              label: "Distribute",
              description: "Pick one healthy member at random, by weight",
            },
          ]}
        />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-label text-foreground">Weights</legend>
        <p className="text-muted-foreground text-xs">
          {mode === "failover"
            ? "Failover: only the highest-weight healthy members answer; lower weights are standby."
            : "Distribute: each member's share of answers is proportional to its weight."}{" "}
          0-{GSLB_MAX_WEIGHT}.
        </p>
        {members.map((member, index) => (
          <div key={member.key} className="flex items-center gap-2">
            <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
              {member.content || `Member ${index + 1}`}
            </span>
            <NumberInput
              value={member.weight}
              min={0}
              max={GSLB_MAX_WEIGHT}
              ariaLabel={`Member ${index + 1} weight`}
              onChange={(weight) =>
                onMembers(members.map((m) => (m.key === member.key ? { ...m, weight } : m)))
              }
              className="w-24"
            />
          </div>
        ))}
      </fieldset>
      <Field
        label="TTL (seconds)"
        hint="Short TTLs make failover faster: resolvers re-ask sooner after a member goes down."
      >
        <NumberInput value={ttl} min={GSLB_MIN_TTL} max={GSLB_MAX_TTL} onChange={onTtl} />
      </Field>
    </Disclosure>
  );
}

/**
 * When the backend has regions but some members have none, ask before saving:
 * those servers answer every client, so nobody gets a nearby one. Resolves
 * true to go ahead (also when there is nothing to warn about).
 */
export async function confirmUnassignedRegions(
  confirm: (options: ConfirmOptions) => Promise<boolean>,
  members: readonly MemberDraft[],
  regionCount: number,
): Promise<boolean> {
  const message = unassignedRegionWarning(
    members.filter((m) => m.region === "").length,
    regionCount,
  );
  if (!message) return true;
  return confirm({
    title: "Servers without a region",
    description: message,
    confirmLabel: "Save anyway",
  });
}
