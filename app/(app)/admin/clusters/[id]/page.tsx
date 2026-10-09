import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserForPage } from "@/lib/auth/require-user";
import { findClusterById, listAllServersForCluster } from "@/lib/db/repositories/pdns-clusters";
import { classifyGroup } from "@/lib/pdns/capabilities";
import { ClusterForm } from "../_components/cluster-form";
import { DeleteClusterButton } from "./_components/delete-cluster-button";

export const metadata: Metadata = { title: "Group" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClusterDetailPage({ params }: PageProps) {
  const { ability } = await requireUserForPage({ can: "server.read" });
  const { id } = await params;
  const cluster = await findClusterById(id);
  if (!cluster) notFound();

  const canEdit = ability.can("update", "Server");
  const canDelete = ability.can("delete", "Server");

  const members = await listAllServersForCluster(id);
  const composition = classifyGroup(members);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/admin/clusters"
          className="text-primary hover:text-primary-hover text-sm hover:underline"
        >
          ← Back to groups
        </Link>
      </div>

      <header>
        <h1 className="text-h1">{cluster.name}</h1>
        <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-sm">
          <code className="font-mono">{cluster.slug}</code>
          <span className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap">
            {composition.typeLabel}
          </span>
          {composition.isMultiPrimary ? (
            <span className="bg-tag text-mono-xs text-tag-foreground inline-flex h-5 items-center rounded-sm px-1.5 font-mono whitespace-nowrap">
              {cluster.writeStrategy.replace("_", " ")}
            </span>
          ) : null}
        </p>
      </header>

      {canEdit ? (
        <section>
          <h2 className="text-h3 text-foreground mb-2">Settings</h2>
          <ClusterForm
            mode="edit"
            showStrategy={composition.isMultiPrimary}
            clusterId={cluster.id}
            initialSlug={cluster.slug}
            initialName={cluster.name}
            initialDescription={cluster.description ?? ""}
            initialWriteStrategy={cluster.writeStrategy}
          />
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-h3 text-foreground">Members ({members.length})</h2>
        {members.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No PDNS servers reference this cluster yet. Edit a server&rsquo;s row at{" "}
            <Link
              href="/admin/servers"
              className="text-primary hover:text-primary-hover hover:underline"
            >
              /admin/servers
            </Link>{" "}
            to assign it.
          </p>
        ) : (
          <ul className="divide-border border-border bg-background divide-y rounded-md border">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <Link
                  href={`/admin/servers/${m.id}`}
                  className="hover:text-primary hover:text-primary-hover text-sm font-medium hover:underline"
                >
                  {m.name}
                </Link>
                <span className="text-muted-foreground font-mono text-xs">{m.slug}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canDelete ? (
        <section className="border-border border-t pt-6">
          <h2 className="text-h3 text-foreground">Danger zone</h2>
          <div className="border-destructive bg-destructive-muted mt-3 flex items-start justify-between gap-4 rounded-md border p-4">
            <p className="text-muted-foreground flex-1 text-sm">
              Delete this group. Members are detached from the group and revert to standalone
              semantics; the server rows themselves stay.
            </p>
            <DeleteClusterButton
              clusterId={cluster.id}
              clusterName={cluster.name}
              memberCount={members.length}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
