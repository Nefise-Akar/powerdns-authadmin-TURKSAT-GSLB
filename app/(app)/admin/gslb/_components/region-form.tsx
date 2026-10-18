"use client";

/**
 * app/(app)/admin/gslb/_components/region-form.tsx
 *
 * Create / edit form for a GSLB region. Rules are entered one token per line;
 * the server validates and normalizes them (lib/validators/gslb-region-rules.ts)
 * and its per-token messages come back under `rules`.
 */

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useGslbFetch } from "../_lib/use-gslb-fetch";
import { buttonClass } from "@/components/ui/button";
import { slugify } from "@/lib/validators/common";
import { Field, inputClass, textareaClass } from "@/components/ui/field";

export interface RegionFormInitial {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  rules: string[];
}

type RegionFormProps = { backendId: string } & (
  | { mode: "create" }
  | { mode: "edit"; initial: RegionFormInitial }
);

interface ErrorBody {
  error?: string;
  details?: { fieldErrors?: Record<string, string[]> };
}

/** Fields this form renders an inline error for. */
const SHOWN_FIELDS: readonly string[] = ["name", "slug", "description", "rules"];

export function RegionForm(props: RegionFormProps) {
  const router = useRouter();
  const gslbFetch = useGslbFetch();
  const initial = props.mode === "edit" ? props.initial : null;
  const backHref = `/admin/gslb/${props.backendId}`;

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [rules, setRules] = useState((initial?.rules ?? []).join("\n"));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);

    const body: Record<string, unknown> = {
      name,
      description: description.trim() === "" ? null : description,
      rules: rules
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    };
    if (props.mode === "create") body["slug"] = slug;

    const url =
      props.mode === "edit"
        ? `/api/admin/gslb-backends/${props.backendId}/regions/${props.initial.id}`
        : `/api/admin/gslb-backends/${props.backendId}/regions`;

    try {
      const res = await gslbFetch(url, {
        method: props.mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as ErrorBody | null;
        // A field-level message replaces the generic "Invalid input." banner;
        // only errors for fields the form doesn't render stay in the banner.
        const errors = data?.details?.fieldErrors ?? {};
        setFieldErrors(errors);
        const unshown = Object.entries(errors)
          .filter(([key]) => !SHOWN_FIELDS.includes(key))
          .flatMap(([, messages]) => messages);
        setError(
          Object.keys(errors).length > 0
            ? unshown.length > 0
              ? unshown.join(" ")
              : null
            : (data?.error ?? "Save failed."),
        );
        return;
      }
      router.push(backHref);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const fieldError = (key: string) => fieldErrors[key]?.join(" ");

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="Name" error={fieldError("name")}>
        <input
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            // Follow the name until the operator types a slug of their own.
            if (props.mode === "create" && !slugEdited) setSlug(slugify(e.target.value));
          }}
          className={inputClass}
        />
      </Field>

      {props.mode === "create" ? (
        <Field
          label="Slug"
          error={fieldError("slug")}
          hint="Names the PowerGSLB view (authadmin:<slug>). Lowercase letters, digits and dashes. Can't be changed later."
        >
          <input
            required
            value={slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value.toLowerCase());
            }}
            className={`${inputClass} font-mono`}
          />
        </Field>
      ) : null}

      <Field
        label="Description (optional)"
        error={fieldError("description")}
        hint="Free-text note for operators. Up to 500 characters."
      >
        <textarea
          rows={2}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${textareaClass} resize-y`}
        />
      </Field>

      <Field
        label="Rules"
        error={fieldError("rules")}
        hint={
          <>
            One per line. A client belongs to this region when it matches any rule:{" "}
            <code className="font-mono">10.20.0.0/16</code> or{" "}
            <code className="font-mono">2001:db8:20::/48</code> (IP range),{" "}
            <code className="font-mono">country:DE</code> (ISO country code),{" "}
            <code className="font-mono">continent:EU</code> (AF, AN, AS, EU, NA, OC, SA). Match-all
            ranges such as <code className="font-mono">0.0.0.0/0</code> are not allowed.
          </>
        }
      >
        <textarea
          required
          rows={5}
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          spellCheck={false}
          className={`${textareaClass} resize-y font-mono`}
        />
      </Field>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={saving}
          aria-busy={saving}
          className={buttonClass({ variant: "primary" })}
        >
          {saving ? "Saving…" : props.mode === "edit" ? "Save changes" : "Add region"}
        </button>
        <button type="button" onClick={() => router.push(backHref)} className={buttonClass()}>
          Cancel
        </button>
      </div>
    </form>
  );
}
