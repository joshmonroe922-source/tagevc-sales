'use server';

import { revalidatePath } from 'next/cache';
import {
  countMyUnreadNotifications,
  markAllMyNotificationsRead,
  markNotificationRead,
} from '@/lib/data/activity';

export async function markNotificationReadAction(notificationId: string) {
  await markNotificationRead(notificationId);
  revalidatePath('/activity');
  return { ok: true as const };
}

export async function markAllNotificationsReadAction() {
  const result = await markAllMyNotificationsRead();
  revalidatePath('/activity');
  return result;
}

export async function getUnreadNotificationsCountAction() {
  const count = await countMyUnreadNotifications();
  return { ok: true as const, count };
}
