import { redirect } from 'next/navigation';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { getProfile } from '@/lib/rbac/session';

export default async function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (!profile) redirect('/login');

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar
        role={profile.role}
        fullName={profile.full_name}
        email={profile.email}
      />
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">{children}</div>
      </main>
    </div>
  );
}
