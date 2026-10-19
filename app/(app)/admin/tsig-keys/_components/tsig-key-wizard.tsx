"use client";

/**
 * app/(app)/admin/tsig-keys/_components/tsig-key-wizard.tsx
 *
 * The "create / set up a TSIG key" wizard - a themed modal that replaces the old
 * always-on "add key" form + install panel. Steps:
 *
 *   1. Generate - name + algorithm (themed dropdown). PDNS mints the secret
 *      server-side; the plaintext never reaches the browser on this path.
 *   2. Install - pick a method via a themed dropdown:
 *        • Automatic (API): server pushes the secret to each secondary. No
 *          secret shown. Per-secondary outcome chips.
 *        • Manual (pdnsutil): fetch a version-agnostic copy-paste script (the
 *          secret rides back as text/plain, re-fetched server-side) to run on
 *          each box.
 *   3. Secure zones (only when the backend is a primary with zones): select the
 *      zones this key should authenticate AXFR for. Additive - never clobbers
 *      keys already on a zone.
 *
 * Re-used for an EXISTING key (skips step 1) so a key can be (re)installed after,
 * say, adding a secondary.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { apiFetch, mutate } from "@/lib/client/api-fetch";
import { Dialog, useDialog } from "@/components/ui/dialog";
import { SelectMenu, type SelectOption } from "@/components/ui/select-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

export interface InstallSecondary {
  slug: string;
  name: string;
  supportsTsigApi: boolean;
}

const ALGORITHMS: Array<SelectOption<string>> = [
  { value: "hmac-sha256", label: "hmac-sha256", description: "Recommended default." },
  { value: "hmac-sha512", label: "hmac-sha512" },
  { value: "hmac-sha384", label: "hmac-sha384" },
  { value: "hmac-sha224", label: "hmac-sha224" },
  { value: "hmac-sha1", label: "hmac-sha1", description: "Legacy interop only." },
  { value: "hmac-md5", label: "hmac-md5", description: "Legacy interop only." },
];

type Method = "auto" | "manual";
const METHODS: Array<SelectOption<Method>> = [
  {
    value: "auto",
    label: "Automatic (API)",
    description: "Push the secret to each secondary's API. No secret is shown.",
  },
  {
    value: "manual",
    label: "Manual (pdnsutil)",
    description: "Copy a script (contains the secret) to run on each secondary.",
  },
];

interface InstallResult {
  serverSlug: string;
  serverName: string;
  outcome: "created" | "unchanged" | "conflict" | "unsupported" | "unreachable" | "error";
}

const OUTCOME_LABEL: Record<InstallResult["outcome"], string> = {
  created: "installed",
  unchanged: "already present",
  conflict: "conflict - different secret exists",
  unsupported: "no TSIG API (use manual)",
  unreachable: "unreachable",
  error: "failed",
};

function outcomeClass(o: InstallResult["outcome"]): string {
  if (o === "created" || o === "unchanged") return "text-success";
  if (o === "unsupported") return "text-muted-foreground";
  return "text-destructive";
}

type Step = "generate" | "install" | "zones";

interface Props {
  serverSlug: string;
  secondaries: InstallSecondary[];
  /** The primary's authoritative zone names (Master/Primary) - for activation. */
  zones: string[];
  /** Set to (re)install an existing key - the wizard skips the Generate step. */
  existing?: {
    keyId: string;
    keyName: string;
    startStep?: "install" | "zones";
    configuredZones?: string[];
  };
  onClose: () => void;
  /** Called after a key is created so the table refreshes behind the modal. */
  onChanged: () => void;
}

