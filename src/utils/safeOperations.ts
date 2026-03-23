/**
 * Safe operations utility functions to prevent runtime errors
 */

/**
 * Safely capitalize first letter of a string
 */
export function safeCapitalize(str: unknown): string {
  if (!str || typeof str !== 'string') return ''
  if (str.length === 0) return ''
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

/**
 * Safely get first character and capitalize
 */
export function safeFirstChar(str: unknown, fallback: string = ''): string {
  if (!str || typeof str !== 'string' || str.length === 0) return fallback
  return str.charAt(0).toUpperCase()
}

/**
 * Safely format status/enum strings
 */
export function safeFormatEnum(value: unknown, fallback: string = 'Unknown'): string {
  if (!value || typeof value !== 'string') return fallback
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase().replace(/_/g, ' ')
}

/**
 * Safely get property from object
 */
export function safeGet<T>(obj: Record<string, unknown> | null | undefined, path: string, fallback: T): T {
  if (!obj || typeof obj !== 'object') return fallback
  
  const keys = path.split('.')
  let result: unknown = obj
  
  for (const key of keys) {
    if (result && typeof result === 'object' && result !== null && key in result) {
      result = (result as Record<string, unknown>)[key]
    } else {
      return fallback
    }
  }
  
  return result as T
}

/**
 * Safely get array element
 */
export function safeArrayAccess<T>(arr: unknown, index: number, fallback: T): T {
  if (!Array.isArray(arr) || index < 0 || index >= arr.length) {
    return fallback
  }
  return arr[index] ?? fallback
}

/**
 * Safely parse JSON
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    if (!json || typeof json !== 'string') return fallback
    return JSON.parse(json)
  } catch {
    return fallback
  }
}

/**
 * Safely stringify JSON
 */
export function safeJsonStringify(obj: unknown, fallback: string = '{}'): string {
  try {
    return JSON.stringify(obj)
  } catch {
    return fallback
  }
}

/**
 * Safely convert to number
 */
export function safeNumber(value: unknown, fallback: number = 0): number {
  const num = Number(value)
  return isNaN(num) ? fallback : num
}

/**
 * Safely convert to boolean
 */
export function safeBoolean(value: unknown, fallback: boolean = false): boolean {
  if (value === true || value === false) return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

/**
 * Safely get length of array/string
 */
export function safeLength(value: unknown, fallback: number = 0): number {
  if (!value) return fallback
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length
  }
  if (typeof value === 'object') {
    return Object.keys(value).length
  }
  return fallback
}

/**
 * Safely slice string or array
 */
export function safeSlice<T extends string | unknown[]>(
  value: T | null | undefined,
  start: number,
  end?: number
): T {
  if (!value) return (typeof value === 'string' ? '' : []) as T
  
  try {
    return value.slice(start, end) as T
  } catch {
    return (typeof value === 'string' ? '' : []) as T
  }
}

/**
 * Safely split string
 */
export function safeSplit(str: unknown, separator: string | RegExp, limit?: number): string[] {
  if (!str || typeof str !== 'string') return []
  try {
    return str.split(separator, limit)
  } catch {
    return []
  }
}

/**
 * Safely trim string
 */
export function safeTrim(str: unknown, fallback: string = ''): string {
  if (!str || typeof str !== 'string') return fallback
  return str.trim()
}

/**
 * Safely get user initials
 */
export function safeGetInitials(name: unknown, fallback: string = '?'): string {
  if (!name || typeof name !== 'string') return fallback
  
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return fallback
  
  const first = parts[0]?.charAt(0) ?? ''
  if (parts.length === 1) {
    return first.toUpperCase() || fallback
  }
  
  const last = parts[parts.length - 1]?.charAt(0) ?? ''
  return (first + last).toUpperCase() || fallback
}

/**
 * Safely format currency
 */
export function safeFormatCurrency(amount: unknown, fallback: string = '$0.00'): string {
  const num = safeNumber(amount, 0)
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(num)
  } catch {
    return fallback
  }
}

/**
 * Safely format percentage
 */
export function safeFormatPercent(value: unknown, decimals: number = 0, fallback: string = '0%'): string {
  const num = safeNumber(value, 0)
  try {
    return `${num.toFixed(decimals)}%`
  } catch {
    return fallback
  }
}