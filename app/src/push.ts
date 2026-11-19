/**
 * The browser side of push notifications: the service worker, the permission prompt, and the
 * subscription the server sends to. See server/notifications.ts for what is sent and when.
 */
import { post } from './api';

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('service worker:', err));
}

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Opened from the home-screen icon rather than in a browser tab. */
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

/** iOS delivers Web Push only to a site added to the home screen, and only from there can it ask. */
export const needsHomeScreen = () => isIOS() && !isStandalone();

function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Asks for permission (it must be called from a tap — Safari refuses otherwise), subscribes this
 * device, and tells the server. A subscription made with another key — the server's key was
 * replaced — is dropped and made again.
 */
export async function enablePush(publicKey: string): Promise<void> {
  if (!pushSupported()) throw new Error('הדפדפן הזה לא תומך בהתראות');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'ההתראות חסומות. יש לאפשר אותן בהגדרות המכשיר/הדפדפן עבור האפליקציה'
      : 'לא ניתן אישור להתראות');
  }
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const applicationServerKey = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const existing = sub.options.applicationServerKey;
    const same = existing && new Uint8Array(existing).every((b, i) => b === applicationServerKey[i]);
    if (!same) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey as BufferSource });
    } catch (err) {
      // Private windows and some browsers refuse here even after permission was granted.
      throw new Error(`הדפדפן סירב לרשום את המכשיר להתראות (${(err as Error).message}). בחלון פרטי זה לא נתמך.`);
    }
  }
  await post('/notifications/subscribe', { subscription: sub.toJSON() });
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await post('/notifications/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

/** The number on the home-screen icon, where the platform has one. */
export function setAppBadge(count: number) {
  const nav = navigator as any;
  if (!nav.setAppBadge) return;
  (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.())?.catch?.(() => {});
}
