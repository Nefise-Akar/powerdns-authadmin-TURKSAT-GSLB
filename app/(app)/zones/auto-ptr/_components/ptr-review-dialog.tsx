"use client";

/**
 * app/(app)/zones/auto-ptr/_components/ptr-review-dialog.tsx
 *
 * "Review changes" for a Reverse DNS rectify run: per reverse zone, the
 * BIND-style diff of the PTR RRsets that will be written or removed, in the
 * record editor's red/green `BareDiff`. Built from the report rows already on
 * screen (see `components/domain/ptr-review.ts`), so opening it costs no
 * request; Apply hands the same items to the page's existing rectify call.
 *
 * A `ScrollDialog` rather than `Dialog`: a group can hold hundreds of
 * addresses, and the Apply button must stay reachable while the diff scrolls.
 */

import { useMemo } from "react";
import { BareDiff, computeBindDiff } from "@/app/(app)/zones/[zoneId]/_components/bare-diff";
import { buildPtrReview, type PtrReviewInput } from "@/components/domain/ptr-review";
import { ScrollDialog } from "@/components/ui/scroll-dialog";
import { buttonClass } from "@/components/ui/button";

export interface PtrReview {
  inputs: PtrReviewInput[];
  /** One or two sentences: what the run does, plus anything skipped. */
  summary: string;
  applyLabel: string;
  danger: boolean;
}

function addresses(n: number): string {
  return n === 1 ? "1 address" : `${n} addresses`;
}

export function PtrReviewDialog({
  review,
  busy,
  onClose,
  onApply,
}: {
  review: PtrReview | null;
  busy: boolean;
  onClose: () => void;
  onApply: () => void;
}) {
  const zones = useMemo(() => (review ? buildPtrReview(review.inputs) : []), [review]);
  return (
    <ScrollDialog
      open={review !== null}
      onClose={() => (busy ? undefined : onClose())}
      title="Review changes"
      description={
        review ? (
          <>
            {addresses(review.inputs.length)} in{" "}
            {zones.length === 1 ? "1 reverse zone" : `${zones.length} reverse zones`}.{" "}
            {review.summary}
          </>
        ) : null
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            // As in `confirm()`: a removal starts on Cancel so Enter backs out.
            data-dialog-focus={review?.danger ? "true" : undefined}
            onClick={onClose}
            disabled={busy}
            className={buttonClass()}
          >
            Cancel
          </button>
          <button
            type="button"
            data-dialog-focus={review?.danger ? undefined : "true"}
            onClick={onApply}
            disabled={busy}
            className={
              review?.danger
                ? buttonClass({ variant: "destructive" })
                : buttonClass({ variant: "primary" })
            }
          >
            {busy ? "Applying…" : (review?.applyLabel ?? "Apply")}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {zones.map((zone) => {
          const { removed, added } = computeBindDiff(zone.before, zone.after);
          return (
            <section key={zone.reverseZone} aria-label={`Changes in ${zone.reverseZone}`}>
              <h3 className="mb-1.5 text-xs font-semibold">
                <span className="font-mono">{zone.reverseZone}</span>{" "}
                <span className="text-muted-foreground font-normal">
                  {addresses(zone.addresses)}
                </span>
              </h3>
              <div className="border-border overflow-hidden rounded-md border">
                <BareDiff removed={removed} added={added} />
              </div>
            </section>
          );
        })}
      </div>
    </ScrollDialog>
  );
}
