"use client";

/**
 * app/(app)/admin/users/_components/create-user-form.tsx
 */

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { SelectMenu } from "@/components/ui/select-menu";
import { apiFetch } from "@/lib/client/api-fetch";
import { buttonClass } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";

interface RoleOption {
  id: string;
  name: string;
  slug: string;
}

export function CreateUserForm({ roles = [] }: { roles?: RoleOption[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});

    const body: { email: string; name?: string; password?: string; roleId?: string } = { email };
    if (name !== "") body.name = name;
    if (password !== "") body.password = password;
    if (roleId !== "") body.roleId = roleId;

    try {
      const res = await apiFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
          details?: { fieldErrors?: Record<string, string[]> };
        } | null;
        setError(data?.error ?? "Could not create user.");
        if (data?.details?.fieldErrors) setFieldErrors(data.details.fieldErrors);
        return;
      }
      const data = (await res.json()) as { user: { id: string } };
      router.push(`/admin/users/${data.user.id}`);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field id="email" label="Email" required errors={fieldErrors["email"]}>
        <input
          id="email"
          type="email"
          autoComplete="off"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field id="name" label="Name (optional)" errors={fieldErrors["name"]}>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field
        id="password"
        label="Initial password (leave blank for SSO-only)"
        errors={fieldErrors["password"]}
        hint="If provided, minimum 12 characters. The user will be required to change it on first sign-in."
      >
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </Field>

      {roles.length > 0 ? (
        <Field
          id="roleId"
          label="Initial role (optional)"
          errors={fieldErrors["roleId"]}
          hint="Assigned at global scope. You can change or add scoped assignments after creation."
        >
          <SelectMenu
            value={roleId}
            onChange={(v) => setRoleId(v)}
            options={[
              { value: "", label: "(no role)" },
              ...roles.map((r) => ({ value: r.id, label: `${r.name} (${r.slug})` })),
            ]}
            ariaLabel="Initial role (optional)"
            className="w-full text-sm"
          />
        </Field>
      ) : null}

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
          Add user
        </button>
        <button type="button" onClick={() => router.push("/admin/users")} className={buttonClass()}>
          Cancel
        </button>
      </div>
    </form>
  );
}
