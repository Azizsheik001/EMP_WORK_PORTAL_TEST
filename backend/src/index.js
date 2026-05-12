import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import clientsRoutes from './routes/clients.js';
import departmentsRoutes from './routes/departments.js';
import assignmentsRoutes from './routes/assignments.js';
import leaveRoutes from './routes/leave-requests.js';
import schedulesRoutes from './routes/schedules.js';
import shiftsRoutes from './routes/shifts.js';
import assetsRoutes from './routes/assets.js';
import assistantRoutes from './routes/assistant.js';
import celebrationsRoutes from './routes/celebrations.js';
import allowancesRoutes from './routes/allowances.js';
import budgetingRoutes from './routes/budgeting.js';
import shiftChangesRoutes from './routes/shift-changes.js';
import reportsRoutes from './routes/reports.js';
import dinnersRoutes from './routes/dinners.js';
import ideasRoutes from './routes/ideas.js';
import holidaysRoutes from './routes/holidays.js';
import shiftCodesRoutes from './routes/shift-codes.js';
import notificationsRoutes from './routes/notifications.js';
import ndaRoutes from './routes/nda.js';
import pendingChangesRoutes from './routes/pending-changes.js';
import { errorHandler } from './middleware/error.js';

const app = express();
const PORT = process.env.PORT || 3000;

// CORS — allow frontend origins (dev localhost + production Vercel URLs)
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return cb(null, true);
    // Allow listed origins
    if (allowedOrigins.includes(origin)) return cb(null, true);
    // Allow any Vercel preview/production URL for this project
    if (origin.endsWith('.vercel.app')) return cb(null, true);
    cb(null, allowedOrigins[0]);
  },
  credentials: true,
}));

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/departments', departmentsRoutes);
app.use('/api/assignments', assignmentsRoutes);
app.use('/api/leave-requests', leaveRoutes);
app.use('/api/schedules', schedulesRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/celebrations', celebrationsRoutes);
app.use('/api/allowances', allowancesRoutes);
app.use('/api/budgeting', budgetingRoutes);
app.use('/api/shift-changes', shiftChangesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/dinners', dinnersRoutes);
app.use('/api/ideas', ideasRoutes);
app.use('/api/holidays', holidaysRoutes);
app.use('/api/shift-codes', shiftCodesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/nda', ndaRoutes);
app.use('/api/pending-changes', pendingChangesRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// In production, serve the frontend static build (optional single-service deploy)
if (process.env.NODE_ENV === 'production' && process.env.SERVE_STATIC !== 'false') {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const distPath = join(__dirname, '../../dist');
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(distPath, 'index.html'));
  });
}

// 404 handler for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

// Start server when not on Vercel
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AGS Workforce API running on http://localhost:${PORT}`);
  });
}

// Export for Vercel serverless
export default app;