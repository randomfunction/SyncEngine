import Fastify from 'fastify';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient();
async function runDiagnostics() {
  try {
    const opCount = await prisma.operation.count();
    const docCount = await prisma.document.count();
    const snapshotCount = await prisma.snapshot.count();
    console.log(`[DB Status] Active Documents: ${docCount}, Snapshots: ${snapshotCount}, Operations: ${opCount}`);
  } catch (err: any) {
    console.error(`[DB Status] Connection failed: ${err.message}`);
  }
}
runDiagnostics();


import { setupWSConnection } from './sync';

const port = parseInt(process.env.PORT || '8080', 10);
const fastify = Fastify({ logger: true });

// Basic health check route
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

const start = async () => {
  try {
    // Start Fastify to attach to HTTP
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Server listening on port ${port}`);

    // We attach the WebSocket server to Fastify's raw HTTP server
    const wss = new WebSocketServer({ server: fastify.server });

    wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      fastify.log.info(`New WebSocket connection established for ${req.url}`);
      // Pass the connection to our custom Yjs synchronization engine
      setupWSConnection(ws, req);
    });

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
