"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";
import { inputClass as baseInputClass, textareaClass } from "@/components/ui/field";

export function CreateTeamForm() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [contact, setContact] = useState("");
  const [mail, setMail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});

    const body: {
      slug: string;
      name: string;
      description?: string;
      contact?: string;
      mail?: string;
    } = { slug, name };
    if (description !== "") body.description = description;
    if (contact !== "") body.contact = contact;
    if (mail !== "") body.mail = mail;

    try {
      const res = await apiFetch("/api/admin/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
          details?: { fieldErrors?: Record<string, string[]> };
        } | null;
        setError(data?.error ?? "Could not create team.");
        if (data?.details?.fieldErrors) setFieldErrors(data.details.fieldErrors);
        return;
      }
      const data = (await res.json()) as { team: { id: string } };
      router.push(`/admin/teams/${data.team.id}`);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field id="name" label="Display name" required errors={fieldErrors["name"]}>
        <input
          id="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field
        id="slug"
        label="Slug"
        required
        hint="URL-safe; lowercase letters, digits, dashes."
        errors={fieldErrors["slug"]}
      >
        <input
          id="slug"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          className={inputClass}
        />
      </Field>
      <Field id="description" label="Description (optional)" errors={fieldErrors["description"]}>
        <textarea
          id="description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`mt-1.5 ${textareaClass}`}
        />
      </Field>
      <Field id="contact" label="Contact (optional)" errors={fieldErrors["contact"]}>
        <input
          id="contact"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field id="mail" label="Mail (optional)" errors={fieldErrors["mail"]}>
        <input
          id="mail"
          type="email"
          value={mail}
          onChange={(e) => setMail(e.target.value)}
          className={inputClass}
        />
      </Field>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          aria-busy={loading}
          type="submit"
          disabled={loading}
          className={buttonClass({ variant: "primary" })}
        >
          Add team
        </button>
        <button type="button" onClick={() => router.push("/admin/teams")} className={buttonClass()}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const inputClass = `mt-1.5 ${baseInputClass}`;

function Field({
  id,
  label,
  required,
  hint,
  errors,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
      {errors && errors.length > 0 ? (
        <p className="text-destructive mt-1 text-xs" role="alert">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}
