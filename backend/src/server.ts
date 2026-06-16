import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
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
import tableRoutes from './routes/tableRoutes';
import reservationRoutes from './routes/reservationRoutes';
import expenseRoutes from './routes/expenseRoutes';
import wasteRoutes from './routes/wasteRoutes';
import aggregatorRoutes from './routes/aggregatorRoutes';
import ingredientRoutes from './routes/ingredientRoutes';

dotenv.config();

// ── Validate required env vars at startup ─────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'hotelbillingpos_secret_key_change_in_production') {
  console.error('❌ FATAL: JWT_SECRET is not set or is using the default insecure value. Set a strong secret in .env');
  process.exit(1);
}

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;

// ── CORS — restrict to known origins ─────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin || allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// Socket.io setup
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e4, // 10KB max message size
});

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
app.use('/api/public', menuRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/waste', wasteRoutes);
app.use('/api/aggregator', aggregatorRoutes);
app.use('/api/ingredients', ingredientRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Public bill view (customer scans QR to see their bill)
app.get('/bill/:orderId', async (_req, res) => {
  try {
    const Order = (await import('./models/Order')).default;
    const order = await Order.findById(_req.params.orderId).lean();
    if (!order) return res.status(404).send('<h2>Bill not found</h2>');
    const cur = '₹';
    const rows = (order.items as any[]).map((i: any) =>
      `<tr><td>${i.productName}</td><td style="text-align:center">${i.quantity}</td><td style="text-align:right">${cur}${i.total.toFixed(0)}</td></tr>`
    ).join('');
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bill - ${order.orderNumber}</title>
<style>body{font-family:Arial,sans-serif;max-width:420px;margin:20px auto;padding:0 16px;background:#FFF6EE}
h2{color:#E8380D;text-align:center;margin-bottom:4px}.sub{text-align:center;color:#7A4F3A;font-size:14px;margin-bottom:16px}
table{width:100%;border-collapse:collapse;margin-bottom:12px}th{background:#E8380D;color:white;padding:8px;font-size:14px}
td{padding:8px 6px;border-bottom:1px solid #F0D9C8;font-size:14px}.total{font-size:18px;font-weight:800;color:#E8380D;text-align:right;padding:10px 6px}
.token{background:#E8380D;color:white;border-radius:12px;padding:14px;text-align:center;margin-top:16px}
.token-num{font-size:48px;font-weight:900;line-height:1}.thank{color:#7A4F3A;text-align:center;margin-top:12px;font-size:13px}</style></head>
<body><h2>🍽 Dine POS</h2>
<div class="sub">${order.orderNumber} · ${new Date(order.createdAt).toLocaleString('en-IN')}</div>
<table><thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div style="text-align:right;color:#7A4F3A;font-size:14px;padding:4px 6px">Subtotal: ${cur}${order.subtotal.toFixed(0)}</div>
<div style="text-align:right;color:#7A4F3A;font-size:14px;padding:4px 6px">Tax: ${cur}${order.taxTotal.toFixed(0)}</div>
<div class="total">Total: ${cur}${order.grandTotal.toFixed(0)}</div>
${order.tableNumber ? `<div style="text-align:center;color:#7A4F3A;font-size:14px;margin-top:8px">Table: ${order.tableNumber}</div>` : ''}
${(order as any).customerName ? `<div style="text-align:center;color:#7A4F3A;font-size:14px">Name: ${(order as any).customerName}</div>` : ''}
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
  socket.on('customer_message', async (data: { hotelId: string; tableNumber: string; message: string }) => {
    try {
      if (!data?.hotelId || !data?.tableNumber || !data?.message) return;
      const msg = await ChatMessage.create({
        hotelId: data.hotelId,
        tableNumber: data.tableNumber,
        sender: 'customer',
        message: String(data.message).substring(0, 500),
      });
      io.to(data.tableNumber).to('admin').emit('new_message', msg);
    } catch (err) {
      console.error('Chat error:', err);
    }
  });

  // Admin replies to a table
  socket.on('admin_message', async (data: { hotelId: string; tableNumber: string; message: string }) => {
    try {
      if (!data?.hotelId || !data?.tableNumber || !data?.message) return;
      const msg = await ChatMessage.create({
        hotelId: data.hotelId,
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
  setTimeout(() => process.exit(1), 1000);
});

// ── Graceful shutdown (Render/Docker SIGTERM) ─────────────────────────────────
const shutdown = () => {
  console.log('⚠️  Shutting down gracefully...');
  httpServer.close(async () => {
    try {
      await mongoose.connection.close();
      console.log('✅ MongoDB connection closed');
    } catch (e) {
      console.error('Error closing MongoDB:', e);
    }
    process.exit(0);
  });
  // Force exit after 30s if graceful close hangs
  setTimeout(() => { console.error('⛔ Force shutdown after timeout'); process.exit(1); }, 30000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

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
