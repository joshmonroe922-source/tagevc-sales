/** Portal-only dismiss cache for chats Graph cannot hide (mainly meeting threads). */

const PREFIX = 'ms_chat_dismissed:';

type DismissedMap = Record<string, number>;

/** Meeting chat threads use ids like `19:meeting_…@thread.v2`. */
export function isMeetingChatId(chatId: string): boolean {
  return /:meeting_/i.test(chatId);
}

export function loadDismissedChats(userId: string): Map<string, number> {
  try {
    const raw = localStorage.getItem(PREFIX + userId);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as DismissedMap;
    const map = new Map<string, number>();
    for (const [id, at] of Object.entries(parsed)) {
      if (typeof at === 'number' && Number.isFinite(at)) map.set(id, at);
    }
    return map;
  } catch {
    return new Map();
  }
}

export function saveDismissedChats(userId: string, map: Map<string, number>): void {
  const obj: DismissedMap = {};
  for (const [id, at] of map) obj[id] = at;
  localStorage.setItem(PREFIX + userId, JSON.stringify(obj));
}

export function persistDismissedChat(
  userId: string,
  map: Map<string, number>,
  chatId: string,
  at = Date.now(),
): void {
  map.set(chatId, at);
  saveDismissedChats(userId, map);
}

export function clearDismissedChat(
  userId: string,
  map: Map<string, number>,
  chatId: string,
): void {
  if (!map.has(chatId)) return;
  map.delete(chatId);
  saveDismissedChats(userId, map);
}
