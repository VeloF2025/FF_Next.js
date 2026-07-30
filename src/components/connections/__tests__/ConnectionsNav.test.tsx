/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';
import type { NextRouter } from 'next/router';
import { describe, expect, it } from 'vitest';

import { ConnectionsNav } from '../ConnectionsNav';

function routerAt(pathname: string): NextRouter {
  return {
    basePath: '',
    route: pathname,
    pathname,
    query: {},
    asPath: pathname,
    isLocaleDomain: false,
    isFallback: false,
    isReady: true,
    isPreview: false,
    push: async () => true,
    replace: async () => true,
    reload: () => undefined,
    back: () => undefined,
    forward: () => undefined,
    prefetch: async () => undefined,
    beforePopState: () => undefined,
    events: {
      on: () => undefined,
      off: () => undefined,
      emit: () => undefined,
    },
  };
}

function renderWithRouter(ui: React.ReactElement, pathname: string) {
  return render(
    <RouterContext.Provider value={routerAt(pathname)}>
      {ui}
    </RouterContext.Provider>,
  );
}

describe('ConnectionsNav', () => {
  it('renders horizontal FibreFlow and Cortex tabs', () => {
    renderWithRouter(<ConnectionsNav />, '/connections/fibreflow');

    expect(screen.getByRole('link', { name: 'FibreFlow' }))
      .toHaveAttribute('href', '/connections/fibreflow');
    expect(screen.getByRole('link', { name: 'Cortex' }))
      .toHaveAttribute('href', '/connections/cortex');
  });
});
