const ORT_VERSION = '1.27.0';
const ORT_MODULE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.webgpu.min.mjs`;
const ORT_WASM_DIR = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const HELPER_SOURCE = 'https://cdn.jsdelivr.net/gh/supertone-inc/supertonic@dff55dc00064c398736080c78195f577527832ae/web/helper.js';
const ONNX_DIR = 'https://huggingface.co/Supertone/supertonic-3/resolve/main/onnx';
const VOICE_STYLE = 'https://huggingface.co/Supertone/supertonic-3/resolve/main/voice_styles/M5.json';

let helper = null;
let textToSpeech = null;
let fixedStyle = null;
let backend = '';
let initPromise = null;
let generationQueue = Promise.resolve();

function post(type, payload = {}, transfer = []) {
  self.postMessage({ type, ...payload }, transfer);
}

async function loadPatchedHelper() {
  if (helper) return helper;

  post('progress', { message: 'Sprachmodul wird vorbereitet …' });
  const response = await fetch(HELPER_SOURCE, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Sprachmodul HTTP ${response.status}`);

  const source = await response.text();
  const importPattern = /import\s+\*\s+as\s+ort\s+from\s+['"]onnxruntime-web['"]\s*;/;
  if (!importPattern.test(source)) throw new Error('ONNX-Import im Sprachmodul nicht gefunden');

  const replacement = [
    `import * as ort from '${ORT_MODULE}';`,
    `ort.env.wasm.wasmPaths = '${ORT_WASM_DIR}';`,
    'ort.env.wasm.numThreads = 1;',
    'ort.env.wasm.proxy = false;',
  ].join('\n');

  const blobUrl = URL.createObjectURL(
    new Blob([source.replace(importPattern, replacement)], { type: 'text/javascript' }),
  );

  try {
    helper = await import(blobUrl);
    return helper;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

async function createTts(executionProvider) {
  return helper.loadTextToSpeech(
    ONNX_DIR,
    {
      executionProviders: [executionProvider],
      graphOptimizationLevel: 'all',
    },
    (modelName, current, total) => {
      post('progress', { message: `Stimme lädt ${current}/${total}: ${modelName}` });
    },
  );
}

async function initialize() {
  if (textToSpeech && fixedStyle) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    helper = await loadPatchedHelper();
    let result = null;
    let webgpuError = null;

    if (self.navigator.gpu) {
      try {
        post('progress', { message: 'WebGPU-Stimme wird vorbereitet …' });
        result = await createTts('webgpu');
        backend = 'WebGPU';
      } catch (error) {
        webgpuError = error;
        console.warn('WebGPU fehlgeschlagen, verwende WebAssembly.', error);
      }
    }

    if (!result) {
      post('progress', { message: 'WebAssembly-Stimme wird vorbereitet …' });
      try {
        result = await createTts('wasm');
        backend = 'WebAssembly';
      } catch (error) {
        if (webgpuError) console.warn('Vorheriger WebGPU-Fehler:', webgpuError);
        throw error;
      }
    }

    textToSpeech = result.textToSpeech;
    post('progress', { message: 'Warme M5-Stimme wird geladen …' });
    fixedStyle = await helper.loadVoiceStyle([VOICE_STYLE]);
    post('ready', { backend });
  })().catch((error) => {
    initPromise = null;
    throw error;
  });

  return initPromise;
}

async function generateSpeech(id, text) {
  try {
    await initialize();
    post('progress', { message: 'NAVI erzeugt Sprache …' });

    const { wav, duration } = await textToSpeech.call(
      text,
      'de',
      fixedStyle,
      8,
      0.92,
      0.22,
    );

    const wavLength = Math.floor(textToSpeech.sampleRate * duration[0]);
    const buffer = helper.writeWavFile(
      wav.slice(0, wavLength),
      textToSpeech.sampleRate,
    );
    post('audio', { id, buffer }, [buffer]);
  } catch (error) {
    post('error', { id, detail: error?.message || String(error) });
  }
}

self.onmessage = ({ data }) => {
  if (!data || typeof data !== 'object') return;

  if (data.type === 'init') {
    initialize().catch((error) => {
      post('error', { detail: error?.message || String(error) });
    });
    return;
  }

  if (data.type === 'speak' && typeof data.text === 'string') {
    generationQueue = generationQueue.then(() => generateSpeech(data.id, data.text));
  }
};
