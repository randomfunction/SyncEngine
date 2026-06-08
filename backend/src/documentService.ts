import { PrismaClient } from '@prisma/client';
import * as Y from 'yjs';

const prisma = new PrismaClient();
/**
 * Loads a Yjs document from the database by replaying operations
 * and loading the latest snapshot if available.
 */
export async function loadDocument(documentId: string): Promise<Y.Doc> {
  const ydoc = new Y.Doc();

  // 1. Fetch the latest snapshot
  const snapshot = await prisma.snapshot.findFirst({
    where: { documentId },
    orderBy: { clock: 'desc' },
  });

  let lastClock = 0;

  if (snapshot) {
    // Apply the snapshot state to the Yjs document
    Y.applyUpdate(ydoc, snapshot.state);
    lastClock = snapshot.clock;
  }

  // 2. Fetch all operations that occurred after this snapshot
  const operations = await prisma.operation.findMany({
    where: {
      documentId,
      clock: { gt: lastClock },
    },
    orderBy: { clock: 'asc' },
  });

  // 3. Replay operations to reconstruct the exact current state
  // In Yjs, operations are just binary updates.
  for (const op of operations) {
    Y.applyUpdate(ydoc, op.payload);
  }

  return ydoc;
}

/**
 * Appends a new operation to the append-only log.
 * In a real high-throughput system, this would be batched.
 */
export async function appendOperation(documentId: string, clientId: string, updatePayload: Uint8Array) {
  // To avoid race conditions on the sequence clock, we rely on the database's transactional guarantees
  // or a monotonic sequence generator. Here we simply use an incrementing clock per document.
  await prisma.$transaction(async (tx) => {
    // Get the current max clock for this document
    const lastOp = await tx.operation.findFirst({
      where: { documentId },
      orderBy: { clock: 'desc' },
      select: { clock: true },
    });

    const nextClock = lastOp ? lastOp.clock + 1 : 1;

    await tx.operation.create({
      data: {
        documentId,
        clientId,
        payload: Buffer.from(updatePayload),
        clock: nextClock,
      },
    });
  });
}

/**
 * Periodically called background task to compact operations into a snapshot.
 */
export async function createSnapshot(documentId: string) {
  // Load the full document state
  const ydoc = await loadDocument(documentId);
  const stateVector = Y.encodeStateAsUpdate(ydoc);

  // Get the latest clock
  const lastOp = await prisma.operation.findFirst({
    where: { documentId },
    orderBy: { clock: 'desc' },
    select: { clock: true },
  });

  const clock = lastOp ? lastOp.clock : 0;

  // Save the snapshot
  await prisma.snapshot.create({
    data: {
      documentId,
      state: Buffer.from(stateVector),
      clock,
    },
  });

  // Optional: Garbage collect old operations (e.g. delete operations where clock <= this.clock)
  // For true event sourcing, you might keep them. For a purely state-sync system, you can delete them.
  await prisma.operation.deleteMany({
    where: {
      documentId,
      clock: { lte: clock },
    },
  });
}
