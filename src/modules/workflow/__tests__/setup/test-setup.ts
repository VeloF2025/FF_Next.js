// Test setup and configuration for workflow system tests
import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';
import 'jest-axe/extend-expect';

// Configure React Testing Library
configure({
  testIdAttribute: 'data-testid',
  asyncUtilTimeout: 5000,
  computedStyleSupportsPseudoElements: true
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
};

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
};

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock window.scrollTo
Object.defineProperty(window, 'scrollTo', {
  value: jest.fn(),
  writable: true
});

// Mock Canvas API for visual components
HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
  fillRect: jest.fn(),
  clearRect: jest.fn(),
  getImageData: jest.fn(() => ({ data: new Array(4) })),
  putImageData: jest.fn(),
  createImageData: jest.fn(() => []),
  setTransform: jest.fn(),
  drawImage: jest.fn(),
  save: jest.fn(),
  fillText: jest.fn(),
  restore: jest.fn(),
  beginPath: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  closePath: jest.fn(),
  stroke: jest.fn(),
  translate: jest.fn(),
  scale: jest.fn(),
  rotate: jest.fn(),
  arc: jest.fn(),
  fill: jest.fn(),
  measureText: jest.fn(() => ({ width: 0 })),
  transform: jest.fn(),
  rect: jest.fn(),
  clip: jest.fn(),
}));

// Mock DOMRect for getBoundingClientRect
global.DOMRect = class DOMRect {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0
  ) {
    this.left = x;
    this.top = y;
    this.right = x + width;
    this.bottom = y + height;
  }
  
  left: number;
  top: number;
  right: number;
  bottom: number;
  
  static fromRect(other?: DOMRectInit): DOMRect {
    return new DOMRect(other?.x, other?.y, other?.width, other?.height);
  }
  
  toJSON() {
    return JSON.stringify(this);
  }
};

// Mock Element.getBoundingClientRect
Element.prototype.getBoundingClientRect = jest.fn(() => ({
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  left: 0,
  top: 0,
  right: 100,
  bottom: 100,
  toJSON: jest.fn()
}));

// Mock Element.scrollIntoView
Element.prototype.scrollIntoView = jest.fn();

// Mock drag and drop APIs
const mockDataTransfer = {
  clearData: jest.fn(),
  getData: jest.fn(),
  setData: jest.fn(),
  setDragImage: jest.fn(),
  items: [],
  types: [],
  files: [],
  effectAllowed: 'all',
  dropEffect: 'none'
};

global.DataTransfer = jest.fn(() => mockDataTransfer) as any;

// Mock File and FileList
global.File = class MockFile {
  constructor(
    public bits: BlobPart[],
    public name: string,
    public options?: FilePropertyBag
  ) {
    this.lastModified = options?.lastModified || Date.now();
    this.type = options?.type || '';
    this.size = 0;
  }
  
  lastModified: number;
  type: string;
  size: number;
  
  slice() {
    return new Blob();
  }
  
  stream() {
    return new ReadableStream();
  }
  
  text() {
    return Promise.resolve('');
  }
  
  arrayBuffer() {
    return Promise.resolve(new ArrayBuffer(0));
  }
};

global.FileList = class MockFileList extends Array<File> {
  item(index: number) {
    return this[index] || null;
  }
};

// Mock clipboard API
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: jest.fn().mockResolvedValue(undefined),
    readText: jest.fn().mockResolvedValue(''),
    write: jest.fn().mockResolvedValue(undefined),
    read: jest.fn().mockResolvedValue([])
  },
  configurable: true
});

// Mock performance API
global.performance = {
  ...global.performance,
  mark: jest.fn(),
  measure: jest.fn(),
  getEntriesByName: jest.fn(() => []),
  getEntriesByType: jest.fn(() => []),
  clearMarks: jest.fn(),
  clearMeasures: jest.fn(),
  now: jest.fn(() => Date.now())
};

// Mock URL.createObjectURL
global.URL.createObjectURL = jest.fn(() => 'mocked-object-url');
global.URL.revokeObjectURL = jest.fn();

// Mock requestAnimationFrame
global.requestAnimationFrame = jest.fn(cb => setTimeout(cb, 16));
global.cancelAnimationFrame = jest.fn(id => clearTimeout(id));

// Mock localStorage and sessionStorage
const createStorageMock = () => {
  const store: Record<string, string> = {};
  
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      Object.keys(store).forEach(key => delete store[key]);
    }),
    key: jest.fn((index: number) => Object.keys(store)[index] || null),
    get length() {
      return Object.keys(store).length;
    }
  };
};

Object.defineProperty(window, 'localStorage', {
  value: createStorageMock()
});

Object.defineProperty(window, 'sessionStorage', {
  value: createStorageMock()
});

// Mock console methods for cleaner test output
const originalConsole = { ...console };

// Restore console for debugging when needed
global.restoreConsole = () => {
  Object.assign(console, originalConsole);
};

// Mock console methods to reduce noise in tests
/* eslint-disable no-console */
console.warn = jest.fn();
console.error = jest.fn();
console.info = jest.fn();
console.debug = jest.fn();
/* eslint-enable no-console */

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.VITE_API_BASE_URL = 'http://localhost:3001';

// Global test utilities
global.createMockPointerEvent = (type: string, options: PointerEventInit = {}) => {
  return new PointerEvent(type, {
    pointerId: 1,
    bubbles: true,
    cancelable: true,
    ...options
  });
};

global.createMockDragEvent = (type: string, options: DragEventInit = {}) => {
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    dataTransfer: mockDataTransfer,
    ...options
  });
  return event;
};

// Mock timers
global.waitForNextTick = () => new Promise(resolve => setTimeout(resolve, 0));

// Setup for async testing
global.flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

// Mock mutation observer
global.MutationObserver = class MutationObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
};

// Error boundary for tests
global.mockErrorBoundary = {
  componentDidCatch: jest.fn(),
  render: jest.fn(() => null)
};

// Cleanup function for tests
global.cleanup = () => {
  // Clear all mocks
  jest.clearAllMocks();
  
  // Clear localStorage and sessionStorage
  window.localStorage.clear();
  window.sessionStorage.clear();
  
  // Reset console
  /* eslint-disable no-console */
  console.warn = jest.fn();
  console.error = jest.fn();
  console.info = jest.fn();
  console.debug = jest.fn();
  /* eslint-enable no-console */
  
  // Clear performance marks
  performance.clearMarks();
  performance.clearMeasures();
};

// Global test timeout
jest.setTimeout(10000);

// Suppress specific warnings in tests
/* eslint-disable no-console */
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: ReactDOM.render is deprecated')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
/* eslint-enable no-console */

export {};