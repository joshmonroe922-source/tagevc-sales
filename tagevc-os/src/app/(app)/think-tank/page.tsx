import { redirect } from 'next/navigation';

/** Think Tank now lives on Home under the AI briefing. */
export default function ThinkTankRedirectPage() {
  redirect('/home');
}
