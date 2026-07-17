import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { makeRateLimiter } from './utils/rateLimiter';
import connectDB from './config/database';
import { connectRedis, getRedisClient, closeRedis, redisHealthCheck } from './config/redis';
import { logger } from './utils/logger';
import ChatMessage from './models/ChatMessage';
import PrinterDevice from './models/PrinterDevice';

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
import tableRoutes from './routes/tableRoutes';
import reservationRoutes from './routes/reservationRoutes';
import expenseRoutes from './routes/expenseRoutes';
import wasteRoutes from './routes/wasteRoutes';
import aggregatorRoutes from './routes/aggregatorRoutes';
import ingredientRoutes from './routes/ingredientRoutes';
import reportRoutes from './routes/reportRoutes';
import remoteConfigRoutes from './routes/remoteConfigRoutes';
import deviceRoutes from './routes/deviceRoutes';
import notificationRoutes from './routes/notificationRoutes';
import waiterRoutes from './routes/waiterRoutes';
import cashierRoutes from './routes/cashierRoutes';
import auditRoutes from './routes/auditRoutes';
import sessionRoutes from './routes/sessionRoutes';
import qrRoutes from './routes/qrRoutes';
import loyaltyRoutes from './routes/loyaltyRoutes';
import printRoutes from './routes/printRoutes';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';

dotenv.config();

// TODO: Set SENTRY_DSN in production environment (e.g., via Render environment variables)
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
  });
}

// ── Validate required env vars at startup ─────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'hotelbillingpos_secret_key_change_in_production') {
  console.error('❌ FATAL: JWT_SECRET is not set or is using the default insecure value. Set a strong secret in .env');
  process.exit(1);
}

const SUPER_ADMIN_PASS = process.env.SUPER_ADMIN_PASS;
if (!SUPER_ADMIN_PASS) {
  console.error('❌ FATAL: SUPER_ADMIN_PASS is not set. Add it to your .env file.');
  process.exit(1);
}

if (!process.env.SUPER_ADMIN_ID) {
  console.error('❌ FATAL: SUPER_ADMIN_ID is not set. Add it to your .env file.');
  process.exit(1);
}

if (!process.env.MONGODB_URI) {
  console.error('❌ FATAL: MONGODB_URI is not set. Add it to your .env file.');
  process.exit(1);
}

if (!process.env.NODE_ENV) {
  console.warn('⚠ NODE_ENV is not set. Running in development mode.');
}

if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS?.trim()) {
  console.error('❌ FATAL: ALLOWED_ORIGINS must be set in production. Add comma-separated list of allowed origins to your environment.');
  process.exit(1);
}

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;

// ── Security headers ──────────────────────────────────────────────────────────
// CSP disabled: the /menu PWA loads product images from Cloudinary (dynamic external URLs)
// and Google Fonts. Configure per-route CSP as a follow-up once all asset origins are known.
// TODO: Enable contentSecurityPolicy with Cloudinary + fonts.googleapis.com allowlist.
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS — restrict to known origins ─────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);

// Public QR menu routes: open to any browser origin (customers scan from any device)
app.use('/api/public', cors({ origin: '*' }));

