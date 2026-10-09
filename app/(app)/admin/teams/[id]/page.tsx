/**
 * app/(app)/admin/teams/[id]/page.tsx
 *
 * Team detail: identity + member list + add/remove members.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUserForPage } from "@/lib/auth/require-user";
import { findTeamById, listTeamMembers } from "@/lib/db/repositories/teams";
import { listGrantsForTeam } from "@/lib/db/repositories/zone-grants";
import { listAllPdnsServers } from "@/lib/db/repositories/pdns-servers";
import { recentAdminEditsForTeam } from "@/lib/db/repositories/audit-log";
import { AdminAuditPanel } from "@/components/domain/admin-audit-panel";
import { ZONE_GRANT_PERMISSIONS } from "@/lib/rbac/zone-grant-permissions";
import { TeamMembersPanel } from "../_components/team-members-panel";
import { TeamDangerZone } from "../_components/team-danger-zone";
import { ZoneGrantsPanel } from "../../_components/zone-grants-panel";

export const metadata: Metadata = { title: "Team" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TeamDetailPage({ params }: PageProps) {
  const { id } = await params;
  // Instance-scoped read: a team-scoped Team Owner may view their own team;
  // a global team.read sees any team.
  const teamSubject = { __type: "Team" as const, id };
  const { ability } = await requireUserForPage({ can: "team.read", on: teamSubject });
  const team = await findTeamById(id);
  if (!team) notFound();

  const [members, grants, allServers] = await Promise.all([
    listTeamMembers(id),
    listGrantsForTeam(id),
    listAllPdnsServers(),
  ]);
  const canManageMembers = ability.can("manage-members", teamSubject);
  const canUpdate = ability.can("update", teamSubject);
  const canDelete = ability.can("delete", teamSubject);
  const canReadAudit = ability.can("read", "Audit");
  const recentEdits = canReadAudit ? await recentAdminEditsForTeam(id, 10) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-h1">{team.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          <code className="font-mono">{team.slug}</code>
        </p>
        {team.description ? <p className="mt-3 text-sm">{team.description}</p> : null}
      </header>

      <section className="border-border bg-background rounded-md border p-5">
        <h2 className="text-h3 text-foreground mb-2">Identity</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
          <Row label="Contact" value={team.contact ?? "-"} />
          <Row label="Mail" value={team.mail ?? "-"} />
          <Row label="Created" value={team.createdAt.toLocaleString()} />
        </dl>
      </section>

      <TeamMembersPanel
        teamId={id}
        canManage={canManageMembers}
        members={members.map((m) => ({
          userId: m.userId,
          email: m.email,
          name: m.name,
          teamRole: m.teamRole,
          addedAt: m.addedAt.toISOString(),
        }))}
      />

      <ZoneGrantsPanel
        endpointBase={`/api/admin/teams/${id}/zone-grants`}
        principalKind="team"
        canManage={canUpdate}
        grants={grants.map((g) => {
          const server = allServers.find((s) => s.id === g.serverId);
          return {
            id: g.id,
            serverId: g.serverId,
            serverName: server?.name ?? "(unknown server)",
            zoneName: g.zoneName,
            permissions: g.permissions,
          };
        })}
        servers={allServers.map((s) => ({ id: s.id, name: s.name }))}
        permissionVocab={ZONE_GRANT_PERMISSIONS}
      />

      {canReadAudit ? (
        <AdminAuditPanel
          entries={recentEdits}
          fullHistoryHref={`/admin/audit?resourceType=team&resourceId=${encodeURIComponent(id)}`}
        />
      ) : null}

      {canDelete ? <TeamDangerZone teamId={id} teamName={team.name} /> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
