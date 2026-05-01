import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  hotelId?: string;
  hotelName?: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'hotelbillingpos_secret_key_change_in_production';

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Authentication required. Please login.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { hotelId: string; hotelName: string };
    req.hotelId = decoded.hotelId;
    req.hotelName = decoded.hotelName;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired session. Please login again.' });
  }
};

export const generateToken = (hotelId: string, hotelName: string): string => {
  return jwt.sign({ hotelId, hotelName }, JWT_SECRET, { expiresIn: '30d' });
};