// All other routes: restrict to allowedOrigins (or allow all if not configured)
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return cb(null, true);
    // If ALLOWED_ORIGINS not configured, allow all
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// Socket.io setup — same origin allowlist as HTTP CORS
const io = new Server(httpServer, {
  cors: {
    origin: (origin, cb) => {
      // Allow requests with no origin (mobile apps, native clients)
      if (!origin) return cb(null, true);
      // If ALLOWED_ORIGINS not configured, allow all (matches HTTP CORS behaviour)
      if (allowedOrigins.length === 0) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Socket.io CORS: origin ${origin} not allowed`));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  maxHttpBufferSize: 1e4, // 10KB max message size
});

app.use(compression()); // gzip responses — reduces JSON payload by ~85%
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));

// Serve customer digital menu PWA
app.use('/menu', express.static(path.join(__dirname, '../public/menu')));

// Serve uploaded product images
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// All limits are per IP. A restaurant's tablets share one public IP, so
// per-IP limits effectively protect per-hotel without needing the auth middleware
// to run before the limiter.
const _rl = (max: number, windowMs: number) => makeRateLimiter({
  windowMs,
  max,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (_req, res) => res.status(429).json({ message: 'Too many requests. Please slow down.' }),
});

// POST /api/orders — 120/min (2 orders/sec burst, generous for any restaurant)
app.use('/api/orders', _rl(120, 60_000));
// Sync endpoints called by every device on cache refresh — 60/min per IP
app.use('/api/products',    _rl(60, 60_000));
app.use('/api/categories',  _rl(60, 60_000));
app.use('/api/settings',    _rl(60, 60_000));
// Device heartbeat — expected every 5 min per device; 12/min handles 6 devices with headroom
app.use('/api/devices/heartbeat', _rl(12, 60_000));
// Public remote-config — 30/min per IP; prevents crash-loop hammering
app.use('/api/remote-config', _rl(30, 60_000));
// Session + guest writes — 60/min per IP (generous for any table-service flow)
app.use('/api/sessions', _rl(60, 60_000));

console.log(
  process.env.NODE_ENV === 'test'
    ? 'Rate limiter skipped (NODE_ENV=test)'
    : 'Rate limiter enabled'
);

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
app.use('/api/public/qr', qrRoutes); // mount before /api/public so paths are matched first
app.use('/api/public', menuRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/waste', wasteRoutes);
app.use('/api/aggregator', aggregatorRoutes);
app.use('/api/ingredients', ingredientRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/remote-config', remoteConfigRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/waiters', waiterRoutes);
app.use('/api/cashiers', cashierRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/print-jobs', printRoutes);

// Enhanced health check — covers MongoDB, Redis, memory, uptime, version
app.get('/api/health', async (_req, res) => {
  const mem = process.memoryUsage();
  const toMB = (b: number) => +(b / 1024 / 1024).toFixed(1);
  const mongoState = mongoose.connection.readyState; // 0=disconnected,1=connected,2=connecting
  const mongoLabel = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoState] ?? 'unknown';
  const redisStatus = await redisHealthCheck();

  const status = mongoState === 1 ? 'OK' : 'DEGRADED';

  res.status(mongoState === 1 ? 200 : 503).json({
    status,
    mongodb: mongoLabel,
    redis: redisStatus,
    uptime: +process.uptime().toFixed(1),
    memory: {
      heapUsedMB: toMB(mem.heapUsed),
      heapTotalMB: toMB(mem.heapTotal),
      rssMB: toMB(mem.rss),
    },
    version: process.env.npm_package_version || '1.0.0',
    nodeVersion: process.version,
    pid: process.pid,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    services: { mongodb: mongoLabel, redis: redisStatus },
  });
});

const escHtml = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

// Public bill view (customer scans QR to see their bill)
app.get('/bill/:orderId', async (_req, res) => {
  try {
    const Order = (await import('./models/Order')).default;
    const order = await Order.findById(_req.params.orderId).lean();
    if (!order) return res.status(404).send('<h2>Bill not found</h2>');
    const cur = '₹';
    const rows = (order.items as any[]).map((i: any) =>
      `<tr><td>${escHtml(i.productName)}</td><td style="text-align:center">${escHtml(i.quantity)}</td><td style="text-align:right">${cur}${Number(i.total).toFixed(0)}</td></tr>`
    ).join('');
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bill - ${escHtml(order.orderNumber)}</title>
<style>body{font-family:Arial,sans-serif;max-width:420px;margin:20px auto;padding:0 16px;background:#FFF6EE}
h2{color:#E8380D;text-align:center;margin-bottom:4px}.sub{text-align:center;color:#7A4F3A;font-size:14px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin-bottom:12px}th{background:#E8380D;color:white;padding:8px;font-size:14px}
td{padding:8px 6px;border-bottom:1px solid #F0D9C8;font-size:14px}.total{font-size:18px;font-weight:800;color:#E8380D;text-align:right;padding:10px 6px}
.token{background:#E8380D;color:white;border-radius:12px;padding:14px;text-align:center;margin-top:16px}
.token-num{font-size:48px;font-weight:900;line-height:1}.thank{color:#7A4F3A;text-align:center;margin-top:12px;font-size:13px}</style></head>
<body><h2>🍽 Dine POS</h2>
<div class="sub">${escHtml(order.orderNumber)} · ${new Date(order.createdAt).toLocaleString('en-IN')}</div>
<table><thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div style="text-align:right;color:#7A4F3A;font-size:14px;padding:4px 6px">Subtotal: ${cur}${order.subtotal.toFixed(0)}</div>
<div style="text-align:right;color:#7A4F3A;font-size:14px;padding:4px 6px">Tax: ${cur}${order.taxTotal.toFixed(0)}</div>
<div class="total">Total: ${cur}${order.grandTotal.toFixed(0)}</div>
${order.tableNumber ? `<div style="text-align:center;color:#7A4F3A;font-size:14px;margin-top:8px">Table: ${escHtml(order.tableNumber)}</div>` : ''}
${(order as any).customerName ? `<div style="text-align:center;color:#7A4F3A;font-size:14px">Name: ${escHtml((order as any).customerName)}</div>` : ''}
<div class="thank">Thank you for dining with us! 🙏</div></body></html>`);
  } catch { res.status(500).send('<h2>Error loading bill</h2>'); }
});

