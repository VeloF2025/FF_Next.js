import type { Page, Route } from '@playwright/test';
import type {
  ZoneDeliveryActivity,
  ZoneDeliveryView,
  ZoneRegisterResult,
} from '../../src/modules/construction-qa/zone-delivery/types/zoneDelivery.types';
import { activeZone, activity, registerResult } from './zone-delivery-fixtures';

interface ContractState {
  register: ZoneRegisterResult;
  zone: ZoneDeliveryView;
  activity: ZoneDeliveryActivity[];
}

export interface ZoneDeliveryContract {
  registerRequests: URL[];
  unexpectedApiRequests: string[];
  setRegister: (result: ZoneRegisterResult) => void;
  setZone: (zone: ZoneDeliveryView, nextActivity?: ZoneDeliveryActivity[]) => void;
  setRegisterFailure: (message: string | null) => void;
  pauseNextRegister: () => void;
  releaseRegister: () => void;
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

export async function installZoneDeliveryContract(page: Page): Promise<ZoneDeliveryContract> {
  const state: ContractState = {
    register: registerResult,
    zone: activeZone,
    activity,
  };
  const registerRequests: URL[] = [];
  const unexpectedApiRequests: string[] = [];
  let registerFailure: string | null = null;
  let registerGate: Promise<void> | null = null;
  let releaseRegister: (() => void) | null = null;

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/auth/me') {
      return json(route, {
        success: true,
        data: {
          user: {
            id: 'contract-super-admin',
            email: 'contract.admin@velocityfibre.co.za',
            name: 'Contract Admin',
            role: 'super_admin',
            permissions: ['all'],
          },
        },
      });
    }
    if (url.pathname === '/api/tracking/page-visit') {
      return route.fulfill({ status: 204, body: '' });
    }
    if (url.pathname === '/api/chat/access') {
      return json(route, { dataAccess: false });
    }
    if (url.pathname === '/api/dashboard/pinned-links') {
      return json(route, { success: true, data: { pins: [] } });
    }
    if (url.pathname === '/api/user-sidebar-preferences') {
      return json(route, {
        success: true,
        data: { main_section_items: ['communications', 'action-items'] },
      });
    }
    if (url.pathname === '/api/version') {
      return json(route, { version: 'contract' });
    }
    if (url.pathname === '/api/notifications/unread-count') {
      return json(route, { success: true, data: 0 });
    }
    if (url.pathname === '/api/notifications') {
      return json(route, { success: true, data: [] });
    }
    if (url.pathname === '/api/zone-delivery/register') {
      registerRequests.push(url);
      if (registerGate) {
        await registerGate;
        registerGate = null;
        releaseRegister = null;
      }
      if (registerFailure) {
        return json(route, { success: false, error: { message: registerFailure } }, 503);
      }
      return json(route, { success: true, data: state.register });
    }
    if (url.pathname === '/api/zone-delivery/zone') {
      return json(route, { success: true, data: state.zone });
    }
    if (url.pathname === '/api/zone-delivery/activity') {
      return json(route, { success: true, data: state.activity });
    }
    unexpectedApiRequests.push(`${request.method()} ${url.pathname}`);
    return json(route, {
      success: false,
      error: { message: `Unexpected contract request: ${url.pathname}` },
    }, 418);
  });

  return {
    registerRequests,
    unexpectedApiRequests,
    setRegister: result => {
      state.register = result;
    },
    setZone: (zone, nextActivity = activity) => {
      state.zone = zone;
      state.activity = nextActivity;
    },
    setRegisterFailure: message => {
      registerFailure = message;
    },
    pauseNextRegister: () => {
      registerGate = new Promise(resolve => {
        releaseRegister = resolve;
      });
    },
    releaseRegister: () => {
      releaseRegister?.();
    },
  };
}
