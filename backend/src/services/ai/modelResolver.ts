import https from 'https';

// Ordered from most to least preferred for API keys restricted from gemini-2.5-flash.
const PREFERENCE = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

let _resolved: string | null = null;
let _promise: Promise<string> | null = null;

function listModels(apiKey: string): Promise<string[]> {
  return new Promise(resolve => {
    const url = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
    https.get(url, res => {
      let body = '';
      res.on('data', (c: Buffer) => { body += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body) as {
            models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
          };
          resolve(
            (json.models ?? [])
              .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
              .map(m => m.name),
          );
        } catch {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

function pickModel(available: string[]): { model: string; reason: string } {
  const has25Flash = available.some(m => m.includes('gemini-2.5-flash'));
  if (has25Flash) {
    return { model: 'gemini-2.5-flash', reason: 'gemini-2.5-flash available and selected' };
  }

  for (const pref of PREFERENCE) {
    if (available.some(m => m.includes(pref))) {
      return {
        model: pref,
        reason: `gemini-2.5-flash not in available list (new-user API key restriction); selected next best: ${pref}`,
      };
    }
  }

  const fallback = available.find(m => m.includes('gemini') && !m.includes('nano'));
  if (fallback) {
    const name = fallback.replace('models/', '');
    return { model: name, reason: `gemini-2.5-flash unavailable; first listed Gemini model selected: ${name}` };
  }

  return {
    model: 'gemini-1.5-flash',
    reason: 'Could not fetch model list — using gemini-1.5-flash as last-resort fallback',
  };
}

/**
 * Resolves the best available Gemini model for this API key.
 * Respects GEMINI_MODEL env override. Result is cached for the process lifetime.
 */
export async function resolveGeminiModel(apiKey: string): Promise<string> {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  if (_resolved) return _resolved;

  if (!_promise) {
    _promise = (async () => {
      const available = await listModels(apiKey);

      console.log('[Gemini] Available models for this API key (generateContent, v1):');
      if (available.length === 0) {
        console.log('  (none listed — check API key validity or quota)');
      } else {
        available.forEach(m => console.log('  -', m));
      }

      const has25Flash = available.some(m => m.includes('gemini-2.5-flash'));
      if (!has25Flash) {
        console.log('[Gemini] gemini-2.5-flash REJECTED: not in available models list for this API key (new-user restriction)');
      }

      const { model, reason } = pickModel(available);
      console.log(`[Gemini] Selected model: ${model}`);
      console.log(`[Gemini] Reason: ${reason}`);

      _resolved = model;
      return model;
    })();
  }

  return _promise;
}
