// Generates a "ding-ding" restaurant bell WAV for new order alerts
const fs = require('fs');
const path = require('path');

const sampleRate = 22050;
const totalDuration = 1.6;
const numSamples = Math.floor(sampleRate * totalDuration);
const dataSize = numSamples * 2;
const buf = Buffer.alloc(44 + dataSize);

// WAV header
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + dataSize, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);        // PCM
buf.writeUInt16LE(1, 22);        // mono
buf.writeUInt32LE(sampleRate, 24);
buf.writeUInt32LE(sampleRate * 2, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(dataSize, 40);

// Bell synthesis: fundamental + 2 partials with exponential decay
function writeBell(startSample, freq, durationSec, amplitude) {
  const n = Math.floor(sampleRate * durationSec);
  for (let i = 0; i < n; i++) {
    const si = startSample + i;
    if (si >= numSamples) break;
    const t = i / sampleRate;
    const decay = Math.exp(-5.5 * t);
    const wave =
      Math.sin(2 * Math.PI * freq * t) * 0.65 +
      Math.sin(2 * Math.PI * freq * 2.756 * t) * 0.25 +   // slightly inharmonic partial
      Math.sin(2 * Math.PI * freq * 5.4 * t) * 0.10;
    const sample = Math.round(wave * decay * amplitude * 32767);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, sample)), 44 + si * 2);
  }
}

// Ding 1 — C6 (1047 Hz)
writeBell(0, 1047, 0.75, 0.85);
// Ding 2 — E6 (1319 Hz) after 0.55s — ascending interval feels like an alert
writeBell(Math.floor(sampleRate * 0.55), 1319, 0.75, 0.85);

const outPath = path.join(
  __dirname,
  'mobile', 'android', 'app', 'src', 'main', 'res', 'raw',
  'order_alert.wav'
);
fs.writeFileSync(outPath, buf);
console.log('Generated:', outPath, `(${buf.length} bytes)`);
