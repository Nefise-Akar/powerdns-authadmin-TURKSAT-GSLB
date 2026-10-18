"use client";

/**
 * app/(app)/admin/gslb/_components/gslb-backend-form.tsx
 *
 * Shared create / edit form for a PowerGSLB backend connection. POSTs / PATCHes
 * the admin API and shows per-field errors the server returns.
 *
 * The password is write-only: required on create, "Rotate password" on edit
 * where blank keeps the stored value. `autoComplete="new-password"` stops the
 * browser from filling in the operator's own saved login for this site.
 */

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useGslbFetch } from "../_lib/use-gslb-fetch";
import { buttonClass } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { slugify } from "@/lib/validators/common";
import { Field, inputClass, textareaClass } from "@/components/ui/field";

export interface GslbBackendFormInitial {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  baseUrl: string;
  username: string;
  nameserverHost: string | null;
  nameserverAddresses: string[] | null;
  enabled: boolean;
}

type GslbBackendFormProps = { mode: "create" } | { mode: "edit"; initial: GslbBackendFormInitial };

interface ErrorBody {
  error?: string;
  details?: { fieldErrors?: Record<string, string[]> };
}

const LIST_HREF = "/admin/gslb";

/** Fields this form renders an inline error for. */
const SHOWN_FIELDS: readonly string[] = [
  "name",
  "slug",
  "description",
  "baseUrl",
  "username",
  "password",
  "nameserverHost",
  "nameserverAddresses",
];

export function GslbBackendForm(props: GslbBackendFormProps) {
  const router = useRouter();
  const gslbFetch = useGslbFetch();
  const initial = props.mode === "edit" ? props.initial : null;

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [nameserverHost, setNameserverHost] = useState(initial?.nameserverHost ?? "");
  const [nameserverAddresses, setNameserverAddresses] = useState(
    (initial?.nameserverAddresses ?? []).join("\n"),
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);

    const addresses = nameserverAddresses
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    // Nullable fields are always sent so clearing them in edit mode sticks;
    // the password is only sent when typed, so blank keeps the stored one.
    const body: Record<string, unknown> = {
      name,
      description: description.trim() === "" ? null : description,
      baseUrl,
      username,
      nameserverHost: nameserverHost.trim() === "" ? null : nameserverHost,
      nameserverAddresses: addresses.length > 0 ? addresses : null,
      enabled,
    };
    if (props.mode === "create") body["slug"] = slug;
    if (password !== "") body["password"] = password;

    const url =
      props.mode === "edit"
        ? `/api/admin/gslb-backends/${props.initial.id}`
        : "/api/admin/gslb-backends";

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
      setPassword("");
      router.push(LIST_HREF);
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
      <Field label="Display name" error={fieldError("name")}>
        <input
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            // Follow the name until the operator types a slug of their own.
            if (props.mode === "create" && !slugEdited) setSlug(slugify(e.target.value));
          }}
          placeholder="PowerGSLB site A"
          className={inputClass}
        />
      </Field>

      {props.mode === "create" ? (
        <Field
          label="Slug"
          error={fieldError("slug")}
          hint="Used in log lines and audit entries. Lowercase letters, digits and dashes. Can't be changed later."
        >
          <input
            required
            value={slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value.toLowerCase());
            }}
            placeholder="gslb-site-a"
            className={inputClass}
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
        label="Base URL"
        error={fieldError("baseUrl")}
        hint="The PowerGSLB admin server root, without a path - /admin/w2ui is appended automatically."
      >
        <input
          required
          type="url"
          inputMode="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://powergslb.example.com"
          className={`${inputClass} font-mono`}
        />
      </Field>

      <Field
        label="Username"
        error={fieldError("username")}
        hint="A PowerGSLB account used only by this panel. Operators never sign in to PowerGSLB."
      >
        <input
          required
          autoComplete="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field
        label={props.mode === "edit" ? "Rotate password" : "Password"}
        error={fieldError("password")}
        hint={
          props.mode === "edit"
            ? "Leave blank to keep the current password. Encrypted at rest and never shown again."
            : "Encrypted at rest and never shown again."
        }
      >
        <input
          type="password"
          autoComplete="new-password"
          required={props.mode === "create"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={props.mode === "edit" ? "•••••••• (unchanged)" : ""}
          className={inputClass}
        />
      </Field>

      <Field
        label="Nameserver host (optional)"
        error={fieldError("nameserverHost")}
        hint="FQDN of the GSLB nameserver that zones delegate their gslb subzone to, e.g. ns1.gslb.example.com."
      >
        <input
          value={nameserverHost}
          onChange={(e) => setNameserverHost(e.target.value)}
          placeholder="ns1.gslb.example.com"
          className={`${inputClass} font-mono`}
        />
      </Field>

      <Field
        label="Nameserver addresses (optional)"
        error={fieldError("nameserverAddresses")}
        hint="Glue IPs for the nameserver host, one per line. IPv4 or IPv6."
      >
        <textarea
          rows={3}
          value={nameserverAddresses}
          onChange={(e) => setNameserverAddresses(e.target.value)}
          placeholder={"192.0.2.53\n2001:db8::53"}
          className={`${textareaClass} resize-y font-mono`}
        />
      </Field>

      <Checkbox
        checked={enabled}
        onChange={setEnabled}
        label="Enabled - a disabled backend is kept for audit history but not used"
      />

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
          {saving ? "Saving…" : props.mode === "edit" ? "Save changes" : "Add GSLB backend"}
        </button>
        <button type="button" onClick={() => router.push(LIST_HREF)} className={buttonClass()}>
          Cancel
        </button>
      </div>
    </form>
  );
}