// Privacy policy page
app.get('/privacy-policy', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy – Dine POS</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.7; }
    h1 { color: #E8380D; }
    h2 { color: #1C0800; margin-top: 30px; }
    p, li { font-size: 16px; }
  </style>
</head>
<body>
  <h1>Privacy Policy for Dine POS</h1>
  <p><strong>Last updated: May 2026</strong></p>
  <h2>Introduction</h2>
  <p>Dine POS ("we", "our", or "us") is a Point of Sale application designed for restaurants and hotels. This privacy policy explains how we handle information.</p>
  <h2>Information We Collect</h2>
  <ul>
    <li><strong>Camera:</strong> Used only for scanning product images. No images are stored on external servers.</li>
    <li><strong>Storage:</strong> Used to save app data locally on your device.</li>
    <li><strong>Internet:</strong> Used to connect to your hotel's backend server for order management.</li>
  </ul>
  <h2>How We Use Information</h2>
  <ul>
    <li>All data (orders, products, settings) is stored on your own private server.</li>
    <li>We do not collect, share, or sell any personal data to third parties.</li>
    <li>No analytics or tracking SDKs are used.</li>
  </ul>
  <h2>Data Storage</h2>
  <p>All data is stored on the hotel's own MongoDB database. We have no access to your business data.</p>
  <h2>Contact Us</h2>
  <p>If you have any questions about this Privacy Policy, contact us at: <strong>ledvtech@gmail.com</strong></p>
  <h2>Changes to This Policy</h2>
  <p>We may update this policy. Changes will be posted on this page.</p>
</body>
</html>`);
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
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof err.status === 'number' ? err.status : (typeof err.statusCode === 'number' ? err.statusCode : 500);
  logger.error('Unhandled error', { status, err: err?.message, stack: err?.stack });
  const isClientError = status >= 400 && status < 500;
  res.status(status).json({
    success: false,
    message: isClientError ? (err.message || 'Bad request') : 'Internal server error',
  });
});

// ─── Socket.io authentication middleware ─────────────────────────────────────
// Admin app passes JWT in handshake.auth.token.
// Customer-facing menu connects without a token — allowed but gets no admin privileges.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) return next(); // unauthenticated = customer menu connection
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { hotelId: string };
    socket.data.hotelId = decoded.hotelId;
    socket.data.authenticated = true;
    next();
  } catch {
    // Expired or invalid token — connect as unauthenticated rather than
    // rejecting the socket. Staff/admin devices with stale tokens (e.g. after
    // overnight "remember device") can still receive real-time order events.
    // Room access is controlled by join_hotel below, same as pre-auth behavior.
    return next();
  }
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[SOCKET] Connected | socketId=${socket.id} | authenticated=${!!socket.data.authenticated} | hotelId=${socket.data.hotelId || 'none'}`);

  // Auto-join authenticated admin sockets to their hotel rooms immediately
  if (socket.data.authenticated && socket.data.hotelId) {
    socket.join(`hotel_${socket.data.hotelId}`);
    socket.join(`admin_${socket.data.hotelId}`);
    console.log(`[SOCKET] Auto-joined | socketId=${socket.id} | room=hotel_${socket.data.hotelId}`);
  }

  // join_hotel: admin app calls this on connect (backward-compat + customer fallback)
  socket.on('join_hotel', (hotelId: string) => {
    console.log(`[SOCKET] join_hotel received | socketId=${socket.id} | hotelId=${hotelId} | authenticated=${!!socket.data.authenticated}`);
    if (typeof hotelId !== 'string' || !hotelId) return;

    if (socket.data.authenticated) {
      // Authenticated: JWT must match the claimed hotelId.
      // The socket was already auto-joined to the correct rooms on connection.
      if (socket.data.hotelId !== hotelId) {
        console.log(`[SOCKET] join_hotel REJECTED | socketId=${socket.id} | claimed=${hotelId} | jwt=${socket.data.hotelId}`);
        return;
      }
      // Re-join in case of reconnect after server restart
      socket.join(`hotel_${hotelId}`);
      socket.join(`admin_${hotelId}`);
    } else {
      // Unauthenticated (customer QR / browser): allow hotel_ room only.
      // admin_ room is restricted to authenticated sockets.
      socket.data.hotelId = hotelId;
      socket.join(`hotel_${hotelId}`);
    }

    const roomSize = io.sockets.adapter.rooms.get(`hotel_${hotelId}`)?.size ?? 0;
    console.log(`[SOCKET] Joined room | socketId=${socket.id} | room=hotel_${hotelId} | authenticated=${!!socket.data.authenticated} | clientsInRoom=${roomSize}`);
  });

  // join: customer table room (e.g. socket.emit('join', 'table_5'))
  // No longer adds sockets to a global 'admin' room — scoped rooms only.
  socket.on('join', (room: string) => {
    if (typeof room !== 'string' || !room) return;
    socket.join(room);
  });

  // Customer sends message from the table-side PWA
  socket.on('customer_message', async (data: { hotelId: string; tableNumber: string; message: string }) => {
    try {
      if (!data?.hotelId || !data?.tableNumber || !data?.message) return;
      const msg = await ChatMessage.create({
        hotelId: data.hotelId,
        tableNumber: data.tableNumber,
        sender: 'customer',
        message: String(data.message).substring(0, 500),
      });
      // Emit only to this hotel's admin room — never to other hotels
      io.to(data.tableNumber).to(`admin_${data.hotelId}`).emit('new_message', msg);
    } catch (err) {
      logger.error('Socket customer_message error', { err: String(err) });
    }
  });

  // Admin replies to a table
  socket.on('admin_message', async (data: { hotelId: string; tableNumber: string; message: string }) => {
    try {
      if (!data?.hotelId || !data?.tableNumber || !data?.message) return;
      // Prevent cross-hotel spoofing: authenticated socket must match claimed hotelId
      if (socket.data.authenticated && socket.data.hotelId !== data.hotelId) return;
      const msg = await ChatMessage.create({
        hotelId: data.hotelId,
        tableNumber: data.tableNumber,
        sender: 'admin',
        message: String(data.message).substring(0, 500),
        read: true,
      });
      io.to(data.tableNumber).to(`admin_${data.hotelId}`).emit('new_message', msg);
    } catch (err) {
      logger.error('Socket admin_message error', { err: String(err) });
    }
  });

  // register_printer: printer device registers itself after login.
  // Upserts the PrinterDevice record so dispatches go only to this socket.
  // Registration counts as the first heartbeat — lastHeartbeat is set here.
  socket.on('register_printer', async (data: { deviceId?: string; printerRole?: string; printerName?: string }) => {
    try {
      const hotelId = socket.data.hotelId;
      if (!hotelId || !socket.data.authenticated) return;
      if (!data?.deviceId || !['kitchen', 'cashier'].includes(data.printerRole || '')) return;

      const now = new Date();
      await PrinterDevice.findOneAndUpdate(
        { hotelId: new mongoose.Types.ObjectId(hotelId), printerRole: data.printerRole },
        {
          $set: {
            deviceId:      String(data.deviceId).slice(0, 100),
            printerName:   data.printerName ? String(data.printerName).slice(0, 100) : null,
            socketId:      socket.id,
            connectedAt:   now,
            lastSeen:      now,
            lastHeartbeat: now,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      logger.info('Printer registered', {
        hotelId,
        printerRole:  data.printerRole,
        printerName:  data.printerName,
        socketId:     socket.id,
        deviceId:     data.deviceId,
      });
    } catch (err) {
      logger.error('register_printer error', { err: String(err) });
    }
  });

  // printer_heartbeat: mobile sends every 30 s to confirm the device is alive.
  // Dispatch checks lastHeartbeat age; jobs stay pending if > 60 s stale.
  socket.on('printer_heartbeat', async () => {
    try {
      const now = new Date();
      await PrinterDevice.findOneAndUpdate(
        { socketId: socket.id },
        { $set: { lastHeartbeat: now, lastSeen: now } },
      );
    } catch { /* non-critical */ }
  });

  socket.on('disconnect', async (reason) => {
    console.log(`[SOCKET] Disconnected | socketId=${socket.id} | reason=${reason}`);
    // Clear printer registration so pending-dispatch knows the device is offline
    try {
      await PrinterDevice.findOneAndUpdate(
        { socketId: socket.id },
        { $set: { socketId: null } },
      );
    } catch { /* non-critical */ }
  });

  socket.on('error', (err) => {
    logger.error('Socket error', { err: String(err) });
  });
});

// Export io for use in routes if needed
export { io };

// ── Process-level crash guards ────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { err: String(err) });
  setTimeout(() => process.exit(1), 1000);
});

