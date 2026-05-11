import WebSocket from 'ws';
import * as Y from 'yjs';
import { encoding, decoding } from 'lib0';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';

const WS_URL = 'ws://localhost:8080';
// Use a unique document ID for each benchmark run so it starts fresh
const DOCUMENT_ID = `benchmark-doc-${Date.now()}`;
const NUM_CLIENTS = 100;
const OPERATIONS_PER_CLIENT = 10;
const OPERATION_DELAY_MS = 100; // Delay between operations to simulate realistic typing
const TARGET_LENGTH = NUM_CLIENTS * OPERATIONS_PER_CLIENT;

interface BenchmarkResult {
  totalOperations: number;
  totalTime: number;
  throughput: number; // ops/sec
  latencies: number[];
  p95Latency: number;
}

class BenchmarkClient {
  private ws: WebSocket;
  private ydoc: Y.Doc;
  private ytext: Y.Text;
  private latencies: number[] = [];
  private operationsSent = 0;
  private operationsReceived = 0;
  private startTime: number;
  private resolve: (result: BenchmarkResult) => void;
  private connected = false;
  private isCompleted = false;

  public get isConnected(): boolean {
    return this.connected;
  }

  constructor(clientId: number, onComplete: (result: BenchmarkResult) => void) {
    this.resolve = onComplete;
    this.startTime = Date.now();

    this.ydoc = new Y.Doc();
    this.ytext = this.ydoc.getText('benchmark-text');

    this.ytext.observe(() => {
      this.checkCompletion();
    });

    this.ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin !== 'remote' && this.connected) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0); // messageSync
        syncProtocol.writeUpdate(encoder, update);
        
        this.ws.send(encoding.toUint8Array(encoder));

        this.operationsSent++;
        if (this.operationsSent < OPERATIONS_PER_CLIENT) {
          setTimeout(() => this.sendOperation(), OPERATION_DELAY_MS);
        }
      }
    });

    this.ws = new WebSocket(`${WS_URL}/${DOCUMENT_ID}`);
    this.ws.binaryType = 'arraybuffer';

    this.ws.on('open', () => {
      this.connected = true;
      this.sendSyncStep1();
    });

    // Safely handle incoming messages in Node.js context
    this.ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      try {
        // Ignore text frames (e.g., standard WebSocket pings or text handshakes)
        if (isBinary === false || typeof data === 'string') return;

        let buf: Uint8Array;
        if (Buffer.isBuffer(data)) {
          // Safely map the Node Buffer avoiding shared memory slab bleed
          buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else if (data instanceof ArrayBuffer) {
          buf = new Uint8Array(data);
        } else if (Array.isArray(data)) {
          buf = new Uint8Array(Buffer.concat(data));
        } else {
          return; // Unknown format, drop it
        }

        // Prevent lib0 from choking on empty payloads
        if (buf.byteLength === 0) return;
        
        this.handleMessage(buf);
      } catch (err) {
        console.error(`Client ${clientId} failed to parse incoming message:`, err);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
    });

    this.ws.on('error', (err) => {
      console.error(`Client ${clientId} error:`, err);
    });
  }

  private sendSyncStep1() {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0); // messageSync
    syncProtocol.writeSyncStep1(encoder, this.ydoc);
    this.ws.send(encoding.toUint8Array(encoder));
  }

  private handleMessage(message: Uint8Array) {
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);

    if (messageType === 0) { // messageSync
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // Prefix any reply with messageSync

      const before = Date.now();
      
      syncProtocol.readSyncMessage(decoder, encoder, this.ydoc, 'remote');
      
      const after = Date.now();
      this.latencies.push(after - before);
      this.operationsReceived++;

      // If a response was generated (e.g., SyncStep2), send it
      if (encoding.length(encoder) > 1) {
        this.ws.send(encoding.toUint8Array(encoder));
      }
    } else if (messageType === 1) { // messageAwareness
      // Ignored for this benchmark
    }
  }

  startOperations() {
    this.sendOperation();
  }

  private sendOperation() {
    if (!this.connected || this.operationsSent >= OPERATIONS_PER_CLIENT) return;

    // Simulate typing by inserting characters
    const pos = Math.floor(Math.random() * (this.ytext.length + 1));
    const char = String.fromCharCode(97 + Math.floor(Math.random() * 26)); // random lowercase letter
    this.ytext.insert(pos, char);
  }

  private checkCompletion() {
    if (this.isCompleted) return;
    
    // Using text length as a robust indicator of total operations across all clients
    if (this.ytext.length >= TARGET_LENGTH) {
      this.isCompleted = true;
      const endTime = Date.now();
      const totalTime = endTime - this.startTime;
      const totalOperations = TARGET_LENGTH;
      const throughput = totalOperations / (totalTime / 1000);

      this.latencies.sort((a, b) => a - b);
      const p95Index = Math.floor(this.latencies.length * 0.95);
      const p95Latency = this.latencies[p95Index] || 0;

      this.resolve({
        totalOperations,
        totalTime,
        throughput,
        latencies: this.latencies,
        p95Latency
      });
    }
  }

  public close() {
    this.connected = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      this.ws.close();
    }
  }
}

