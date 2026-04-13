/**
 * useNavigation Hook - Pages Router Only
 * ⚠️ This is a Pages Router hook and should NOT be imported by App Router components
 * If imported in app router files, it will cause the page to crash
 * 
 * For App Router components, use next/navigation directly:
 * - import { useRouter } from 'next/navigation'
 * - import { usePathname } from 'next/navigation'
 * - import { useSearchParams } from 'next/navigation'
 */

'use client';

import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

export interface NavigationOptions {
  replace?: boolean
  scroll?: boolean
  shallow?: boolean
}

export interface NavigationHook {
  navigate: (path: string, options?: NavigationOptions) => Promise<boolean>
  back: () => void
  forward: () => void
  refresh: () => void
  push: (path: string, as?: string, options?: NavigationOptions) => Promise<boolean>
  replace: (path: string, as?: string, options?: NavigationOptions) => Promise<boolean>
  pathname: string
  query: Record<string, string | string[] | undefined>
  asPath: string
  isReady: boolean
}

export function useNavigation(): NavigationHook {
  const router = useRouter()

  const navigate = useCallback(
    async (path: string, _options: NavigationOptions = {}): Promise<boolean> => {
      router.push(path)
      return true
    },
    [router]
  )

  const back = useCallback(() => {
    router.back()
  }, [router])

  const forward = useCallback(() => {
    window.history.forward()
  }, [router])

  const refresh = useCallback(() => {
    router.refresh?.()
  }, [router])

  const push = useCallback(
    async (path: string, _as?: string, _options: NavigationOptions = {}): Promise<boolean> => {
      router.push(path)
      return true
    },
    [router]
  )

  const replace = useCallback(
    async (path: string, _as?: string, _options: NavigationOptions = {}): Promise<boolean> => {
      router.push(path)
      return true
    },
    [router]
  )

  return {
    navigate,
    back,
    forward,
    refresh,
    push,
    replace,
    pathname: '',
    query: {},
    asPath: '',
    isReady: true,
  }
}