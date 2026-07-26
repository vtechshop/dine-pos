import mongoose from 'mongoose';
import { logger } from '../utils/logger';

const connectDB = async (): Promise<void> => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hotelbillingpos';
    await mongoose.connect(mongoURI, {
      // Node.js is single-threaded; the event loop processes one callback at a
      // time regardless of pool size. 20 connections saturate the async I/O
      // pipeline for a single process while leaving Atlas headroom for other
      // clients. The previous value of 100 provided no throughput benefit and
      // consumed up to 100 of the Atlas M0/M2 connection limit (500 total).
      maxPoolSize: 20,
      // Keep 5 warm connections so the first post-idle request isn't slowed
      // by connection establishment overhead.
      minPoolSize: 5,
      // Fail fast if every connection is busy — better than queuing indefinitely
      // which can cause request pile-up under sustained load.
      waitQueueTimeoutMS: 10_000,
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
      retryWrites: true,
      w: 'majority',
    });
    logger.info('MongoDB connected');
  } catch (error) {
    logger.error('MongoDB connection failed', { err: String(error) });
    process.exit(1);
  }
};

export default connectDB;
