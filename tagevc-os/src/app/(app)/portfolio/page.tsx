import { redirect } from 'next/navigation';

/** Personal dashboard lives at /dashboard. */
export default function PortfolioRedirectPage() {
  redirect('/dashboard');
}
