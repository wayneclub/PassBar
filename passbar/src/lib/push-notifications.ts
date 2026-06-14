"use client";

import { supabase } from './supabase';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

/** Whether the current browser/OS supports Web Push (Service Worker + Push API + Notification). */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    VAPID_PUBLIC_KEY.length > 0
  );
}

/** iOS Safari only supports push for PWAs installed via "Add to Home Screen". */
export function isIosStandaloneRequired(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return isIos && !isStandalone;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  await navigator.serviceWorker.register(`${basePath}/sw.js`, { scope: `${basePath}/` });
  return navigator.serviceWorker.ready;
}

/** Requests notification permission and subscribes the current device to push, saving it for `userId`. */
export async function enablePushNotifications(userId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isPushSupported()) return { ok: false, error: 'unsupported' };
  if (!supabase) return { ok: false, error: 'no-supabase' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, error: 'permission-denied' };

  const registration = await getRegistration();
  if (!registration) return { ok: false, error: 'no-service-worker' };

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
  }

  const subJson = subscription.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: subJson.endpoint!,
      p256dh: subJson.keys?.p256dh ?? '',
      auth: subJson.keys?.auth ?? '',
      user_agent: navigator.userAgent,
    },
    { onConflict: 'endpoint' },
  );

  if (error) {
    console.warn('[PassBar] Failed to save push subscription:', JSON.stringify(error, null, 2));
    return { ok: false, error: 'save-failed' };
  }

  return { ok: true };
}

/** Unsubscribes the current device from push and removes its subscription record. */
export async function disablePushNotifications(): Promise<void> {
  if (!('serviceWorker' in navigator) || !supabase) return;

  const registration = await navigator.serviceWorker.getRegistration(`${basePath}/`);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}
