# Collaborative CRDT Engine 🚀

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Yjs](https://img.shields.io/badge/Yjs-B31B1B?style=for-the-badge)](https://yjs.dev/)
[![WebSockets](https://img.shields.io/badge/WebSockets-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)

A high-performance, real-time backend engine designed for collaborative applications like Figma or Google Docs. This project implements a robust synchronization layer using Conflict-free Replicated Data Types (CRDTs) to ensure seamless, conflict-free state management across distributed clients.

## 🌟 Overview

Managing real-time collaborative state is a complex challenge involving race conditions and state divergence. This engine solves these problems by utilizing **Yjs** for CRDT logic and **WebSockets** for low-latency communication. It guarantees **Strong Eventual Consistency (SEC)**, allowing multiple users to edit the same document simultaneously without central locks, while ensuring every client eventually converges to the same state.

## ✨ Key Features

- **CRDT-based Synchronization:** Leverages Yjs to handle complex document merges (text, maps, arrays) with mathematical guarantees of consistency.
- **Horizontal Scalability:** Integrated with Redis Pub/Sub to synchronize document updates across multiple server instances, enabling a cluster-ready architecture.
- **Binary Protocol Efficiency:** Uses `y-protocols` and `lib0` for compact binary encoding, significantly reducing bandwidth compared to JSON-based synchronization.
- **Event-Sourced Persistence:** Implements an asynchronous operation log via Prisma and PostgreSQL, ensuring every edit is persisted without blocking the real-time broadcast loop.
- **Presence & Awareness:** Built-in support for the Yjs Awareness protocol to track live cursors, user selections, and online status.

## 🏗️ System Architecture

The architecture follows a distributed event-driven pattern designed for high availability and low latency.

1.  **Handshake:** Upon connection, the server retrieves the document state from the database and initializes a `WSSharedDoc`.
2.  **Sync Protocol:** It implements a two-step synchronization process:
    -   **Step 1:** The server/client exchanges "State Vectors" to identify missing updates.
    -   **Step 2:** Missing deltas are encoded as binary updates and applied to the local CRDT instance.
3.  **Real-time Broadcast:** Any local change is immediately broadcasted to all connected WebSockets in the same "room" and published to Redis for inter-node synchronization.
4.  **Asynchronous Persistence:** Operations are appended to a PostgreSQL-backed operation log asynchronously to maintain peak throughput.

## 📊 Performance Benchmarks

The following benchmarks were recorded using the internal load-testing suite, simulating a high-concurrency collaborative environment.

**Methodology:** 100 concurrent clients connected to a single document, each performing 10 consecutive insert operations with a 100ms delay to simulate realistic human typing behavior.

| Metric | Result |
| :--- | :--- |
| **Total Operations** | 1,000 |
| **Total Execution Time** | 1,250 ms |
| **System Throughput** | 800.00 ops/sec |
| **P95 Latency** | 4.5 ms |
| **Average Latency** | 2.1 ms |

## 🚀 Getting Started

### Prerequisites

-   **Node.js** (v18.x or higher)
-   **Redis** (Local or Cloud instance)
-   **PostgreSQL** (or any Prisma-supported database)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-repo/figma-clone-backend.git
    cd figma-clone-backend/backend
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment:** Create a `.env` file in the `backend` directory:
    ```env
    PORT=8080
    DATABASE_URL="postgresql://user:password@localhost:5432/figma_clone"
    REDIS_URL="redis://localhost:6379"
    ```

4.  **Initialize Database:**
    ```bash
    npx prisma db push
    ```

### Running the Project

-   **Development Mode:**
    ```bash
    npm run dev
    ```
-   **Run Benchmarks:**
    ```bash
    npm run benchmark
    ```

## 📁 Project Structure

```text
backend/
├── prisma/             # Database schema and migrations
├── src/
│   ├── index.ts        # Fastify & WebSocket server entry point
│   ├── sync.ts         # Core Yjs synchronization & CRDT logic
│   ├── documentService.ts # Prisma persistence layer
│   ├── redis.ts        # Redis Pub/Sub configuration
│   └── benchmark.ts    # Performance testing suite
├── package.json        # Project dependencies and scripts
└── tsconfig.json       # TypeScript configuration
```

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more information.
# Crdt_engine
