import { Router, Request, Response } from 'express';
import https from 'https';
import http from 'http';

const router = Router();

// Helper: HTTP GET fetch
const fetchJson = (url: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON response')); }
      });
    }).on('error', reject);
  });
};

// ── IFSC verification (Razorpay free API) ─────────────────────────────────
router.get('/ifsc/:ifsc', async (req: Request, res: Response) => {
  const { ifsc } = req.params;

  // Format check first
  const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  if (!ifscRegex.test(ifsc.toUpperCase())) {
    return res.status(400).json({ valid: false, message: 'Invalid IFSC format' });
  }

  try {
    const data = await fetchJson(`https://ifsc.razorpay.com/${ifsc.toUpperCase()}`);
    if (data && data.BANK) {
      return res.json({
        valid: true,
        bank: data.BANK,
        branch: data.BRANCH,
        city: data.CITY,
        state: data.STATE,
        ifsc: data.IFSC,
      });
    }
    return res.status(404).json({ valid: false, message: 'IFSC not found' });
  } catch {
    return res.status(500).json({ valid: false, message: 'Verification failed. Check IFSC.' });
  }
});

// ── Pincode verification (India Post free API) ─────────────────────────────
router.get('/pincode/:pincode', async (req: Request, res: Response) => {
  const { pincode } = req.params;

  if (!/^\d{6}$/.test(pincode)) {
    return res.status(400).json({ valid: false, message: 'Invalid pincode format' });
  }

  try {
    const data = await fetchJson(`https://api.postalpincode.in/pincode/${pincode}`);
    if (data && data[0]?.Status === 'Success' && data[0]?.PostOffice?.length > 0) {
      const po = data[0].PostOffice[0];
      return res.json({
        valid: true,
        city: po.District,
        state: po.State,
        postOffice: po.Name,
      });
    }
    return res.status(404).json({ valid: false, message: 'Pincode not found' });
  } catch {
    return res.status(500).json({ valid: false, message: 'Pincode verification failed' });
  }
});

// ── PAN format validation ─────────────────────────────────────────────────
router.post('/pan', (req: Request, res: Response) => {
  const { pan } = req.body;
  if (!pan) return res.status(400).json({ valid: false, message: 'PAN required' });

  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  const upper = pan.toUpperCase().trim();

  if (panRegex.test(upper)) {
    // Decode PAN type from 4th letter
    const types: Record<string, string> = {
      P: 'Individual', C: 'Company', H: 'HUF',
      F: 'Firm', A: 'AOP', T: 'Trust', B: 'BOI',
    };
    const holderType = types[upper[3]] || 'Other';
    return res.json({ valid: true, pan: upper, holderType });
  }

  return res.status(400).json({ valid: false, message: 'Invalid PAN format. Must be like ABCDE1234F' });
});

// ── GST format validation ──────────────────────────────────────────────────
router.post('/gst', (req: Request, res: Response) => {
  const { gst } = req.body;
  if (!gst) return res.status(400).json({ valid: false, message: 'GST number required' });

  const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  const upper = gst.toUpperCase().trim();

  if (gstRegex.test(upper)) {
    const stateCode = parseInt(upper.substring(0, 2));
    const states: Record<number, string> = {
      1: 'Jammu & Kashmir', 2: 'Himachal Pradesh', 3: 'Punjab',
      4: 'Chandigarh', 5: 'Uttarakhand', 6: 'Haryana', 7: 'Delhi',
      8: 'Rajasthan', 9: 'Uttar Pradesh', 10: 'Bihar', 11: 'Sikkim',
      12: 'Arunachal Pradesh', 13: 'Nagaland', 14: 'Manipur',
      15: 'Mizoram', 16: 'Tripura', 17: 'Meghalaya', 18: 'Assam',
      19: 'West Bengal', 20: 'Jharkhand', 21: 'Odisha', 22: 'Chhattisgarh',
      23: 'Madhya Pradesh', 24: 'Gujarat', 26: 'Dadra & Nagar Haveli',
      27: 'Maharashtra', 28: 'Andhra Pradesh (old)', 29: 'Karnataka',
      30: 'Goa', 31: 'Lakshadweep', 32: 'Kerala', 33: 'Tamil Nadu',
      34: 'Puducherry', 35: 'Andaman & Nicobar', 36: 'Telangana',
      37: 'Andhra Pradesh',
    };
    return res.json({
      valid: true,
      gst: upper,
      state: states[stateCode] || 'Unknown State',
      panInGst: upper.substring(2, 12),
    });
  }

  return res.status(400).json({ valid: false, message: 'Invalid GST format' });
});

// ── FSSAI format validation ────────────────────────────────────────────────
router.post('/fssai', (req: Request, res: Response) => {
  const { fssai } = req.body;
  if (!fssai) return res.status(400).json({ valid: false, message: 'FSSAI number required' });

  const trimmed = fssai.trim();
  if (!/^\d{14}$/.test(trimmed)) {
    return res.status(400).json({ valid: false, message: 'FSSAI must be exactly 14 digits' });
  }

  // Decode state from first 2 digits
  const stateCode = parseInt(trimmed.substring(0, 2));
  const states: Record<number, string> = {
    11: 'Delhi', 12: 'Haryana', 13: 'Punjab', 14: 'Himachal Pradesh',
    15: 'Chandigarh', 21: 'Uttar Pradesh', 22: 'Uttarakhand',
    31: 'Rajasthan', 32: 'Gujarat', 33: 'Maharashtra', 34: 'Goa',
    41: 'Madhya Pradesh', 42: 'Chhattisgarh', 43: 'Bihar', 44: 'Jharkhand',
    51: 'West Bengal', 52: 'Odisha', 53: 'Assam', 54: 'Manipur',
    55: 'Meghalaya', 56: 'Mizoram', 57: 'Nagaland', 58: 'Tripura',
    59: 'Arunachal Pradesh', 60: 'Sikkim', 61: 'Andaman & Nicobar',
    71: 'Tamil Nadu', 72: 'Kerala', 73: 'Karnataka', 74: 'Andhra Pradesh',
    75: 'Telangana', 76: 'Puducherry', 77: 'Lakshadweep',
  };

  return res.json({
    valid: true,
    fssai: trimmed,
    state: states[stateCode] || 'Unknown State',
    licenseType: trimmed[2] === '1' ? 'Basic Registration' :
                 trimmed[2] === '2' ? 'State License' : 'Central License',
  });
});

export default router;
