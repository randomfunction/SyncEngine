# Realtime Collaborative CRDT Document Engine - Development Roadmap

## Phase 1: Setup & Infrastructure
- Initialize Next.js frontend and Fastify backend.
- Setup monorepo structure or separate directories.
- Configure Docker Compose (PostgreSQL, Redis).
- Establish Prisma ORM and database schema (Users, Documents, Oplog, Snapshots).

## Phase 2: Backend Foundation & WebSocket Layer
- Implement basic Fastify REST API for document creation/listing.
- Integrate WebSockets (`ws` library).
- Implement room management (join/leave document rooms).
- Implement Redis Pub/Sub for horizontal scaling of WebSocket broadcasting.

## Phase 3: The CRDT Engine
- Integrate or build the CRDT data structures (using Yjs for production-grade robustness).
- Implement the sync protocol (State Vector exchange, Delta synchronization).
- Handle concurrent edits and test deterministic conflict resolution.

## Phase 4: Event Sourcing & Persistence
- Implement the Append-only Operation Log in PostgreSQL.
- Build the asynchronous persistence layer (writing operations without blocking WS broadcast).
- Implement document recovery: Load base snapshot + replay recent operations.

## Phase 5: Offline Support & Optimistic UI
- Configure IndexedDB on the frontend (via `y-indexeddb`).
- Implement an operation queue that captures edits while disconnected.
- Implement the reconnect sync logic (flushing queued operations, applying missed remote operations).

## Phase 6: Snapshotting & Compaction
- Create a background worker that periodically squashes operations into a single snapshot.
- Update the document load logic to use the latest skip phase 6 and 7 and but not skip phase 8snapshot + operations after the snapshot.

## Phase 7: Observability & Metrics
- Instrument backend with OpenTelemetry.
- Export metrics to Prometheus (e.g., WS connections, sync latency, operation throughput).
- Setup basic Grafana dashboard.

## Phase 8: Benchmarking & Polish
- Write a benchmarking script to simulate 100+ concurrent clients generating operations.
- Measure p95 latency and operation throughput.
- Finalize README.md with architecture, instructions, and metrics.
