"use client";

/**
 * app/(app)/zones/[zoneId]/_components/gslb-record-cells.tsx
 *
 * The record table's GSLB pieces (ADR-0024 §3, §8): the per-row switch -
 * shown disabled with its reason when a name can't be balanced, never hidden
 * - and the summary that replaces a managed name's CNAME value (members with
 * live state, regions, mode, health check).
 */

import { Tag } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { GslbMonitorConfig } from "@/lib/gslb/model";
import type { GslbRecordView, GslbTableContext } from "../_lib/gslb-context";

const NO_PERMISSION_REASON =
  "Switching GSLB needs record create, update and delete permissions on this zone.";

export function describeMonitor(monitor: GslbMonitorConfig): string {
  switch (monitor.type) {
    case "icmp":
      return "ICMP ping";
    case "tcp":
      return `TCP ${monitor.port}`;
    case "tls":
      return `TLS ${monitor.port}`;
    case "http":
      return `HTTP ${monitor.path}`;
    case "https":
      return `HTTPS ${monitor.path}`;
  }
}

export function GslbSwitchCell({
  name,
  context,
  onEnable,
  onEdit,
  onDisable,
}: {
  name: string;
  context: GslbTableContext;
  onEnable: () => void;
  onEdit: () => void;
  onDisable: () => void;
}) {
  const managed = context.records[name];
  const eligibility = context.eligibility[name];
  const blocked = !context.canToggle;

  if (managed) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Switch
          checked
          disabled={blocked}
          onChange={onDisable}
          ariaLabel={`Switch off GSLB for ${name}`}
        />
        {!blocked ? (
          <button
            type="button"
            onClick={onEdit}
            className={buttonClass({ variant: "link", size: "xs", className: "px-1" })}
          >
            Settings
          </button>
        ) : null}
      </span>
    );
  }
  if (!eligibility) return <span className="text-muted-foreground text-xs">-</span>;
  if (!eligibility.eligible) {
    return (
      <span className="flex items-start gap-2">
        <Switch
          checked={false}
          disabled
          onChange={() => undefined}
          ariaLabel={`GSLB unavailable for ${name}`}
        />
        <span className="text-muted-foreground text-xs">{eligibility.reason}</span>
      </span>
    );
  }
  return (
    <span className="flex items-start gap-2" title={blocked ? NO_PERMISSION_REASON : undefined}>
      <Switch
        checked={false}
        disabled={blocked}
        onChange={onEnable}
        ariaLabel={`Switch on GSLB for ${name}`}
      />
      {blocked ? (
        <span className="text-muted-foreground text-xs">{NO_PERMISSION_REASON}</span>
      ) : null}
    </span>
  );
}

/** Replaces a managed name's CNAME value: one logical row for the whole GSLB record. */
export function GslbManagedValue({
  record,
  statusError,
}: {
  record: GslbRecordView;
  statusError: string | null;
}) {
  return (
    <span className="flex flex-col gap-1.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <Tag>GSLB</Tag>
        <span className="text-muted-foreground text-xs">
          {record.mode === "failover" ? "Failover" : "Distribute"} ·{" "}
          {describeMonitor(record.monitor)} · TTL {record.ttl}
        </span>
      </span>
      <ul className="space-y-0.5">
        {record.members.map((member) => (
          <li key={member.content} className="flex flex-wrap items-center gap-1.5 text-xs">
            <MemberState state={member.state} unavailable={statusError !== null} />
            <span className="font-mono break-all">{member.content.replace(/\.$/, "")}</span>
            <span className="text-muted-foreground">{member.regionName ?? "All clients"}</span>
          </li>
        ))}
      </ul>
      {statusError ? (
        <span className="text-muted-foreground text-xs" title={statusError}>
          Status unavailable
        </span>
      ) : null}
    </span>
  );
}

/** Dot plus word, so health never rests on color alone. */
function MemberState({ state, unavailable }: { state: "On" | "Off" | null; unavailable: boolean }) {
  if (unavailable || state === null) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1" title="No health data">
        <span aria-hidden className="bg-muted-foreground h-1.5 w-1.5 rounded-full" />?
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${state === "On" ? "bg-success" : "bg-destructive"}`}
      />
      {state === "On" ? "Up" : "Down"}
    </span>
  );
}
