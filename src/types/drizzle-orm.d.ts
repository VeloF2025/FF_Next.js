/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * Third-party type stubs for packages not installed.
 * Prevents TS2307 "Cannot find module" errors in legacy/dead-code files.
 */

// --- Firebase stubs (legacy pole-tracker / project services, not actively used) ---
declare module 'firebase/firestore' {
  export type DocumentData = Record<string, any>;
  export interface Timestamp {
    toDate(): Date;
    seconds: number;
    nanoseconds: number;
  }
  export interface QueryDocumentSnapshot<T = DocumentData> {
    id: string;
    ref: DocumentReference<T>;
    data(): T;
    exists(): boolean;
  }
  export interface DocumentSnapshot<T = DocumentData> extends QueryDocumentSnapshot<T> {}
  export interface Query<T = DocumentData> { }
  export interface CollectionReference<T = DocumentData> extends Query<T> {}
  export interface DocumentReference<T = DocumentData> { id: string; }
  export function collection(db: any, path: string): CollectionReference;
  export function doc(db: any, path: string, ...pathSegments: string[]): DocumentReference;
  export function query(ref: any, ...constraints: any[]): Query;
  export function where(field: string, op: string, value: any): any;
  export function orderBy(field: string, direction?: string): any;
  export function limit(n: number): any;
  export function getDocs(q: Query): Promise<{ docs: QueryDocumentSnapshot[]; empty: boolean; size: number; forEach: (cb: (doc: QueryDocumentSnapshot) => void) => void }>;
  export function getDoc(ref: DocumentReference): Promise<DocumentSnapshot>;
  export function addDoc(ref: CollectionReference, data: DocumentData): Promise<DocumentReference>;
  export function setDoc(ref: DocumentReference, data: DocumentData, options?: any): Promise<void>;
  export function updateDoc(ref: DocumentReference, data: Partial<DocumentData>): Promise<void>;
  export function deleteDoc(ref: DocumentReference): Promise<void>;
  export function writeBatch(db: any): { set: any; update: any; delete: any; commit: () => Promise<void> };
  export const Timestamp: {
    fromDate(date: Date): Timestamp;
    now(): Timestamp;
  };
  export function serverTimestamp(): any;
  export type Unsubscribe = () => void;
  export function onSnapshot<T = DocumentData>(
    reference: Query<T> | DocumentReference<T>,
    observer: {
      next?: (snapshot: any) => void;
      error?: (error: any) => void;
      complete?: () => void;
    }
  ): Unsubscribe;
  export function onSnapshot<T = DocumentData>(
    reference: Query<T> | DocumentReference<T>,
    onNext: (snapshot: any) => void,
    onError?: (error: any) => void,
    onCompletion?: () => void
  ): Unsubscribe;
}

declare module 'firebase/app' {
  export interface FirebaseApp { name: string; }
  export function initializeApp(config: Record<string, string>, name?: string): FirebaseApp;
  export function getApps(): FirebaseApp[];
  export function getApp(name?: string): FirebaseApp;
}

// --- @tabler/icons-react stub (single usage in StatusBadge) ---
declare module '@tabler/icons-react' {
  import type * as React from 'react';
  export interface TablerIconProps extends React.SVGAttributes<SVGElement> {
    size?: number | string;
    stroke?: number | string;
  }
  const _default: any;
  export default _default;
  export const IconCheck: React.FC<TablerIconProps>;
  // Named icon exports are accessed as members of the module
  export const IconAlertCircle: React.FC<TablerIconProps>;
  export const IconX: React.FC<TablerIconProps>;
  export const IconPlus: React.FC<TablerIconProps>;
  export const IconCircleCheckFilled: React.FC<TablerIconProps>;
  export const IconCircleXFilled: React.FC<TablerIconProps>;
  export const IconClock: React.FC<TablerIconProps>;
}

// --- @radix-ui/react-progress stub (used in src/components/ui/progress.tsx) ---
declare module '@radix-ui/react-progress' {
  import type * as React from 'react';
  const Root: React.ForwardRefExoticComponent<
    React.HTMLAttributes<HTMLDivElement> & { value?: number | null; max?: number } & React.RefAttributes<HTMLDivElement>
  >;
  const Indicator: React.ForwardRefExoticComponent<
    React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>
  >;
  export { Root, Indicator };
}

// --- Drizzle ORM type stubs (not installed) ---

declare module 'nodemailer' {
  export interface Transport {
    sendMail(options: {
      from?: string;
      to?: string;
      subject?: string;
      html?: string;
      text?: string;
    }): Promise<{ messageId: string }>;
  }
  export function createTransport(options: {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user?: string; pass?: string };
  }): Transport;
}

declare module 'drizzle-orm/neon-http' {
  export function drizzle(client: any, options?: any): any;
}

declare module 'drizzle-orm/pg-core' {
  export function pgTable(name: string, columns: Record<string, any>): any;
  export function text(name: string): any;
  export function timestamp(name: string): any;
  export function integer(name: string): any;
  export function boolean(name: string): any;
  export function uuid(name: string): any;
  export function jsonb(name: string): any;
  export function decimal(name: string): any;
}
