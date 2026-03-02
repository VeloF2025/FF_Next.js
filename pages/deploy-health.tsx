'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'

interface ServiceHealth {
  name: string
  port: number
  url: string
  status: 'up' | 'down' | 'degraded'
  code: number | null
  latencyMs: number | null
  checkedAt: string
}

interface SystemdService {
  service: string
  active: string
  sub: string
}

interface DeployHealthData {
  services: ServiceHealth[]
  systemd: SystemdService[]
  logs: string[]
  github: { configured: false; message: string } | { configured: true; runs: unknown[] }
  generatedAt: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function DeployHealthPage() {
  const { data, isLoading, mutate } = useSWR<DeployHealthData>('/api/system/deploy-health', fetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: false,
  })
  const [lastUpdated, setLastUpdated] = useState<string>('')

  useEffect(() => {
    if (data?.generatedAt) {
      setLastUpdated(new Date(data.generatedAt).toLocaleTimeString())
    }
  }, [data])

  const getStatusColor = (status: string) => {
    if (status === 'up') return 'bg-green-50 border-green-200'
    if (status === 'degraded') return 'bg-yellow-50 border-yellow-200'
    return 'bg-red-50 border-red-200'
  }

  const getStatusBadgeColor = (status: string) => {
    if (status === 'up') return 'bg-green-100 text-green-700'
    if (status === 'degraded') return 'bg-yellow-100 text-yellow-700'
    return 'bg-red-100 text-red-700'
  }

  const getSystemdColor = (active: string) => {
    if (active === 'active') return 'bg-green-50 border-green-200'
    if (active === 'inactive') return 'bg-yellow-50 border-yellow-200'
    return 'bg-red-50 border-red-200'
  }

  const getSystemdBadgeColor = (active: string) => {
    if (active === 'active') return 'bg-green-100 text-green-700'
    if (active === 'inactive') return 'bg-yellow-100 text-yellow-700'
    return 'bg-red-100 text-red-700'
  }

  return (
    <div className="min-h-screen bg-slate-900 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Deployment Health</h1>
            <p className="text-slate-400 text-sm mt-1">
              Last updated: {lastUpdated || 'loading...'}
            </p>
          </div>
          <button
            onClick={() => mutate()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            disabled={isLoading}
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {isLoading && !data ? (
          <div className="text-center py-12">
            <p className="text-slate-400">Loading health data...</p>
          </div>
        ) : !data ? (
          <div className="text-center py-12">
            <p className="text-red-400">Failed to load health data</p>
          </div>
        ) : (
          <>
            {/* Services */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-white mb-4">Service Health</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.services.map((svc) => (
                  <div key={svc.port} className={`rounded-lg border p-4 ${getStatusColor(svc.status)}`}>
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-medium text-sm text-slate-900">{svc.name}</h3>
                      <span className={`text-xs px-2 py-1 rounded-full ${getStatusBadgeColor(svc.status)}`}>
                        {svc.status.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-2xl font-bold text-slate-900">{svc.code || '—'}</p>
                    <p className="text-xs text-slate-600 mt-1">
                      {svc.latencyMs !== null ? `${svc.latencyMs}ms` : 'No response'}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Systemd Services */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-white mb-4">System Services</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.systemd.map((svc) => (
                  <div key={svc.service} className={`rounded-lg border p-4 ${getSystemdColor(svc.active)}`}>
                    <div className="flex justify-between items-start">
                      <h3 className="font-medium text-sm text-slate-900">{svc.service}</h3>
                      <span className={`text-xs px-2 py-1 rounded-full ${getSystemdBadgeColor(svc.active)}`}>
                        {svc.active.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-2">{svc.sub}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* GitHub & Logs */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* GitHub Actions */}
              <div>
                <h2 className="text-xl font-semibold text-white mb-4">GitHub Actions</h2>
                <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
                  {data.github.configured ? (
                    <div className="text-sm text-slate-300">
                      <p className="font-medium text-green-400 mb-2">Configured</p>
                      <p className="text-xs text-slate-400">(CI status details not implemented in MVP)</p>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">{data.github.message}</p>
                  )}
                </div>
              </div>

              {/* Recent Logs */}
              <div>
                <h2 className="text-xl font-semibold text-white mb-4">Recent Logs</h2>
                <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 max-h-48 overflow-y-auto">
                  <div className="space-y-1">
                    {data.logs.map((log, i) => (
                      <p key={i} className="text-xs text-slate-400 font-mono">
                        {log}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
