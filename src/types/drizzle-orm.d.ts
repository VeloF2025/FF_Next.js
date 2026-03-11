/**
 * Drizzle ORM type stubs
 * The drizzle-orm package is not installed — these stubs prevent TS errors
 * in src/lib/neon/ files that reference drizzle types.
 */

declare module 'drizzle-orm/neon-http' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function drizzle(client: any, options?: any): any;
}

declare module 'drizzle-orm/pg-core' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function pgTable(name: string, columns: Record<string, any>): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function text(name: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function timestamp(name: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function integer(name: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function boolean(name: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function uuid(name: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function jsonb(name: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function decimal(name: string): any;
}
