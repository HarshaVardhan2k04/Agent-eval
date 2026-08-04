// Forwards STT work to the Python engine. Audio is streamed through as multipart
// and never persisted here — the engine returns transcript + metrics, we store that.
const { engineUrl } = require('../config/app');

async function transcribe({ buffer, filename, reference, language, provider, diarize }) {
  const form = new FormData();
  form.append('audio', new Blob([buffer]), filename || 'audio');
  form.append('reference', reference || '');
  form.append('language', language || 'en');
  if (provider) form.append('provider', provider);
  form.append('diarize', String(!!diarize));

  const res = await fetch(`${engineUrl}/api/stt/transcribe`, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Engine STT error: ${res.status} ${text}`);
  }
  return res.json();
}

// Transcribe a recording into Agent/User-labelled turns (for Call Analysis).
async function transcribeTurns({ buffer, filename, language }) {
  const form = new FormData();
  form.append('audio', new Blob([buffer]), filename || 'audio');
  form.append('language', language || 'auto');
  const res = await fetch(`${engineUrl}/api/stt/turns`, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Engine STT error: ${res.status} ${text}`);
  }
  return res.json();
}

async function providers() {
  const res = await fetch(`${engineUrl}/api/stt/providers`);
  if (!res.ok) throw new Error(`Engine STT error: ${res.status}`);
  return res.json();
}

// Preset noise environments the engine can mix in: { noises:[{key,label,filename}], levels:[...] }.
async function listNoises() {
  const res = await fetch(`${engineUrl}/api/stt/noises`);
  if (!res.ok) throw new Error(`Engine STT error: ${res.status}`);
  return res.json();
}

// Mix a noise (preset key OR uploaded file) into the recording at `level`, transcribe
// the noisy audio, score vs `reference`. Returns the score result plus `noise` (label),
// `level`, and `merged_audio_b64` (base64 WAV of the mixed audio).
async function noiseTranscribe({ buffer, filename, reference, language, level, noisePreset, noiseBuffer, noiseFilename }) {
  const form = new FormData();
  form.append('audio', new Blob([buffer]), filename || 'audio');
  form.append('reference', reference || '');
  form.append('language', language || 'auto');
  form.append('level', level || 'medium');
  if (noisePreset) {
    form.append('noise_preset', noisePreset);
  } else {
    form.append('noise', new Blob([noiseBuffer]), noiseFilename || 'noise');
  }

  const res = await fetch(`${engineUrl}/api/stt/noise-transcribe`, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Engine STT error: ${res.status} ${text}`);
  }
  return res.json();
}

module.exports = { transcribe, transcribeTurns, providers, listNoises, noiseTranscribe };
