import * as ort from 'onnxruntime-web';
import * as upstream from 'https://cdn.jsdelivr.net/gh/supertone-inc/supertonic@dff55dc00064c398736080c78195f577527832ae/web/helper.js';

const ORT_VERSION = '1.27.0';
const FIXED_VOICE_FILE = 'M5.json';
const FIXED_STEPS = 8;
const FIXED_SPEED = 0.92;

// ONNX Runtime requires its JavaScript bundle and WASM binaries to come from
// the exact same release. Keep the runtime single-threaded so it also works
// without cross-origin isolation on normal Netlify pages.
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

function reportRuntimeError(stage, error) {
  const detail = error?.message || String(error || 'Unbekannter Fehler');
  console.error(`Supertonic ${stage} fehlgeschlagen:`, error);
  setTimeout(() => {
    const status = document.getElementById('voiceStatus');
    if (!status) return;
    status.textContent = `${stage}: ${detail}`.slice(0, 180);
    status.title = detail;
    status.dataset.state = 'error';
  }, 0);
}

export async function loadTextToSpeech(...args) {
  try {
    const result = await upstream.loadTextToSpeech(...args);
    const originalCall = result.textToSpeech.call.bind(result.textToSpeech);

    // NAVI always uses the same calm voice profile. Ignore varying settings
    // from older app versions so the voice remains consistent on every device.
    result.textToSpeech.call = (
      text,
      lang,
      style,
      _totalStep,
      _speed,
      silenceDuration = 0.22,
      progressCallback = null,
    ) => originalCall(
      text,
      lang,
      style,
      FIXED_STEPS,
      FIXED_SPEED,
      silenceDuration,
      progressCallback,
    );

    return result;
  } catch (error) {
    reportRuntimeError('Modell-Ladefehler', error);
    throw error;
  }
}

export async function loadVoiceStyle(paths, ...rest) {
  try {
    const fixedPaths = Array.isArray(paths)
      ? paths.map((path) => String(path).replace(/[^/]+\.json$/, FIXED_VOICE_FILE))
      : paths;
    return await upstream.loadVoiceStyle(fixedPaths, ...rest);
  } catch (error) {
    reportRuntimeError('Stimmen-Ladefehler', error);
    throw error;
  }
}

export const writeWavFile = upstream.writeWavFile;
