import { Express, RequestHandler } from 'express';
import tallyRoutes from './tallyRoutes';
import tallyConnectorRoutes from './tallyConnectorRoutes';

// Mount order matters. tallyRoutes applies router-level authMiddleware +
// requireAdmin to EVERYTHING under /api/integrations/tally — including
// /connector/* if it is mounted first. The connector authenticates with its own
// bearer token (not a JWT), so it was always rejected with 401 "Invalid or
// expired session" and the Tally Bridge could never log in.
// The connector router must be mounted BEFORE the admin router.
export function mountTallyRoutes(app: Express, connectorLimiter?: RequestHandler): void {
  if (connectorLimiter) app.use('/api/integrations/tally/connector', connectorLimiter);
  app.use('/api/integrations/tally/connector', tallyConnectorRoutes);
  app.use('/api/integrations/tally',           tallyRoutes);
}
