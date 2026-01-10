/**
 * Test Page for Real-time WebSocket Functionality
 */

import React, { useState, useEffect } from 'react';
import { socketIOAdapter } from '@/services/realtime/socketIOAdapter';
import type { RealtimeEvent } from '@/services/realtime/websocketService';

export default function TestRealtimePage() {
  const [isConnected, setIsConnected] = useState(false);
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [subscriptions, setSubscriptions] = useState<string[]>([]);
  const [testData, setTestData] = useState({
    projectName: 'Test Project',
    clientName: 'Test Client',
    staffName: 'Test Staff Member'
  });

  useEffect(() => {
    // Connect to WebSocket
    socketIOAdapter.connect().then(() => {
      setIsConnected(true);
    }).catch(error => {
      console.error('Failed to connect:', error);
    });

    // Listen for connection events
    socketIOAdapter.on('connected', () => {
      setIsConnected(true);
      console.log('WebSocket connected');
    });

    socketIOAdapter.on('disconnected', () => {
      setIsConnected(false);
      console.log('WebSocket disconnected');
    });

    socketIOAdapter.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    return () => {
      socketIOAdapter.disconnect();
    };
  }, []);

  const subscribeToProjects = () => {
    const unsubscribe = socketIOAdapter.subscribeToAll('project', (event) => {
      console.log('Project event received:', event);
      setEvents(prev => [event, ...prev].slice(0, 20));
    });
    setSubscriptions(prev => [...prev, 'projects']);
    return unsubscribe;
  };

  const subscribeToClients = () => {
    const unsubscribe = socketIOAdapter.subscribeToAll('client', (event) => {
      console.log('Client event received:', event);
      setEvents(prev => [event, ...prev].slice(0, 20));
    });
    setSubscriptions(prev => [...prev, 'clients']);
    return unsubscribe;
  };

  const subscribeToStaff = () => {
    const unsubscribe = socketIOAdapter.subscribeToAll('staff', (event) => {
      console.log('Staff event received:', event);
      setEvents(prev => [event, ...prev].slice(0, 20));
    });
    setSubscriptions(prev => [...prev, 'staff']);
    return unsubscribe;
  };

  const testProjectCreate = async () => {
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: testData.projectName,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      });
      
      if (response.ok) {
        const project = await response.json();
        console.log('Project created:', project);
        
        // Broadcast the change
        socketIOAdapter.broadcastChange({
          eventType: 'added',
          entityType: 'project',
          entityId: project.id,
          data: project
        });
      }
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const testClientCreate = async () => {
    try {
      const response = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: testData.clientName,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
      });
      
      if (response.ok) {
        const client = await response.json();
        console.log('Client created:', client);
        
        // Broadcast the change
        socketIOAdapter.broadcastChange({
          eventType: 'added',
          entityType: 'client',
          entityId: client.id,
          data: client
        });
      }
    } catch (error) {
      console.error('Failed to create client:', error);
    }
  };

  const clearEvents = () => {
    setEvents([]);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-[var(--ff-text-primary)]">Real-time WebSocket Test</h1>

      {/* Connection Status */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 mb-6 border border-[var(--ff-border-light)]">
        <h2 className="text-xl font-semibold mb-4 text-[var(--ff-text-primary)]">Connection Status</h2>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-[var(--ff-text-primary)]">{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
        {!isConnected && (
          <button
            onClick={() => socketIOAdapter.connect()}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Connect
          </button>
        )}
      </div>

      {/* Subscriptions */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 mb-6 border border-[var(--ff-border-light)]">
        <h2 className="text-xl font-semibold mb-4 text-[var(--ff-text-primary)]">Subscriptions</h2>
        <div className="flex gap-4 mb-4">
          <button
            onClick={subscribeToProjects}
            disabled={!isConnected || subscriptions.includes('projects')}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            Subscribe to Projects
          </button>
          <button
            onClick={subscribeToClients}
            disabled={!isConnected || subscriptions.includes('clients')}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            Subscribe to Clients
          </button>
          <button
            onClick={subscribeToStaff}
            disabled={!isConnected || subscriptions.includes('staff')}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            Subscribe to Staff
          </button>
        </div>
        <div className="text-sm text-[var(--ff-text-secondary)]">
          Active subscriptions: {subscriptions.join(', ') || 'None'}
        </div>
      </div>

      {/* Test Actions */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 mb-6 border border-[var(--ff-border-light)]">
        <h2 className="text-xl font-semibold mb-4 text-[var(--ff-text-primary)]">Test Actions</h2>
        <div className="space-y-4">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1 text-[var(--ff-text-primary)]">Project Name</label>
              <input
                type="text"
                value={testData.projectName}
                onChange={(e) => setTestData(prev => ({ ...prev, projectName: e.target.value }))}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
              />
            </div>
            <button
              onClick={testProjectCreate}
              disabled={!isConnected}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
            >
              Create Test Project
            </button>
          </div>

          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1 text-[var(--ff-text-primary)]">Client Name</label>
              <input
                type="text"
                value={testData.clientName}
                onChange={(e) => setTestData(prev => ({ ...prev, clientName: e.target.value }))}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)]"
              />
            </div>
            <button
              onClick={testClientCreate}
              disabled={!isConnected}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
            >
              Create Test Client
            </button>
          </div>
        </div>
      </div>

      {/* Events Log */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow p-6 border border-[var(--ff-border-light)]">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">Events Log</h2>
          <button
            onClick={clearEvents}
            className="px-3 py-1 text-sm bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] rounded hover:bg-[var(--ff-bg-hover)]"
          >
            Clear
          </button>
        </div>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {events.length === 0 ? (
            <p className="text-[var(--ff-text-secondary)]">No events received yet</p>
          ) : (
            events.map((event, index) => (
              <div key={index} className="p-3 bg-[var(--ff-bg-tertiary)] rounded text-sm border border-[var(--ff-border-light)]">
                <div className="flex justify-between mb-1">
                  <span className="font-medium text-[var(--ff-text-primary)]">
                    {event.entityType} - {event.type}
                  </span>
                  <span className="text-[var(--ff-text-secondary)]">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-[var(--ff-text-secondary)]">
                  ID: {event.entityId}
                </div>
                {event.data && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-blue-600">View Data</summary>
                    <pre className="mt-2 p-2 bg-[var(--ff-bg-secondary)] rounded text-xs overflow-x-auto text-[var(--ff-text-primary)]">
                      {JSON.stringify(event.data, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}