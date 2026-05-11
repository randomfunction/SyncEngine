import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';

// This is our global CRDT document for a specific room
export function setupDocument(documentId: string) {
  const ydoc = new Y.Doc();

  // 1. Offline Persistence (IndexedDB)
  // This immediately loads the offline state, meaning the UI is interactive instantly
  const indexeddbProvider = new IndexeddbPersistence(documentId, ydoc);
  
  // 2. Realtime Synchronization (WebSockets)
  // We connect to our Fastify server.
  // In production, the URL would be configured via env vars
  const wsProvider = new WebsocketProvider(
    'ws://localhost:8080',
    documentId,
    ydoc
  );

  // Expose the shared text type (for our collaborative text area)
  const ytext = ydoc.getText('collaborative-text');

  return { ydoc, ytext, wsProvider, indexeddbProvider };
}
