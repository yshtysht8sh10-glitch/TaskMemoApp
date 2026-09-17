import type { ReminderPlan } from '@/domain/reminders';

const MAX_TIMEOUT = 2_147_000_000;
let timers: ReturnType<typeof setTimeout>[] = [];

export async function requestReminderPermission() {
  if (typeof window === 'undefined' || !window.isSecureContext || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

async function showReminder(plan: ReminderPlan) {
  const options = { body: plan.body, icon: '/icons/pwa-192.png', tag: `taskmemo-${plan.key}`, data: { view: 'deadline', memoId: plan.memoId } };
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.ready; await registration.showNotification(plan.title, options); return;
  }
  const notification = new Notification(plan.title, options); notification.onclick = () => { window.focus(); };
}

function queue(plan: ReminderPlan) {
  const delay = plan.triggerAt.getTime() - Date.now();
  if (delay <= 0) return;
  timers.push(setTimeout(() => { if (delay > MAX_TIMEOUT) queue(plan); else showReminder(plan).catch(() => {}); }, Math.min(delay, MAX_TIMEOUT)));
}

export async function replaceScheduledReminders(plans: ReminderPlan[]) { timers.forEach(clearTimeout); timers = []; if (typeof Notification !== 'undefined' && Notification.permission === 'granted') plans.forEach(queue); }

export function addReminderResponseListener(onOpenDeadline: () => void) {
  const listener = (event: MessageEvent) => { if (event.data?.type === 'taskmemo-notification-open' && event.data?.view === 'deadline') onOpenDeadline(); };
  navigator.serviceWorker?.addEventListener('message', listener);
  return { remove() { navigator.serviceWorker?.removeEventListener('message', listener); } };
}
