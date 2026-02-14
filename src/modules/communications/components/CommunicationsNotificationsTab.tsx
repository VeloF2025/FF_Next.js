import { Notification } from '@/types/communications.types';

interface CommunicationsNotificationsTabProps {
  notifications: Notification[];
  getPriorityColor: (priority: string) => string;
}

export function CommunicationsNotificationsTab({ 
  notifications, 
  getPriorityColor 
}: CommunicationsNotificationsTabProps) {
  return (
    <div className="space-y-3">
      {notifications.map(notification => (
        <div key={notification.id} className={`ff-card p-4 ${!notification.read ? 'bg-blue-50' : ''}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-start">
              <div className={`w-2 h-2 rounded-full mt-2 mr-3 ${!notification.read ? 'bg-blue-500' : 'bg-gray-300'}`} />
              <div>
                <h4 className="font-medium">{notification.title}</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{notification.message}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  {notification.timestamp.toLocaleString()}
                </p>
              </div>
            </div>
            <span className={`px-2 py-1 text-xs rounded-full ${getPriorityColor(notification.priority)}`}>
              {notification.priority}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}