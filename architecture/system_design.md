# Realtime Collaborative CRDT Document Engine - System Design

## Overview
This system is a realtime collaborative document editing engine built on CRDTs (Conflict-free Replicated Data Types) and Event Sourcing. It allows multiple users to concurrently edit text and structured blocks, automatically resolving conflicts and guaranteeing eventual consistency across all clients.

## High-Level Architecture

```mermaid
graph TD
    Client1[Client 1 (Next.js)] <-->|WebSocket| LB[Load Balancer]
    Client2[Client 2 (Next.js)] <-->|WebSocket| LB
    Client3[Client 3 (Next.js)] <-->|WebSocket| LB
    
    LB <--> WS1[WebSocket Server 1 (Fastify)]
    LB <--> WS2[WebSocket Server 2 (Fastify)]
    
    WS1 <-->|Pub/Sub| Redis[(Redis Pub/Sub)]
    WS2 <-->|Pub/Sub| Redis
    
    WS1 -->|Async Append| Oplog1[Operation Log Worker]
    WS2 -->|Async Append| Oplog2[Operation Log Worker]
    
    Oplog1 --> DB[(PostgreSQL)]
    Oplog2 --> DB
    
    SnapshotWorker[Snapshot Worker] -->|Reads Oplogs| DB
    SnapshotWorker -->|Writes Snapshots| DB
```

## Core Components

### 1. Client (Next.js + CRDT)
- **Local State**: Maintains an in-memory CRDT instance representing the document.
- **Offline Persistence**: Uses IndexedDB to persist local operations and document state.
- **Sync Engine**: Connects via WebSockets to the backend, sending local deltas and receiving remote operations.

### 2. WebSocket Servers (Node.js + Fastify)
- **Connection Management**: Handles WebSocket connections, authentication, and heartbeats.
- **Room Management**: Groups users into "rooms" (documents) for targeted broadcasting.
- **Delta Broadcasting**: Relays operations (deltas) from one client to others in the same room.

### 3. Redis Pub/Sub
- **Inter-node Communication**: Facilitates broadcasting operations across multiple WebSocket servers. If Client A is connected to WS1 and Client B to WS2, WS1 publishes Client A's operation to Redis, and WS2 consumes it to forward to Client B.

### 4. Operation Log (PostgreSQL)
- **Event Sourcing**: Every operation (delta) is appended to an operations log table. This provides a causal history of all changes.
- **Schema**: `id`, `document_id`, `client_id`, `clock` (vector clock/sequence), `operation_payload`, `timestamp`.

### 5. Snapshot Worker
- **Compaction**: Periodically reads operations for a document and computes a compressed snapshot of the CRDT state.
- **Optimization**: Allows clients to download a snapshot to initialize the document quickly, followed by only the recent operations, rather than replaying the entire history from scratch.

## Synchronization Protocol
1. **Connect**: Client connects to WS and sends its local state vector (version vector).
2. **Sync Step 1**: Server compares the client's state vector with its own history and sends missing operations.
3. **Sync Step 2**: Client applies missing operations and sends any local operations the server doesn't have.
4. **Realtime**: Client sends deltas as they happen. Server broadcasts to other clients in the room via Redis and asynchronously writes to the DB.

## Storage Strategy
- **PostgreSQL**: Primary source of truth. Stores structured data, users, document metadata, operation logs, and snapshots.
- **Redis**: Ephemeral state for pub/sub and active presence (who is currently in a document).
- **IndexedDB**: Local offline storage for clients to queue operations when disconnected.

## Consistency Guarantees
- **Strong Eventual Consistency (SEC)**: Guaranteed by CRDTs. If all clients receive the same set of operations (regardless of order), they will converge to the exact same state.
- **Causal Consistency**: Ensured by vector clocks or logical timestamps accompanying operations.

## Scaling Strategy
- **Stateless WebSocket Servers**: WS servers hold transient connection state but document state is derived from DB/Redis. Thus, we can scale out WS servers horizontally.
- **Document Sharding**: Heavy documents can be pinned to specific servers using consistent hashing to optimize memory, but a pub/sub model allows completely stateless routing.