async function runBenchmark(): Promise<BenchmarkResult> {
  console.log(`Starting benchmark with ${NUM_CLIENTS} clients, ${OPERATIONS_PER_CLIENT} operations each...`);

  return new Promise((resolve, reject) => {
    const clients: BenchmarkClient[] = [];
    let completedClients = 0;
    let connectedClients = 0;
    let isDone = false;

    const logInterval = setInterval(() => {
      console.log(`Progress: ${clients.filter(c => c.isConnected).length} clients connected, ${completedClients} clients completed`);
    }, 10000);

    const finish = (result?: BenchmarkResult, error?: Error) => {
      if (isDone) return;
      isDone = true;
      clearInterval(logInterval);
      
      clients.forEach(c => c.close());

      if (error) {
        reject(error);
      } else if (result) {
        resolve(result);
      }
    };

    for (let i = 0; i < NUM_CLIENTS; i++) {
      const client = new BenchmarkClient(i, (result) => {
        completedClients++;
        if (completedClients === connectedClients) {
          finish(result);
        }
      });
      clients.push(client);
    }

    // Wait for connections to establish
    setTimeout(() => {
      connectedClients = clients.filter(c => c.isConnected).length;
      console.log(`${connectedClients} clients connected out of ${NUM_CLIENTS}`);
      
      if (connectedClients === 0) {
        finish(undefined, new Error('No clients connected - is the server running?'));
        return;
      }

      // Start operations for connected clients
      clients.forEach(client => {
        if (client.isConnected) {
          client.startOperations();
        }
      });
    }, 5000); // 5 seconds to allow connections

    // Timeout after 120 seconds
    setTimeout(() => {
      finish(undefined, new Error('Benchmark timed out'));
    }, 120000);
  });
}

async function main() {
  try {
    const result = await runBenchmark();

    console.log('\n=== Benchmark Results ===');
    console.log(`Total Operations: ${result.totalOperations}`);
    console.log(`Total Time: ${result.totalTime}ms`);
    console.log(`Throughput: ${result.throughput.toFixed(2)} ops/sec`);
    console.log(`P95 Latency: ${result.p95Latency}ms`);
    
    if (result.latencies.length > 0) {
      console.log(`Average Latency: ${(result.latencies.reduce((a, b) => a + b, 0) / result.latencies.length).toFixed(2)}ms`);
    } else {
      console.log(`Average Latency: 0.00ms`);
    }

  } catch (error) {
    console.error('Benchmark failed:', error instanceof Error ? error.message : error);
  }
}

if (require.main === module) {
  main();
}

export { runBenchmark };