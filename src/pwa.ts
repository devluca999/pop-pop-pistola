// Installable app: service worker (offline play), the install prompt, and fullscreen on phones.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners: (() => void)[] = [];

export function initPwa(): void {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* offline play just won't work */ });
    });
  }
  // Chrome / Edge / Android: keep the install prompt for our own INSTALL button
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); });
}

/** Running as an installed app (home screen icon). */
export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** 'prompt' = we can show the browser's install dialog; 'ios' = show Add to Home Screen steps. */
export function installState(): 'prompt' | 'ios' | 'none' {
  if (isStandalone()) return 'none';
  if (deferred) return 'prompt';
  if (isIos()) return 'ios';
  return 'none';
}

export function onInstallChange(f: () => void): () => void {
  listeners.push(f);
  return () => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); };
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const d = deferred;
  deferred = null;
  await d.prompt();
  const { outcome } = await d.userChoice;
  listeners.forEach((f) => f());
  return outcome === 'accepted';
}

/**
 * In a phone browser tab (not installed), go fullscreen on the first tap so the address bar
 * doesn't eat the screen. iPhone Safari has no fullscreen API; installing is the way there.
 */
export function goFullscreen(): void {
  if (isStandalone() || document.fullscreenElement) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    else el.webkitRequestFullscreen?.();
  } catch { /* not allowed here */ }
}
