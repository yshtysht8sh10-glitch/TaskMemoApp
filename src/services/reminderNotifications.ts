import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { ReminderPlan } from '@/domain/reminders';

const CHANNEL_ID = 'task-deadlines';

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });

export async function requestReminderPermission() {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: '期限リマインダー', importance: Notifications.AndroidImportance.DEFAULT });
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  return (await Notifications.requestPermissionsAsync()).status === 'granted';
}

export async function replaceScheduledReminders(plans: ReminderPlan[]) {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(existing.filter((item) => item.content.data?.kind === 'task-deadline').map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier).catch(() => undefined)));
  for (const plan of plans) {
    await Notifications.scheduleNotificationAsync({ content: { title: plan.title, body: plan.body, data: { kind: 'task-deadline', view: 'deadline', memoId: plan.memoId } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: plan.triggerAt, ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}) } });
  }
}

export function addReminderResponseListener(onOpenDeadline: () => void) {
  Notifications.getLastNotificationResponseAsync().then((response) => { if (response?.notification.request.content.data?.view === 'deadline') onOpenDeadline(); }).catch(() => {});
  return Notifications.addNotificationResponseReceivedListener((response) => { if (response.notification.request.content.data?.view === 'deadline') onOpenDeadline(); });
}
