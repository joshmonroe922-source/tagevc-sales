import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function StubPage({
  title,
  description,
  footnote = 'This surface is scaffolded for a later phase. Navigation and architecture docs land first; business logic follows.',
}: {
  title: string;
  description: string;
  footnote?: string;
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
          <CardDescription>{footnote}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
