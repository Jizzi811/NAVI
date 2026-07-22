import * as ort from 'onnxruntime-web';

const ORT_VERSION = '1.27.0';

// ONNX Runtime requires its JavaScript bundle and WASM binaries to come from
// the exact same release. The previous esm.sh bundle could not reliably find
// those binaries after deployment on Netlify.
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

export * from 'https://cdn.jsdelivr.net/gh/supertone-inc/supertonic@dff55dc00064c398736080c78195f577527832ae/web/helper.js';