export function TsigKeyWizard({
  serverSlug,
  secondaries,
  zones,
  existing,
  onClose,
  onChanged,
}: Props) {
  const { toast } = useDialog();

  const initialStep: Step = existing
    ? existing.startStep === "zones" && zones.length > 0
      ? "zones"
      : "install"
    : "generate";
  const [step, setStep] = useState<Step>(initialStep);
  const [key, setKey] = useState<{ id: string; name: string } | null>(
    existing ? { id: existing.keyId, name: existing.keyName } : null,
  );

  // Step 1 - generate.
  const [name, setName] = useState("");
  const [algorithm, setAlgorithm] = useState("hmac-sha256");
  const [creating, setCreating] = useState(false);

  // Step 2 - install.
  const [method, setMethod] = useState<Method>("auto");
  const [installing, setInstalling] = useState(false);
  const [results, setResults] = useState<InstallResult[] | null>(null);
  const [script, setScript] = useState<string | null>(null);
  const [loadingScript, setLoadingScript] = useState(false);

  // Step 3 - zones.
  const configuredZones = useMemo(
    () => new Set(existing?.configuredZones ?? []),
    [existing?.configuredZones],
  );
  const [selectedZones, setSelectedZones] = useState<Set<string>>(
    () => new Set(existing?.configuredZones ?? []),
  );
  const [activating, setActivating] = useState(false);

  const managed = secondaries.filter((s) => s.supportsTsigApi).length;
  const path = (suffix: string) =>
    key ? `/api/admin/pdns/tsig-keys/${encodeURIComponent(key.id)}/${suffix}` : "";

  // Manual script is fetched lazily the first time the method switches to manual.
  useEffect(() => {
    if (step !== "install" || method !== "manual" || !key || script || loadingScript) return;
    let cancelled = false;
    setLoadingScript(true);
    void apiFetch(path("manual"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverSlug }),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          toast({ kind: "error", title: "Couldn't build script", description: "See server logs." });
          return;
        }
        setScript(await res.text());
      })
      .finally(() => {
        if (!cancelled) setLoadingScript(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, method, key]);

  async function generate() {
    if (!name.trim()) {
      toast({ kind: "error", description: "Enter a name." });
      return;
    }
    setCreating(true);
    try {
      const res = await mutate("/api/admin/pdns/tsig-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverSlug, name: name.trim(), algorithm }),
      });
      if (!res.ok) {
        toast({ kind: "error", title: "Create failed", description: res.error });
        return;
      }
      const minted = (res.data as { tsigKey: { id: string; name: string } }).tsigKey;
      setKey({ id: minted.id, name: minted.name });
      onChanged();
      toast({ kind: "success", description: `Key “${minted.name}” created.` });
      setStep("install");
    } finally {
      setCreating(false);
    }
  }

  async function installAuto() {
    if (!key) return;
    setInstalling(true);
    try {
      const res = await mutate(path("install"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverSlug }),
      });
      if (!res.ok) {
        toast({ kind: "error", title: "Install failed", description: res.error });
        return;
      }
      const data = res.data as { results: InstallResult[] };
      setResults(data.results);
      const bad = data.results.filter(
        (r) => r.outcome === "conflict" || r.outcome === "unreachable" || r.outcome === "error",
      ).length;
      toast({
        kind: bad > 0 ? "error" : "success",
        title: bad > 0 ? "Installed with issues" : "Installed on secondaries",
        description:
          bad > 0
            ? `${data.results.length - bad} ok, ${bad} need attention - see below.`
            : `Replicated to ${data.results.length} secondary(ies).`,
      });
    } finally {
      setInstalling(false);
    }
  }

  async function mapLimit<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const out: R[] = [];
    for (let i = 0; i < items.length; i += limit) {
      out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
    }
    return out;
  }

  const addedZones = useMemo(
    () => [...selectedZones].filter((zone) => !configuredZones.has(zone)),
    [configuredZones, selectedZones],
  );
  const removedZones = useMemo(
    () => [...configuredZones].filter((zone) => !selectedZones.has(zone)),
    [configuredZones, selectedZones],
  );
  const changeCount = addedZones.length + removedZones.length;
  const hasSelectionChanges = changeCount > 0;

  async function applyZonesInBackground(
    changes: Array<{ zone: string; mode: "add" | "remove" }>,
    keyName: string,
  ) {
    const results = await mapLimit(changes, 6, async ({ zone, mode }) => {
      const res = await mutate(`/api/admin/pdns/zones/${encodeURIComponent(zone)}/tsig-transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Non-clobbering: the route adds/removes only this key from each zone.
        body: JSON.stringify({ serverSlug, keyName, mode }),
      });
      return res.ok;
    });
    const failed = results.filter((ok) => !ok).length;
    toast({
      kind: failed > 0 ? "error" : "success",
      title: failed > 0 ? "Some domains failed" : `Key ${keyName} applied`,
      description:
        failed > 0
          ? `${changes.length - failed}/${changes.length} domain changes completed.`
          : `Key ${keyName} updated on ${changes.length} domain${changes.length === 1 ? "" : "s"} successfully.`,
    });
    onChanged();
  }

  function applyZones() {
    if (!key || !hasSelectionChanges) return;
    setActivating(true);
    const changes = [
      ...addedZones.map((zone) => ({ zone, mode: "add" as const })),
      ...removedZones.map((zone) => ({ zone, mode: "remove" as const })),
    ];
    const keyName = key.name;
    toast({
      kind: "info",
      title: "Applying TSIG key",
      description: `Started ${changes.length} domain change${changes.length === 1 ? "" : "s"}. You can keep working.`,
    });
    onClose();
    void applyZonesInBackground(changes, keyName);
  }

  const stepNo = step === "generate" ? 1 : step === "install" ? 2 : 3;
  const totalSteps = zones.length > 0 ? 3 : 2;
  const heading =
    step === "generate"
      ? "Generate key"
      : step === "install"
        ? "Install on secondaries"
        : "Secure zones";
  const modalWidth = step === "zones" ? "max-w-4xl" : "max-w-lg";

  return (
    // The shared <Dialog> brings the focus trap, initial focus, focus restore,
    // Esc handling, page lock and backdrop; the wizard only owns its steps.
    // The title is announced from the dialog's hidden <h2>; the visible
    // heading row below pairs it with the step counter.
    <Dialog open onClose={onClose} title={heading} hideTitle maxWidthClass={modalWidth}>
      <div>
        <div>
          <div className="flex items-baseline justify-between">
            <div className="text-lg font-semibold" aria-hidden>
              {heading}
            </div>
            <span className="text-muted-foreground text-xs">
              Step {existing ? stepNo - 1 : stepNo} of {existing ? totalSteps - 1 : totalSteps}
            </span>
          </div>
          {key ? (
            <p className="text-muted-foreground mt-1 text-xs">
              Key <span className="font-mono">{key.name}</span> on{" "}
              <span className="font-mono">{serverSlug}</span>
            </p>
          ) : null}

          <div className="mt-4">
            {step === "generate" ? (
              <div className="space-y-4">
                <div>
                  <label htmlFor="wiz-tsig-name" className="block text-xs font-medium">
                    Name
                  </label>
                  <input
                    id="wiz-tsig-name"
                    type="text"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !creating) void generate();
                    }}
                    placeholder="primary-to-secondary"
                    className={`mt-1 w-full font-mono ${inputClass}`}
                  />
                </div>
                <div>
                  <span className="block text-xs font-medium">Algorithm</span>
                  <div className="mt-1">
                    <SelectMenu
                      value={algorithm}
                      options={ALGORITHMS}
                      onChange={setAlgorithm}
                      ariaLabel="TSIG algorithm"
                    />
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">
                  PowerDNS generates the HMAC secret server-side. With the automatic install you
                  never see it; choose manual to get a copy-paste script that includes it.
                </p>
              </div>
            ) : null}

            {step === "install" ? (
              <div className="space-y-4">
                <div>
                  <span className="block text-xs font-medium">Method</span>
                  <div className="mt-1">
                    <SelectMenu
                      value={method}
                      options={METHODS}
                      onChange={(m) => {
                        setMethod(m);
                        setResults(null);
                      }}
                      ariaLabel="Install method"
                    />
                  </div>
                </div>

                {method === "auto" ? (
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-xs">
                      {secondaries.length > 0
                        ? `${managed} of ${secondaries.length} secondaries support API install. The same secret is pushed to each; conflicts are reported, never overwritten.`
                        : "No app-managed secondaries - switch to manual and run the script on each box."}
                    </p>
                    {managed > 0 ? (
                      <button
                        aria-busy={installing}
                        type="button"
                        onClick={installAuto}
                        disabled={installing}
                        className={buttonClass({ variant: "primary" })}
                      >
                        {`Install via API (${managed})`}
                      </button>
                    ) : null}
                    {results ? (
                      <ul className="space-y-0.5 text-xs">
                        {results.map((r) => (
                          <li key={r.serverSlug} className="flex items-center gap-2">
                            <span className="font-mono">{r.serverName}</span>
                            <span className={outcomeClass(r.outcome)}>
                              - {OUTCOME_LABEL[r.outcome]}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">
                        Run on each secondary (contains the secret - handle carefully):
                      </span>
                      {script ? (
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard?.writeText(script)}
                          className="text-xs underline"
                        >
                          Copy
                        </button>
                      ) : null}
                    </div>
                    {loadingScript ? (
                      <p className="text-muted-foreground text-xs">Building script…</p>
                    ) : script ? (
                      <pre className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 max-h-64 items-center overflow-auto rounded-sm px-1.5 font-mono break-all whitespace-nowrap whitespace-pre-wrap">
                        {script}
                      </pre>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            {step === "zones" ? (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="border-border bg-background rounded-md border p-3">
                    <div className="text-caption text-muted-foreground">Domains</div>
                    <div className="mt-1 text-lg font-semibold">{zones.length}</div>
                  </div>
                  <div className="border-border bg-background rounded-md border p-3">
                    <div className="text-caption text-muted-foreground">Selected</div>
                    <div className="mt-1 text-lg font-semibold">{selectedZones.size}</div>
                  </div>
                  <div className="border-border bg-background rounded-md border p-3">
                    <div className="text-caption text-muted-foreground">Key</div>
                    <div className="mt-1 truncate font-mono text-sm" title={key?.name}>
                      {key?.name}
                    </div>
                  </div>
                </div>
                <div className="border-border bg-background text-muted-foreground rounded-md border px-3 py-2 text-xs">
                  {hasSelectionChanges ? (
                    <>
                      {addedZones.length} add{addedZones.length === 1 ? "" : "s"},{" "}
                      {removedZones.length} remove{removedZones.length === 1 ? "" : "s"} pending.
                    </>
                  ) : (
                    "Selection matches the configured domains."
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs">
                    Sets <code>master_tsig_key_ids</code> on the primary and{" "}
                    <code>slave_tsig_key_ids</code> on the secondaries that host each zone.
                  </p>
                  <ZoneMultiSelect
                    zones={zones}
                    selected={selectedZones}
                    configured={configuredZones}
                    onChange={setSelectedZones}
                  />
                </div>
                <button
                  aria-busy={activating}
                  type="button"
                  onClick={applyZones}
                  disabled={activating || !hasSelectionChanges}
                  className={buttonClass({
                    variant: hasSelectionChanges ? "primary" : "secondary",
                  })}
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  {`Apply changes (${changeCount})`}
                </button>
              </div>
            ) : null}
          </div>

          {/* Footer navigation */}
          <div className="mt-6 flex items-center justify-end gap-3">
            {step === "generate" ? (
              <>
                <FooterGhost onClick={onClose}>Cancel</FooterGhost>
                <FooterPrimary onClick={() => void generate()} disabled={creating}>
                  Generate & continue
                </FooterPrimary>
              </>
            ) : null}

            {step === "install" ? (
              <>
                <FooterGhost onClick={onClose}>Done</FooterGhost>
                {zones.length > 0 ? (
                  <FooterPrimary onClick={() => setStep("zones")}>
                    Next: secure zones →
                  </FooterPrimary>
                ) : null}
              </>
            ) : null}

            {step === "zones" ? (
              <>
                {existing?.startStep === "zones" ? null : (
                  <FooterGhost onClick={() => setStep("install")}>← Back</FooterGhost>
                )}
                <FooterPrimary onClick={onClose}>Done</FooterPrimary>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function ZoneMultiSelect({
  zones,
  selected,
  configured,
  onChange,
}: {
  zones: string[];
  selected: Set<string>;
  configured: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filteredZones = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return zones;
    return zones.filter((zone) => zone.toLowerCase().includes(q));
  }, [query, zones]);

  const selectedPreview = useMemo(() => [...selected].sort(), [selected]);
  const allSelected = zones.length > 0 && selected.size === zones.length;

  function toggleZone(zone: string) {
    const next = new Set(selected);
    if (next.has(zone)) next.delete(zone);
    else next.add(zone);
    onChange(next);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="border-input bg-card text-body focus-visible:border-ring focus-visible:shadow-focus-ring flex min-h-12 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left focus-visible:outline-hidden"
      >
        <span className="min-w-0">
          <span className="block font-medium">
            {selected.size === 0
              ? "Choose domains"
              : `${selected.size} domain${selected.size === 1 ? "" : "s"} selected`}
          </span>
          <span className="text-muted-foreground block text-xs">{zones.length} available</span>
        </span>
        <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
      </button>

      {selectedPreview.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedPreview.slice(0, 8).map((zone) => (
            <span
              key={zone}
              title={zone}
              className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 max-w-full items-center truncate rounded-sm px-1.5 font-mono whitespace-nowrap sm:max-w-64"
            >
              {zone}
            </span>
          ))}
          {selectedPreview.length > 8 ? (
            <span className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap">
              +{selectedPreview.length - 8}
            </span>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="border-border bg-card absolute z-[210] mt-2 w-full rounded-md border">
          <div className="border-border border-b p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter domains"
                className={`min-w-0 flex-1 font-mono ${inputClass}`}
              />
              <button
                type="button"
                onClick={() => onChange(allSelected ? new Set() : new Set(zones))}
                className={buttonClass({ size: "sm" })}
              >
                {allSelected ? "Clear all" : `Select all (${zones.length})`}
              </button>
              {selected.size > 0 && !allSelected ? (
                <button
                  type="button"
                  onClick={() => onChange(new Set())}
                  className={buttonClass({ size: "sm" })}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
          <div role="listbox" className="max-h-80 overflow-auto p-2">
            {filteredZones.length === 0 ? (
              <p className="text-muted-foreground px-2 py-6 text-center text-sm">
                No domains match.
              </p>
            ) : (
              filteredZones.map((zone) => (
                <Checkbox
                  key={zone}
                  checked={selected.has(zone)}
                  onChange={() => toggleZone(zone)}
                  className="hover:bg-background flex w-full min-w-0 items-start rounded px-2 py-2"
                  label={
                    <span className="flex min-w-0 flex-1 items-start gap-2">
                      <span
                        className="min-w-0 flex-1 font-mono text-xs leading-5 break-all"
                        title={zone}
                      >
                        {zone}
                      </span>
                      {configured.has(zone) ? (
                        <span className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 font-mono whitespace-nowrap">
                          configured
                        </span>
                      ) : null}
                    </span>
                  }
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FooterPrimary({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={buttonClass({ variant: "primary" })}
    >
      {children}
    </button>
  );
}

function FooterGhost({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={buttonClass()}>
      {children}
    </button>
  );
}
