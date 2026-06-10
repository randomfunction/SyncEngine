import { Queue, Worker } from 'bullmq';
import { createSnapshot } from './documentService';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// BullMQ requires maxRetriesPerRequest: null
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// The queue where we will push snapshot jobs
export const snapshotQueue = new Queue('snapshotQueue', { connection });

/**
 * Starts the background worker to process snapshot jobs.
 * This runs asynchronously in the same Node process.
 */
export function startSnapshotWorker() {
  const worker = new Worker('snapshotQueue', async (job) => {
    const { documentId } = job.data;
    console.log(`[BullMQ] Processing snapshot for document: ${documentId}`);
    
    try {
      await createSnapshot(documentId);
      console.log(`[BullMQ] Successfully created snapshot and compacted oplog for ${documentId}`);
    } catch (error) {
      console.error(`[BullMQ] Failed to create snapshot for ${documentId}:`, error);
      throw error;
    }
  }, { connection });

  worker.on('failed', (job, err) => {
    if (job) {
      console.error(`[BullMQ] Job ${job.id} failed with error ${err.message}`);
    }
  });

  console.log('[BullMQ] Snapshot background worker started');
}
