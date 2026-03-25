/**
 * WebSocket API Route
 * Handles WebSocket connections for real-time updates
 */

import { NextApiRequest } from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { Server as NetServer } from 'http';
import { Socket } from 'net';
import { neon } from '@neondatabase/serverless';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

interface ExtendedSocket extends Socket {
  server: NetServer & {
    io?: SocketIOServer;
  };
}

interface ExtendedNextApiResponse {
  socket: ExtendedSocket;
}

// Neon client for queries
const sql = neon(process.env.DATABASE_URL || '');

// Keep track of active subscriptions
const subscriptions = new Map<string, Set<string>>();

async function handler(
  req: NextApiRequest,
  res: ExtendedNextApiResponse
) {
  if (req.method !== 'GET') {
    res.socket.server.io = undefined;
    return;
  }

  if (!res.socket.server.io) {
    log.debug('websocket', { action: 'initialize', message: 'Initializing Socket.IO server' });

    const io = new SocketIOServer(res.socket.server as any, {
      path: '/api/ws',
      cors: {
        origin: process.env.NODE_ENV === 'production'
          ? process.env.NEXT_PUBLIC_APP_URL
          : ['http://localhost:3005', 'http://localhost:3006', 'http://localhost:3007'],
        methods: ['GET', 'POST']
      }
    });

    res.socket.server.io = io;

    // Set up PostgreSQL LISTEN client
    const listenClient = await pool.connect();
    
    // Listen to database changes
    await listenClient.query('LISTEN project_changes');
    await listenClient.query('LISTEN client_changes');
    await listenClient.query('LISTEN staff_changes');
    await listenClient.query('LISTEN procurement_changes');
    await listenClient.query('LISTEN sow_changes');

    // Handle PostgreSQL notifications
    listenClient.on('notification', (msg) => {
      if (msg.payload) {
        try {
          const payload = JSON.parse(msg.payload);
          const event = {
            type: 'event',
            eventType: payload.operation,
            entityType: payload.table_name.replace('_changes', ''),
            entityId: payload.id,
            data: payload.data,
            timestamp: new Date().toISOString()
          };

          // Broadcast to all connected clients
          io.emit('db_change', event);

          // Emit to specific rooms
          const entityRoom = `${event.entityType}:*`;
          const specificRoom = `${event.entityType}:${event.entityId}`;
          
          io.to(entityRoom).emit('entity_change', event);
          io.to(specificRoom).emit('entity_change', event);
        } catch (error) {
          log.error('websocket', { action: 'parse_notification', error });
        }
      }
    });

    // Handle Socket.IO connections
    io.on('connection', (socket) => {
      log.debug('websocket', { action: 'client_connected', socketId: socket.id });

      // Handle subscriptions
      socket.on('subscribe', async (data) => {
        const { entityType, entityId } = data;
        const room = `${entityType}:${entityId}`;
        
        socket.join(room);
        
        if (!subscriptions.has(room)) {
          subscriptions.set(room, new Set());
        }
        subscriptions.get(room)!.add(socket.id);

        // Send current state if subscribing to specific entity
        if (entityId !== '*') {
          try {
            let result;
            if (entityType === 'client') {
              /* TODO: specify columns — result sent to WS subscribers, fields depend on client needs */
              result = await sql`SELECT * FROM clients WHERE id = ${entityId}`;
            } else if (entityType === 'staff') {
              /* TODO: specify columns — result sent to WS subscribers, fields depend on client needs */
              result = await sql`SELECT * FROM staff WHERE id = ${entityId}`;
            } else {
              /* TODO: specify columns — result sent to WS subscribers, fields depend on client needs */
              result = await sql`SELECT * FROM projects WHERE id = ${entityId}`;
            }
            
            if (result.length > 0) {
              socket.emit('initial_data', {
                entityType,
                entityId,
                data: result[0]
              });
            }
          } catch (error) {
            log.error('websocket', { action: 'fetch_initial_data', entityType, entityId, error });
          }
        }
      });

      // Handle unsubscriptions
      socket.on('unsubscribe', (data) => {
        const { entityType, entityId } = data;
        const room = `${entityType}:${entityId}`;
        
        socket.leave(room);
        
        const roomSubs = subscriptions.get(room);
        if (roomSubs) {
          roomSubs.delete(socket.id);
          if (roomSubs.size === 0) {
            subscriptions.delete(room);
          }
        }
      });

      // Handle ping/pong for heartbeat
      socket.on('ping', () => {
        socket.emit('pong');
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        log.debug('websocket', { action: 'client_disconnected', socketId: socket.id });

        // Clean up subscriptions
        subscriptions.forEach((subs, room) => {
          subs.delete(socket.id);
          if (subs.size === 0) {
            subscriptions.delete(room);
          }
        });
      });

      // Handle custom events (for manual triggers)
      socket.on('broadcast_change', async (data) => {
        // Verify permission (you might want to add authentication here)
        const event = {
          type: 'event',
          eventType: data.eventType,
          entityType: data.entityType,
          entityId: data.entityId,
          data: data.data,
          timestamp: new Date().toISOString()
        };

        // Broadcast to relevant rooms
        const entityRoom = `${event.entityType}:*`;
        const specificRoom = `${event.entityType}:${event.entityId}`;
        
        io.to(entityRoom).emit('entity_change', event);
        io.to(specificRoom).emit('entity_change', event);
      });
    });

    log.debug('websocket', { action: 'initialized', message: 'Socket.IO server initialized' });
  }

  res.socket.end();
}

export default withAuth(handler as any);