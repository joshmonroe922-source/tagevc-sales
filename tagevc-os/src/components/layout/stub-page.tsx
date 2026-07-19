import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function StubPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {description}
        </p>
      </header>
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Coming in a later phase</CardTitle>
          <CardDescription>
            Phase 0 ships identity, RBAC, layout, and Command Center. This
            module is scaffolded in navigation only.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
