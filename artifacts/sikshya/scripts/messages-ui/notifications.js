const notifications = [
  { id: 91, read: false, data: { type: "message", conversationWith: 11 } },
  { id: 92, read: false, data: { type: "class_message", batchId: 11 } },
];
const markTargetRead = async (target) => {
  globalThis.lastNotificationReadTarget = target;
};

export function useNotifications() {
  return { lastEvent: null, notifications, markTargetRead };
}
