/**
 * useNotifications
 * Manages browser Notification permission and provides a `notify` helper.
 * Also fires a one-time request if the user hasn't been asked yet.
 */

import { useState, useCallback, useEffect } from 'react';

export type NotifPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export interface UseNotificationsResult {
  permission: NotifPermission;
  request: () => Promise<NotifPermission>;
  notify: (title: string, options?: NotificationOptions) => void;
  supported: boolean;
}

export function useNotifications(): UseNotificationsResult {
  const supported = 'Notification' in window;

  const [permission, setPermission] = useState<NotifPermission>(() => {
    if (!supported) return 'unsupported';
    return Notification.permission as NotifPermission;
  });

  // Keep in sync if another tab changes permission
  useEffect(() => {
    if (!supported) return;
    const interval = setInterval(() => {
      const current = Notification.permission as NotifPermission;
      setPermission(prev => prev !== current ? current : prev);
    }, 5000);
    return () => clearInterval(interval);
  }, [supported]);

  const request = useCallback(async (): Promise<NotifPermission> => {
    if (!supported) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    const result = await Notification.requestPermission();
    setPermission(result as NotifPermission);
    return result as NotifPermission;
  }, [supported]);

  const notify = useCallback((title: string, options?: NotificationOptions) => {
    if (!supported || Notification.permission !== 'granted') return;

    // Use SW if available for richer notifications
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(title, {
          icon: '/icon-192.svg',
          badge: '/icon-192.svg',
          ...options,
        });
      }).catch(() => {
        // Fallback to direct notification
        new Notification(title, options);
      });
    } else {
      new Notification(title, options);
    }
  }, [supported]);

  return { permission, request, notify, supported };
}
