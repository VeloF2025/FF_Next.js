/**
 * RFQ Subscriptions - Legacy Compatibility Layer
// @ts-ignore
 * @deprecated Use modular components from './subscription' instead
 * This file maintains backward compatibility for existing imports
// @ts-ignore
 * New code should import from './subscription' directly
 */

// Re-export everything from the modular structure
export { 
  RFQSubscriptionManager as RFQSubscriptions,
  RFQFilterEngine,
  RFQSubscriberCrud
// @ts-ignore
} from './subscription';

export type { 
  SubscriptionFilter, 
  SubscriptionOptions, 
  SubscriptionCallback 
// @ts-ignore
} from './subscription';