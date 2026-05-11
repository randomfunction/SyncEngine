import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// We need two instances: one for publishing and one for subscribing
export const redisPublisher = new Redis(redisUrl);
export const redisSubscriber = new Redis(redisUrl);

redisPublisher.on('connect', () => console.log('Redis Publisher connected'));
redisSubscriber.on('connect', () => console.log('Redis Subscriber connected'));
