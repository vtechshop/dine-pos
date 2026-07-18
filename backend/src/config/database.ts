import mongoose from 'mongoose';
import { logger } from '../utils/logger';

const connectDB = async (): Promise<void> => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hotelbillingpos';
    await mongoose.connect(mongoURI, {
      maxPoolSize: 100,
      minPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
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
