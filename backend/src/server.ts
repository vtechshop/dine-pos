import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import connectDB from './config/database';
import ChatMessage from './models/ChatMessage';

// Route imports
import categoryRoutes from './routes/categoryRoutes';
import productRoutes from './routes/productRoutes';
import orderRoutes from './routes/orderRoutes';
import settingsRoutes from './routes/settingsRoutes';
import seedRoutes from './routes/seedRoutes';
import menuRoutes from './routes/menuRoutes';
import chatRoutes from './routes/chatRoutes';
import authRoutes from './routes/authRoutes';
import hotelRoutes from './routes/hotelRoutes';
import verifyRoutes from './routes/verifyRoutes';
import superAdminRoutes from './routes/superAdminRoutes';
import ticketRoutes from './routes/ticketRoutes';
import uploadRoutes from './routes/uploadRoutes';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;

// Socket.io setup
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e4, // 10KB max message size
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Serve customer digital menu PWA
app.use('/menu', express.static(path.join(__dirname, '../public/menu')));

// Serve uploaded product images
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/hotels', hotelRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/superadmin', superAdminRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/seed', seedRoutes);
app.use('/api/public/menu', menuRoutes);
app.use('/api/chat', chatRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Fallback: /menu/* → index.html
app.get('/menu/*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/menu/index.html'));
});

// ── Global 404 handler ────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  // Hotel admin joins their hotel room (for order alerts)
  socket.on('join_hotel', (hotelId: string) => {
    if (typeof hotelId === 'string' && hotelId.length > 0) {
      socket.join(`hotel_${hotelId}`);
    }
  });

  // Join a room by table number or 'admin' (legacy chat)
  socket.on('join', (room: string) => {
    socket.join(room);
    socket.join('admin');
  });

  // Customer sends message
  socket.on('customer_message', async (data: { tableNumber: string; message: string }) => {
    try {
      if (!data?.tableNumber || !data?.message) return;
      const msg = await ChatMessage.create({
        tableNumber: data.tableNumber,
        sender: 'customer',
        message: String(data.message).substring(0, 500), // cap message length
      });
      io.to(data.tableNumber).to('admin').emit('new_message', msg);
    } catch (err) {
      console.error('Chat error:', err);
    }
  });

  // Admin replies to a table
  socket.on('admin_message', async (data: { tableNumber: string; message: string }) => {
    try {
      if (!data?.tableNumber || !data?.message) return;
      const msg = await ChatMessage.create({
        tableNumber: data.tableNumber,
        sender: 'admin',
        message: String(data.message).substring(0, 500),
        read: true,
      });
      io.to(data.tableNumber).to('admin').emit('new_message', msg);
    } catch (err) {
      console.error('Chat error:', err);
    }
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });
});

// Export io for use in routes if needed
export { io };

// ── Process-level crash guards ────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Give pending responses time to complete before exiting
  setTimeout(() => process.exit(1), 1000);
});

// Connect to MongoDB and start server
connectDB().then(() => {
  httpServer.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 API Base: http://localhost:${PORT}/api`);
    console.log(`📱 Customer Menu: http://localhost:${PORT}/menu`);
    console.log(`💬 Chat: Socket.io ready`);
  });
}).catch((err) => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
});

export default app;
