import Link from "next/link";

export type TemplateTabKey = "records" | "settings" | "metadata";

interface Props {
  active: TemplateTabKey;
  templateId: string;
}

export function ZoneTemplateTabs({ active, templateId }: Props) {
  const base = `/admin/zone-templates/${templateId}`;
  return (
    <div className="border-border border-b">
      <nav aria-label="Template sections" className="-mb-px flex gap-6 text-sm">
        <TabLink href={base} active={active === "records"}>
          Records
        </TabLink>
        <TabLink href={`${base}?tab=settings`} active={active === "settings"}>
          Zone settings
        </TabLink>
        <TabLink href={`${base}?tab=metadata`} active={active === "metadata"}>
          Metadata
        </TabLink>
      </nav>
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "border-primary text-foreground border-b-2 px-1 pb-3 font-medium"
          : "text-muted-foreground hover:text-foreground border-b-2 border-transparent px-1 pb-3"
      }
    >
      {children}
    </Link>
  );
}
