import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

describe('app shell scroll lock (shared shell)', () => {
  it('locks html/body overflow and height while the shell is mounted', () => {
    const twin = read('src/lib/platform/shell/app-shell-scroll-lock.tsx');
    expect(twin).toMatch(/html\.style\.overflow = 'hidden'/);
    expect(twin).toMatch(/body\.style\.overflow = 'hidden'/);
    expect(twin).toMatch(/html\.style\.height = '100%'/);
    expect(twin).toMatch(/body\.style\.height = '100%'/);
  });

  it('viewport-locks the app shell and pins the desktop sidebar', () => {
    const layout = read('src/app/(app)/layout.tsx');
    expect(layout).toMatch(/AppShellScrollLock/);
    expect(layout).toMatch(/h-dvh max-h-dvh/);
    expect(layout).toMatch(/<AppSidebar/);
    expect(layout).toMatch(
      /flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden/,
    );
  });

  it('keeps ReloadScrollRestore wired to the main pane scroller', () => {
    const root = read('src/app/layout.tsx');
    expect(root).toMatch(/ReloadScrollRestore/);
    const main = read('src/components/layout/app-main.tsx');
    expect(main).toMatch(/data-scroll-restoration-root/);
    expect(main).toMatch(/overflow-y-auto/);
    expect(main).toMatch(/overscroll-contain/);
  });

  it('confines Think Tank auto-scroll to the messages panel after send', () => {
    const desk = read('src/lib/platform/think-tank/think-tank-desk.tsx');
    expect(desk).not.toMatch(/scrollIntoView/);
    expect(desk).toMatch(/followMessagesRef/);
    expect(desk).toMatch(/messagesPanelRef/);
    expect(desk).toMatch(/panel\.scrollTop = panel\.scrollHeight/);
  });
});
