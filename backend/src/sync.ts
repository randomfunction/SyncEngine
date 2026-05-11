import * as Y from 'yjs';
import { encoding } from 'lib0';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { WebSocket } from 'ws';
import { redisPublisher, redisSubscriber } from './redis';
import { loadDocument, appendOperation } from './documentService';

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

// Message types
const messageSync = 0;
const messageAwareness = 1;

// In-memory cache of active documents
const docs: Map<string, WSSharedDoc> = new Map();

export class WSSharedDoc extends Y.Doc {
  name: string;
  conns: Map<WebSocket, Set<number>>;
  awareness: awarenessProtocol.Awareness;

  constructor(name: string) {
    super();
    this.name = name;
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);

    const awarenessChangeHandler = ({ added, updated, removed }: any, conn: WebSocket | null) => {
      const changedClients = added.concat(updated, removed);
      if (conn !== null) {
        const connControlledIDs = this.conns.get(conn);
        if (connControlledIDs !== undefined) {
          added.forEach((clientID: number) => { connControlledIDs.add(clientID); });
          removed.forEach((clientID: number) => { connControlledIDs.delete(clientID); });
        }
      }
      // broadcast awareness update
      const encoder = new Uint8Array(awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients));
      this.broadcastMessage(encoder);
    };
    
    this.awareness.on('update', awarenessChangeHandler);

    this.on('update', (update: Uint8Array, origin: any) => {
      // 1. Broadcast the update to all connected WebSockets
      const encoder = new Uint8Array(update.length + 2);
      encoder[0] = messageSync;
      encoder[1] = syncProtocol.messageYjsUpdate;
      encoder.set(update, 2);
      this.broadcastMessage(encoder);

      // 2. Persist the update to the database asynchronously
      // origin is usually the WebSocket connection if it came from a client
      // or 'redis' if it came from Pub/Sub
      if (origin !== 'redis' && origin !== 'server-load') {
        appendOperation(this.name, 'server', update).catch(err => {
          console.error('Failed to append operation to DB:', err);
        });

        // 3. Publish to Redis so other server instances know about this update
        redisPublisher.publish(`doc:${this.name}`, Buffer.from(update)).catch(console.error);
      }
    });

    // Subscribe to Redis for updates from other Fastify instances
    redisSubscriber.subscribe(`doc:${this.name}`);
    redisSubscriber.on('messageBuffer', (channel, message) => {
      if (channel.toString() === `doc:${this.name}`) {
        // Apply update from Redis (origin='redis' prevents infinite loop)
        Y.applyUpdate(this, message, 'redis');
      }
    });
  }

  broadcastMessage(message: Uint8Array) {
    this.conns.forEach((_, conn) => {
      if (conn.readyState === wsReadyStateOpen) {
        conn.send(message);
      }
    });
  }
}

export async function setupWSConnection(conn: WebSocket, req: any, { docName = req.url.slice(1).split('?')[0] } = {}) {
  conn.binaryType = 'arraybuffer';
  
  // Get or create the document
  let doc = docs.get(docName);
  if (!doc) {
    doc = new WSSharedDoc(docName);
    docs.set(docName, doc);
    
    // Load state from DB
    try {
      const dbDoc = await loadDocument(docName);
      const state = Y.encodeStateAsUpdate(dbDoc);
      Y.applyUpdate(doc, state, 'server-load');
    } catch (e) {
      console.error('Failed to load doc from DB', e);
    }
  }

  doc.conns.set(conn, new Set());

  // Listen for messages from this client
  conn.on('message', (message: ArrayBuffer) => {
    try {
      const messageView = new Uint8Array(message);
      // We manually parse the message format expected by y-websocket
      // First byte is message type
      const messageType = messageView[0];
      
      if (messageType === messageSync) {
        // We use Yjs sync protocol to handle Sync Step 1, Sync Step 2, and Updates
        // Because y-protocols uses its own custom decoding, we'll implement a simple bridge.
        const syncMessageType = messageView[1];
        if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
           const stateVector = messageView.slice(2);
           const update = Y.encodeStateAsUpdateV2(doc, stateVector);
           // Send SyncStep2 back
           const response = new Uint8Array(update.length + 2);
           response[0] = messageSync;
           response[1] = syncProtocol.messageYjsSyncStep2;
           response.set(update, 2);
           conn.send(response);
        } else if (syncMessageType === syncProtocol.messageYjsUpdate) {
           const update = messageView.slice(2);
           Y.applyUpdate(doc, update, conn);
        } else if (syncMessageType === syncProtocol.messageYjsSyncStep2) {
           const update = messageView.slice(2);
           Y.applyUpdate(doc, update, conn);
        }
      } else if (messageType === messageAwareness) {
        awarenessProtocol.applyAwarenessUpdate(doc.awareness, messageView.slice(1), conn);
      }
    } catch (err) {
      console.error('Error processing message', err);
    }
  });

  // Handle client disconnect
  let isClosed = false;
  conn.on('close', () => {
    if (!isClosed && doc) {
      isClosed = true;
      const controlledIds = doc.conns.get(conn);
      if (controlledIds) {
        doc.conns.delete(conn);
        awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
      }
      if (doc.conns.size === 0) {
        // Optionally clean up doc from memory after a delay
      }
    }
  });

  // Send initial Sync Step 1 to the client so they know our state
  const stateVector = Y.encodeStateVector(doc);
  const sync1 = new Uint8Array(stateVector.length + 2);
  sync1[0] = messageSync;
  sync1[1] = syncProtocol.messageYjsSyncStep1;
  sync1.set(stateVector, 2);
  conn.send(sync1);
}
