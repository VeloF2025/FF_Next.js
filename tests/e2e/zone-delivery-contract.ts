import type { Page, Route } from '@playwright/test';
import type {
  ZoneDeliveryActivity,
  ZoneDeliveryView,
  ZoneRegisterResult,
} from '../../src/modules/construction-qa/zone-delivery/types/zoneDelivery.types';
import {
  activeZone,
  activity,
  PROJECT_ID,
  registerResult,
} from './zone-delivery-fixtures';

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

const registerFilterKeys = new Set([
  'project_id',
  'zone_no',
  'status',
  'blocker',
  'handover',
  'search',
]);

const hasSingleNonEmptyValues = (url: URL, allowedKeys: Set<string>) => {
  const keys = [...url.searchParams.keys()];
  return keys.every(key => allowedKeys.has(key))
    && keys.every(key => {
      const values = url.searchParams.getAll(key);
      return values.length === 1 && values[0] !== '';
    });
};

const hasExactZoneKey = (url: URL) => {
  const allowedKeys = new Set(['project_id', 'zone_no']);
  return hasSingleNonEmptyValues(url, allowedKeys)
    && [...url.searchParams.keys()].length === allowedKeys.size
    && url.searchParams.get('project_id') === PROJECT_ID
    && url.searchParams.get('zone_no') === '12';
};

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
    const requestLabel = `${request.method()} ${url.pathname}${url.search}`;
    const rejectUnexpected = () => {
      unexpectedApiRequests.push(requestLabel);
      return json(route, {
        success: false,
        error: { message: `Unexpected contract request: ${requestLabel}` },
      }, 418);
    };
    if (url.pathname === '/api/auth/me') {
      return json(route, {
        success: true,
        data: {
          user: {
            id: '66666666-6666-4666-8666-666666666666',
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
      if (request.method() !== 'GET'
        || !hasSingleNonEmptyValues(url, registerFilterKeys)) {
        return rejectUnexpected();
      }
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
      if (request.method() !== 'GET' || !hasExactZoneKey(url)) {
        return rejectUnexpected();
      }
      return json(route, { success: true, data: state.zone });
    }
    if (url.pathname === '/api/zone-delivery/activity') {
      if (request.method() !== 'GET' || !hasExactZoneKey(url)) {
        return rejectUnexpected();
      }
      return json(route, { success: true, data: state.activity });
    }
    return rejectUnexpected();
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
