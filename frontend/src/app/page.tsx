'use client';

import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { useSearchParams, useRouter } from 'next/navigation';
import { Github, FolderPlus, Globe } from 'lucide-react';
import Mermaid from '@/components/Mermaid';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080';
const messageSync = 0;
const messageAwareness = 1;

const MERMAID_CHART = `
graph TD
    subgraph "Client Layer"
        C1[Client A]
        C2[Client B]
        C3[Client C]
    end

    subgraph "Load Balancing"
        LB[NLB / Reverse Proxy]
    end

    subgraph "Application Fleet"
        S1[Sync Server 1]
        S2[Sync Server 2]
    end

    subgraph "State & Transport"
        R[(Redis Pub/Sub)]
        DB[(PostgreSQL Oplog)]
    end

    C1 <--> LB
    C2 <--> LB
    C3 <--> LB
    LB <--> S1
    LB <--> S2
    S1 <--> R
    S2 <--> R
    S1 -- Async Append --> DB
    S2 -- Async Append --> DB
`;

function EditorApp() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [documentId, setDocumentId] = useState<string>('');
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [newRoomName, setNewRoomName] = useState('');

  const ydocRef = useRef<Y.Doc | null>(null);
  const ytextRef = useRef<Y.Text | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isLocalUpdate = useRef(false);
  const isSynced = useRef(false);

  // Initialize Room ID
  useEffect(() => {
    const roomParam = searchParams.get('room');
    if (roomParam) {
      setDocumentId(roomParam);
    } else {
      const randomRoom = `room-${Math.random().toString(36).substring(2, 9)}`;
      router.replace(`/?room=${randomRoom}`);
    }
  }, [searchParams, router]);

  const sendMessage = useCallback((msg: Uint8Array) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }, []);

  useEffect(() => {
    if (!documentId) return;

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('collaborative-text');
    ydocRef.current = ydoc;
    ytextRef.current = ytext;

    // Reset text when switching rooms
    setText('');

    const observer = () => {
      if (!isLocalUpdate.current) {
        setText(ytext.toString());
      }
    };
    ytext.observe(observer);

    const updateHandler = (update: Uint8Array, origin: any) => {
      if (origin === 'remote') return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      sendMessage(encoding.toUint8Array(encoder));
    };
    ydoc.on('update', updateHandler);

    let ws: WebSocket | null = null;
    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) return;
      setStatus('connecting');
      isSynced.current = false;

      ws = new WebSocket(`${WS_URL}/${documentId}`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.writeSyncStep1(encoder, ydoc);
        sendMessage(encoding.toUint8Array(encoder));
      };

      ws.onmessage = (event: MessageEvent) => {
        if (destroyed) return;
        const data = event.data;
        let buf: Uint8Array;
        if (data instanceof ArrayBuffer) {
          buf = new Uint8Array(data);
        } else return;

        if (buf.byteLength === 0) return;

        try {
          const decoder = decoding.createDecoder(buf);
          const messageType = decoding.readVarUint(decoder);

          if (messageType === messageSync) {
            const replyEncoder = encoding.createEncoder();
            encoding.writeVarUint(replyEncoder, messageSync);
            syncProtocol.readSyncMessage(decoder, replyEncoder, ydoc, 'remote');
            if (encoding.length(replyEncoder) > 1) {
              sendMessage(encoding.toUint8Array(replyEncoder));
            }
            if (!isSynced.current) {
              isSynced.current = true;
              setText(ytext.toString());
            }
          }
        } catch (err) {
          console.error('Failed to process WS message:', err);
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!destroyed) {
          setStatus('disconnected');
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ytext.unobserve(observer);
      ydoc.off('update', updateHandler);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      ydoc.destroy();
    };
  }, [documentId, sendMessage]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);

    const ytext = ytextRef.current;
    if (!ytext) return;

    isLocalUpdate.current = true;
    const oldText = ytext.toString();

    let start = 0;
    while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start++;

    let oldEnd = oldText.length;
    let newEnd = newText.length;
    while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }

    const deleteCount = oldEnd - start;
    if (deleteCount > 0) ytext.delete(start, deleteCount);
    const insertStr = newText.slice(start, newEnd);
    if (insertStr.length > 0) ytext.insert(start, insertStr);

    isLocalUpdate.current = false;
  };

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (newRoomName.trim()) {
      router.push(`/?room=${encodeURIComponent(newRoomName.trim())}`);
      setNewRoomName('');
    }
  };

  const statusColor = {
    connecting: 'bg-amber-400',
    connected: 'bg-emerald-500',
    disconnected: 'bg-red-500',
  }[status];

  const statusLabel = {
    connecting: 'Connecting...',
    connected: 'Live Sync',
    disconnected: 'Offline',
  }[status];

  if (!documentId) return <div className="min-h-screen bg-slate-50 flex items-center justify-center">Loading...</div>;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* Navbar */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <Globe className="w-6 h-6 text-blue-600" />
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent hidden sm:block">
            SyncEngine
          </h1>
        </div>

        <form onSubmit={handleCreateRoom} className="flex items-center gap-2 flex-1 max-w-md mx-4">
          <div className="relative flex-1">
            <input
              type="text"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Enter new room name..."
              className="w-full pl-4 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
          <button
            type="submit"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
          >
            <FolderPlus className="w-4 h-4" />
            <span className="hidden sm:inline">New Room</span>
          </button>
        </form>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200">
            <span className="relative flex h-2.5 w-2.5">
              {status === 'connected' && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${statusColor}`} />
            </span>
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">{statusLabel}</span>
          </div>
          <a
            href="https://github.com/tanishq/syncengine-collab"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-slate-700 transition-colors"
          >
            <Github className="w-6 h-6" />
          </a>
        </div>
      </header>

      {/* Main Content (Split Layout) */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        
        {/* Left Column: Editor */}
        <section className="flex-1 flex flex-col p-6 lg:border-r border-slate-200 bg-slate-50">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              Collaborative Editor
            </h2>
            <span className="text-xs font-mono text-blue-600 bg-blue-100 px-2 py-1 rounded-md border border-blue-200">
              Room: {documentId}
            </span>
          </div>
          
          <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-400 transition-all">
            <textarea
              value={text}
              onChange={handleTextChange}
              placeholder="Start typing... anyone in this room will see your changes instantly."
              className="flex-1 w-full p-6 bg-transparent text-slate-800 placeholder-slate-400 focus:outline-none resize-none font-mono text-sm leading-relaxed"
              spellCheck={false}
            />
          </div>
        </section>

        {/* Right Column: Architecture */}
        <aside className="w-full lg:w-[40%] bg-white p-6 flex flex-col shadow-inner overflow-y-auto">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-800">System Architecture</h2>
            <p className="text-sm text-slate-500 mt-1">
              Strong Eventual Consistency (SEC) via CRDTs. Raw binary deltas over WebSockets.
            </p>
          </div>
          
          <div className="flex-1 bg-slate-50 rounded-xl border border-slate-200 p-4 min-h-[400px]">
            <Mermaid chart={MERMAID_CHART} />
          </div>
        </aside>

      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center">Loading...</div>}>
      <EditorApp />
    </Suspense>
  );
}
