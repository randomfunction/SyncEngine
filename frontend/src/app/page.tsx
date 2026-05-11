'use client';

import { useEffect, useState, useRef } from 'react';
import { setupDocument } from '@/lib/crdt';
import * as Y from 'yjs';
import { Loader2 } from 'lucide-react';

// For simplicity, we are hardcoding a room ID.
const DOCUMENT_ID = 'demo-room-1';

export default function Home() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('Connecting...');
  const [isOffline, setIsOffline] = useState(false);
  
  // Refs to hold the CRDT instances without triggering re-renders
  const ytextRef = useRef<Y.Text | null>(null);
  const isUpdatingRef = useRef(false);

  useEffect(() => {
    // 1. Initialize the CRDT engine
    const { ytext, wsProvider, indexeddbProvider } = setupDocument(DOCUMENT_ID);
    ytextRef.current = ytext;

    // 2. Observe changes from the CRDT (remote updates or offline load)
    const observeHandler = () => {
      // Prevent our own local React state updates from causing an infinite loop
      if (!isUpdatingRef.current) {
        setText(ytext.toString());
      }
    };
    ytext.observe(observeHandler);

    // 3. Setup WebSocket connection status handlers
    wsProvider.on('status', (event: { status: string }) => {
      if (event.status === 'connected') {
        setStatus('Connected');
        setIsOffline(false);
      } else if (event.status === 'disconnected') {
        setStatus('Disconnected - Working Offline');
        setIsOffline(true);
      }
    });

    // 4. Initial state sync from IndexedDB
    indexeddbProvider.on('synced', () => {
      setText(ytext.toString());
    });

    // Cleanup on unmount
    return () => {
      ytext.unobserve(observeHandler);
      wsProvider.destroy();
    };
  }, []);

  // Handle local typing
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText); // Optimistic UI update

    // Apply the delta to the CRDT
    if (ytextRef.current) {
      isUpdatingRef.current = true;
      
      // In a robust implementation, you compute the exact text diff (e.g., using fast-diff)
      // Here, for demonstration simplicity, we replace the entire string if it changed.
      // Yjs handles the binary encoding and vector clock incrementing automatically.
      ytextRef.current.delete(0, ytextRef.current.length);
      ytextRef.current.insert(0, newText);
      
      isUpdatingRef.current = false;
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200 flex flex-col items-center justify-center p-8 font-sans">
      <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
              Realtime CRDT Engine
            </h1>
            <p className="text-xs text-slate-500 mt-1">Room: {DOCUMENT_ID}</p>
          </div>
          
          <div className="flex items-center gap-3">
            <span className={`flex h-3 w-3 relative ${isOffline ? 'text-red-500' : 'text-emerald-500'}`}>
              {!isOffline && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-3 w-3 ${isOffline ? 'bg-red-500' : 'bg-emerald-500'}`}></span>
            </span>
            <span className="text-sm font-medium text-slate-300 flex items-center gap-2">
              {status === 'Connecting...' && <Loader2 className="w-4 h-4 animate-spin" />}
              {status}
            </span>
          </div>
        </div>

        {/* Editor Area */}
        <div className="flex-1 p-6">
          <textarea
            value={text}
            onChange={handleTextChange}
            placeholder="Start typing... changes synchronize instantly across clients."
            className="w-full h-[500px] bg-slate-950 border border-slate-800 rounded-xl p-6 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none font-mono text-sm leading-relaxed"
            spellCheck="false"
          />
        </div>
      </div>

      <div className="mt-8 text-center max-w-2xl text-sm text-slate-500 leading-relaxed">
        <p>
          This demonstrates strong eventual consistency (SEC) using Yjs.
          Every keystroke is converted into a deterministic binary delta, broadcasted via WebSockets,
          routed through Redis Pub/Sub, and appended to a causal event log in PostgreSQL.
        </p>
      </div>
    </main>
  );
}
