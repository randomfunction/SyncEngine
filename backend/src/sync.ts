import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WebSocket, RawData } from 'ws';
import { redisPublisher, redisSubscriber } from './redis';
import { loadDocument, appendOperation } from './documentService';

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

// Message types
const messageSync = 0;
const messageAwareness = 1;
const messageQueryAwareness = 3;

// In-memory cache of active documents
const docs: Map<string, WSSharedDoc> = new Map();

export class WSSharedDoc extends Y.Doc {
  name: string;
  conns: Map<WebSocket, Set<number>>;
  awareness: awarenessProtocol.Awareness;
  private redisListener: (channel: any, message: any) => void;

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
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
      );
      this.broadcastMessage(encoding.toUint8Array(encoder), conn || undefined);
    };

    this.awareness.on('update', awarenessChangeHandler);

    this.on('update', (update: Uint8Array, origin: any) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);

      const originConn = (origin && typeof origin === 'object' && 'send' in origin) ? origin as WebSocket : undefined;
      this.broadcastMessage(encoding.toUint8Array(encoder), originConn);

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
    this.redisListener = (channel: any, message: any) => {
      if (channel.toString() === `doc:${this.name}`) {
        // Apply update from Redis (origin='redis' prevents infinite loop)
        Y.applyUpdate(this, message, 'redis');
      }
    };
    redisSubscriber.on('messageBuffer', this.redisListener);
  }

  broadcastMessage(message: Uint8Array, excludeConn?: WebSocket) {
    this.conns.forEach((_, conn) => {
      if (conn.readyState === wsReadyStateOpen && conn !== excludeConn) {
        conn.send(message);
      }
    });
  }

  destroy() {
    redisSubscriber.unsubscribe(`doc:${this.name}`).catch(console.error);
    redisSubscriber.off('messageBuffer', this.redisListener);
    this.awareness.destroy();
    super.destroy();
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
  conn.on('message', (message: RawData) => {
    try {
      let messageView: Uint8Array;
      if (Buffer.isBuffer(message)) {
        messageView = new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
      } else if (message instanceof ArrayBuffer) {
        messageView = new Uint8Array(message);
      } else if (Array.isArray(message)) {
        const combined = Buffer.concat(message);
        messageView = new Uint8Array(combined.buffer, combined.byteOffset, combined.byteLength);
      } else {
        return;
      }

      const decoder = decoding.createDecoder(messageView);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === messageSync) {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, messageSync);
        const syncMessageType = syncProtocol.readSyncMessage(decoder, reply, doc, conn);

        if (encoding.length(reply) > 1) {
          conn.send(encoding.toUint8Array(reply));
        }

        if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
          const syncStep1 = encoding.createEncoder();
          encoding.writeVarUint(syncStep1, messageSync);
          syncProtocol.writeSyncStep1(syncStep1, doc);
          conn.send(encoding.toUint8Array(syncStep1));
        }
      } else if (messageType === messageAwareness) {
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
      } else if (messageType === messageQueryAwareness) {
        const awarenessResponse = encoding.createEncoder();
        encoding.writeVarUint(awarenessResponse, messageAwareness);
        encoding.writeVarUint8Array(
          awarenessResponse,
          awarenessProtocol.encodeAwarenessUpdate(
            doc.awareness,
            Array.from(doc.awareness.getStates().keys())
          )
        );
        conn.send(encoding.toUint8Array(awarenessResponse));
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
        doc.destroy();
        docs.delete(docName);
      }
    }
  });
}
