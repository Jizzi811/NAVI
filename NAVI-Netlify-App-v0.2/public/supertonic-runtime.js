import * as ort from 'onnxruntime-web';
import * as upstream from 'https://cdn.jsdelivr.net/gh/supertone-inc/supertonic@dff55dc00064c398736080c78195f577527832ae/web/helper.js';

const ORT_VERSION = '1.27.0';

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
    return await upstream.loadTextToSpeech(...args);
  } catch (error) {
    reportRuntimeError('Modell-Ladefehler', error);
    throw error;
  }
}

export async function loadVoiceStyle(...args) {
  try {
    return await upstream.loadVoiceStyle(...args);
  } catch (error) {
    reportRuntimeError('Stimmen-Ladefehler', error);
    throw error;
  }
}

export const writeWavFile = upstream.writeWavFile;
