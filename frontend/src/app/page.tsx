'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';

const DOCUMENT_ID = 'demo-room-1';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080';

const messageSync = 0;
const messageAwareness = 1;

export default function Home() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  const ydocRef = useRef<Y.Doc | null>(null);
  const ytextRef = useRef<Y.Text | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isLocalUpdate = useRef(false);
  const isSynced = useRef(false);

  // Send a binary message over the WebSocket
  const sendMessage = useCallback((msg: Uint8Array) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }, []);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('collaborative-text');
    ydocRef.current = ydoc;
    ytextRef.current = ytext;

    // ---- CRDT Observer: Update React state when the CRDT changes ----
    const observer = () => {
      if (!isLocalUpdate.current) {
        setText(ytext.toString());
      }
    };
    ytext.observe(observer);

    // ---- Yjs update handler: Forward local updates to server ----
    const updateHandler = (update: Uint8Array, origin: any) => {
      if (origin === 'remote') return; // Don't echo remote updates back

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      sendMessage(encoding.toUint8Array(encoder));
    };
    ydoc.on('update', updateHandler);

    // ---- WebSocket connection ----
    let ws: WebSocket | null = null;
    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) return;

      setStatus('connecting');
      isSynced.current = false;

      ws = new WebSocket(`${WS_URL}/${DOCUMENT_ID}`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');

        // Send SyncStep1: our state vector so the server knows what we have
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
        } else {
          return; // ignore text frames
        }

        if (buf.byteLength === 0) return;

        try {
          const decoder = decoding.createDecoder(buf);
          const messageType = decoding.readVarUint(decoder);

          if (messageType === messageSync) {
            const replyEncoder = encoding.createEncoder();
            encoding.writeVarUint(replyEncoder, messageSync);

            syncProtocol.readSyncMessage(decoder, replyEncoder, ydoc, 'remote');

            // If readSyncMessage produced a reply (e.g. SyncStep2), send it
            if (encoding.length(replyEncoder) > 1) {
              sendMessage(encoding.toUint8Array(replyEncoder));
            }

            if (!isSynced.current) {
              isSynced.current = true;
              setText(ytext.toString());
            }
          } else if (messageType === messageAwareness) {
            // We don't track awareness in this minimal UI, but parse it to avoid errors
          }
        } catch (err) {
          console.error('Failed to process WS message:', err);
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!destroyed) {
          setStatus('disconnected');
          // Reconnect with backoff
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        // onclose will fire after this, triggering reconnect
      };
    }

    connect();

    // ---- Cleanup ----
    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ytext.unobserve(observer);
      ydoc.off('update', updateHandler);
      if (ws) {
        ws.onclose = null; // prevent reconnect on intentional close
        ws.close();
      }
      ydoc.destroy();
    };
  }, [sendMessage]);

  // ---- Handle local typing with minimal diff ----
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);

    const ytext = ytextRef.current;
    if (!ytext) return;

    isLocalUpdate.current = true;

    const oldText = ytext.toString();

    // Find first differing character
    let start = 0;
    while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) {
      start++;
    }

    // Find last differing character from end
    let oldEnd = oldText.length;
    let newEnd = newText.length;
    while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }

    // Apply surgical diff
    const deleteCount = oldEnd - start;
    if (deleteCount > 0) {
      ytext.delete(start, deleteCount);
    }
    const insertStr = newText.slice(start, newEnd);
    if (insertStr.length > 0) {
      ytext.insert(start, insertStr);
    }

    isLocalUpdate.current = false;
  };

  const statusColor = {
    connecting: 'bg-amber-500',
    connected: 'bg-emerald-500',
    disconnected: 'bg-red-500',
  }[status];

  const statusLabel = {
    connecting: 'Connecting…',
    connected: 'Live',
    disconnected: 'Offline — Reconnecting…',
  }[status];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center justify-center p-8 font-sans">
      <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
              SyncEngine — CRDT Collaborative Editor
            </h1>
            <p className="text-xs text-slate-500 mt-1">Room: {DOCUMENT_ID}</p>
          </div>

          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              {status === 'connected' && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={`relative inline-flex rounded-full h-3 w-3 ${statusColor}`} />
            </span>
            <span className="text-sm font-medium text-slate-300">{statusLabel}</span>
          </div>
        </div>

        {/* Editor Area */}
        <div className="flex-1 p-6">
          <textarea
            value={text}
            onChange={handleTextChange}
            placeholder="Start typing… changes sync instantly across clients."
            className="w-full h-[500px] bg-slate-950 border border-slate-800 rounded-xl p-6 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none font-mono text-sm leading-relaxed"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="mt-8 text-center max-w-2xl text-sm text-slate-500 leading-relaxed">
        <p>
          Strong Eventual Consistency via Yjs CRDTs. Binary deltas over raw WebSockets.
          No y-websocket provider — direct protocol integration for zero overhead.
        </p>
      </div>
    </main>
  );
}
