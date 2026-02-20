/**
 * Notification Services - Barrel Export
 * All modules should import from here:
 *   import { notify } from '@/modules/notifications/services';
 *
 * @module notifications/services
 */

export { notify, getUnreadCount, getNotifications, markAsRead, markAllAsRead, getEffectiveChannels } from './notificationBus';
export { deliverEmail } from './emailDelivery';
export { deliverWhatsApp, sendWhatsAppGroup, sendWhatsAppDM } from './whatsappDelivery';
