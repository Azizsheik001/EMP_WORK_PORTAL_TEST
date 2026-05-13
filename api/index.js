// Vercel Serverless Function entry point
// This file bridges the root /api folder (Vercel's expected location) to our Express app

import app from '../backend/src/index.js';

export default app;