// ── Graceful shutdown (Render/Docker SIGTERM) ─────────────────────────────────
const shutdown = () => {
  logger.info('Graceful shutdown initiated');

  // Stop accepting new connections; in-flight requests drain normally
  httpServer.close(async () => {
    try {
      // 1. Close Socket.IO (gracefully disconnects all clients)
      await new Promise<void>(resolve => io.close(() => resolve()));
      // 2. Close Redis
      await closeRedis();
      // 3. Close MongoDB
      await mongoose.connection.close();
      logger.info('Shutdown complete');
    } catch (e) {
      logger.error('Error during shutdown', { err: String(e) });
    }
    process.exit(0);
  });

  // Force exit after 30s if graceful close hangs
  setTimeout(() => {
    logger.error('Force shutdown after 30s timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Connect to MongoDB + Redis, then start server
(async () => {
  try {
    await connectDB();
    await connectRedis();

    // Attach Redis adapter to Socket.IO if Redis is available
    const redisClient = getRedisClient();
    if (redisClient) {
      const pubClient = redisClient;
      const subClient = pubClient.duplicate();
      io.adapter(createAdapter(pubClient, subClient));
      logger.info('Socket.IO using Redis adapter');
    } else {
      logger.info('Socket.IO using in-memory adapter');
    }

    httpServer.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📡 API Base: http://localhost:${PORT}/api`);
      console.log(`📱 Customer Menu: http://localhost:${PORT}/menu`);
      console.log(`💬 Chat: Socket.io ready`);
    });
  } catch (err) {
    logger.error('Failed to start server', { err: String(err) });
    process.exit(1);
  }
})();

export default app;
