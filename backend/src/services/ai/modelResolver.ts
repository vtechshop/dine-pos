import https from 'https';

// Preference order: newest production Flash first, oldest last.
// gemini-2.5-flash is kept in the list but ranked below 2.5-flash-lite because
// the generateContent v1 endpoint returns 404 "no longer available to new users"
// for some API keys even though the models discovery API lists it as available.
// If it fails at call time, callers should fall back via GEMINI_MODEL override.
const PREFERENCE = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
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
  // Walk the preference list and return the first model present in the available set.
  for (const pref of PREFERENCE) {
    if (available.some(m => m.includes(pref))) {
      return { model: pref, reason: `selected from preference list: ${pref}` };
    }
  }

  // No preference matched — pick the first listed Gemini model (excluding nano/image variants).
  const fallback = available.find(
    m => m.includes('gemini') && !m.includes('nano') && !m.includes('-image'),
  );
  if (fallback) {
    const name = fallback.replace('models/', '');
    return { model: name, reason: `no preferred model available; first listed: ${name}` };
  }

  // models list was empty or returned no usable model — surface the error at call time.
  return {
    model: '',
    reason: 'model list empty or no usable Gemini model found; set GEMINI_MODEL to override',
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

      const { model, reason } = pickModel(available);
      console.log(`[Gemini] Selected model: ${model}`);
      console.log(`[Gemini] Reason: ${reason}`);

      _resolved = model;
      return model;
    })();
  }

  return _promise;
}
