const SUPERTONIC_MODULE = 'https://esm.sh/gh/supertone-inc/supertonic@dff55dc00064c398736080c78195f577527832ae/web/helper.js?bundle';
const SUPERTONIC_ONNX = 'https://huggingface.co/Supertone/supertonic-3/resolve/main/onnx';
const SUPERTONIC_VOICES = 'https://huggingface.co/Supertone/supertonic-3/resolve/main/voice_styles';
const FIXED_VOICE = 'F2';
const FIXED_VOICE_LABEL = 'NAVI-Stimme';

let mode = 'listen';
let history = [];
let voiceEnabled = localStorage.naviVoice !== 'off';
let audioCtx;
let supertonic = null;
let textToSpeech = null;
let fixedStyle = null;
let ttsInitPromise = null;
let ttsState = 'idle';
let ttsBackend = '';
let currentAudio = null;
let currentAudioUrl = null;
let speechToken = 0;

const titles = {
  listen: 'NAVI hört dir zu',
  sort: 'Wir sortieren gemeinsam',
  calm: 'NAVI bleibt bei dir',
  plan: 'Ein kleiner nächster Schritt',
};

const starters = {
  listen: 'Du kannst einfach anfangen. Was liegt dir gerade auf dem Herzen?',
  sort: 'Wir müssen nicht alles gleichzeitig lösen. Was ist gerade der lauteste Gedanke?',
  calm: 'Ich bin hier. Spür einmal den Boden unter deinen Füßen – was macht dein Körper gerade?',
  plan: 'Okay, wir suchen nur einen machbaren Schritt. Worum geht es gerade?',
};

const $ = (selector) => document.querySelector(selector);
const messages = $('#messages');
const input = $('#input');
const orb = $('#orb');
const voiceButton = $('#sound');
const voiceStatus = $('#voiceStatus');
const stopVoiceButton = $('#stopVoice');

function setVoiceStatus(text, state = '') {
  voiceStatus.textContent = text;
  voiceStatus.dataset.state = state;
}

function updateVoiceUi() {
  voiceButton.textContent = voiceEnabled ? '🔊' : '🔇';
  voiceButton.classList.toggle('active', voiceEnabled);
  voiceButton.setAttribute('aria-label', voiceEnabled ? 'NAVI-Stimme ausschalten' : 'NAVI-Stimme einschalten');
  stopVoiceButton.disabled = !voiceEnabled;

  if (!voiceEnabled) {
    setVoiceStatus('Feste NAVI-Stimme ist aus');
  } else if (ttsState === 'loading') {
    setVoiceStatus('Feste NAVI-Stimme wird geladen …', 'loading');
  } else if (ttsState === 'ready') {
    setVoiceStatus(`${FIXED_VOICE_LABEL} bereit · ${ttsBackend}`, 'ready');
  } else if (ttsState === 'error') {
    setVoiceStatus('Supertonic konnte nicht geladen werden · Lautsprecher zum Wiederholen tippen', 'error');
  } else {
    setVoiceStatus('Feste NAVI-Stimme wird vorbereitet …', 'loading');
  }
}

function goHome() {
  stopSpeaking();
  $('#chat').classList.add('hidden');
  $('#home').classList.remove('hidden');
  history = [];
}

function openChat(next) {
  mode = next;
  history = [];
  $('#home').classList.add('hidden');
  $('#chat').classList.remove('hidden');
  $('#modeTitle').textContent = titles[mode];
  messages.innerHTML = '';
  $('#crisis').classList.add('hidden');
  addMessage('navi', starters[mode]);
  input.focus();
  void speak(starters[mode]);
}

function addMessage(role, text, typing = false) {
  const div = document.createElement('div');
  div.className = `msg ${role}${typing ? ' typing' : ''}`;
  div.textContent = text;
  if (role === 'navi' && !typing) {
    div.classList.add('speakable');
    div.title = 'Noch einmal vorlesen';
    div.addEventListener('click', () => void speak(text));
  }
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

$('#form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  addMessage('user', text);
  const pending = addMessage('navi', 'NAVI denkt', true);
  orb.classList.add('thinking');

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text, mode, history }),
    });
    const data = await response.json();
    pending.remove();
    if (!response.ok) throw new Error(data.error || 'Keine Verbindung');

    addMessage('navi', data.reply);
    history.push(
      { role: 'user', content: text },
      { role: 'assistant', content: data.reply },
    );
    history = history.slice(-10);
    if (data.crisis) $('#crisis').classList.remove('hidden');
    void speak(data.reply);
  } catch (error) {
    pending.remove();
    addMessage('navi', `${error.message} Du kannst es in einem Moment noch einmal versuchen.`);
  } finally {
    orb.classList.remove('thinking');
  }
});

function clearChat() {
  stopSpeaking();
  history = [];
  messages.innerHTML = '';
  $('#crisis').classList.add('hidden');
  addMessage('navi', starters[mode]);
  void speak(starters[mode]);
}

async function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  localStorage.naviVoice = voiceEnabled ? 'on' : 'off';

  if (!voiceEnabled) {
    stopSpeaking();
    updateVoiceUi();
    return;
  }

  if (ttsState === 'error') {
    ttsState = 'idle';
    ttsInitPromise = null;
  }

  updateVoiceUi();
  tone();
  await initializeSupertonic();
}

async function createTtsWithProvider(executionProvider) {
  return supertonic.loadTextToSpeech(
    SUPERTONIC_ONNX,
    {
      executionProviders: [executionProvider],
      graphOptimizationLevel: 'all',
    },
    (modelName, current, total) => {
      setVoiceStatus(`Lade feste Stimme ${current}/${total}: ${modelName}`, 'loading');
    },
  );
}

async function initializeSupertonic() {
  if (ttsState === 'ready') return true;
  if (ttsInitPromise) return ttsInitPromise;

  ttsState = 'loading';
  updateVoiceUi();

  ttsInitPromise = (async () => {
    supertonic = await import(SUPERTONIC_MODULE);

    let result = null;
    let webgpuError = null;

    if (navigator.gpu) {
      try {
        setVoiceStatus('Feste Stimme: WebGPU wird vorbereitet …', 'loading');
        result = await createTtsWithProvider('webgpu');
        ttsBackend = 'WebGPU';
      } catch (error) {
        webgpuError = error;
        console.warn('Supertonic WebGPU fehlgeschlagen, versuche WebAssembly.', error);
      }
    }

    if (!result) {
      setVoiceStatus('Feste Stimme: WebAssembly wird vorbereitet …', 'loading');
      try {
        result = await createTtsWithProvider('wasm');
        ttsBackend = 'WebAssembly';
      } catch (wasmError) {
        if (webgpuError) console.warn('Vorheriger WebGPU-Fehler:', webgpuError);
        throw wasmError;
      }
    }

    textToSpeech = result.textToSpeech;
    setVoiceStatus('Feste NAVI-Stimme wird geladen …', 'loading');
    fixedStyle = await supertonic.loadVoiceStyle([
      `${SUPERTONIC_VOICES}/${FIXED_VOICE}.json`,
    ]);

    ttsState = 'ready';
    updateVoiceUi();
    return true;
  })().catch((error) => {
    console.error('Supertonic konnte nicht initialisiert werden.', error);
    textToSpeech = null;
    fixedStyle = null;
    ttsState = 'error';
    ttsInitPromise = null;
    updateVoiceUi();
    return false;
  });

  return ttsInitPromise;
}

function stopSpeaking() {
  speechToken += 1;

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.removeAttribute('src');
    currentAudio.load();
    currentAudio = null;
  }

  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }

  orb.classList.remove('talking');
  if (voiceEnabled) updateVoiceUi();
}

async function speak(text) {
  if (!voiceEnabled || !text) return;

  stopSpeaking();
  const token = speechToken;

  const ready = await initializeSupertonic();
  if (!ready || token !== speechToken || !voiceEnabled) return;

  try {
    await speakWithSupertonic(text, token);
  } catch (error) {
    console.error('Supertonic-Sprachausgabe fehlgeschlagen.', error);
    if (token === speechToken) {
      orb.classList.remove('talking');
      setVoiceStatus('Feste Stimme konnte diese Antwort nicht sprechen', 'error');
    }
  }
}

async function speakWithSupertonic(text, token) {
  setVoiceStatus('NAVI erzeugt Sprache …', 'loading');

  const { wav, duration } = await textToSpeech.call(
    text,
    'de',
    fixedStyle,
    6,
    1.0,
    0.22,
  );

  if (token !== speechToken || !voiceEnabled) return;

  const wavLength = Math.floor(textToSpeech.sampleRate * duration[0]);
  const wavBuffer = supertonic.writeWavFile(
    wav.slice(0, wavLength),
    textToSpeech.sampleRate,
  );
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });

  currentAudioUrl = URL.createObjectURL(blob);
  currentAudio = new Audio(currentAudioUrl);

  currentAudio.onplay = () => {
    if (token !== speechToken) return;
    orb.classList.add('talking');
    setVoiceStatus(`${FIXED_VOICE_LABEL} spricht`, 'ready');
  };

  currentAudio.onended = () => finishAudio(token);
  currentAudio.onerror = () => finishAudio(token);

  await currentAudio.play();
}

function finishAudio(token) {
  if (token !== speechToken) return;
  orb.classList.remove('talking');

  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }

  currentAudio = null;
  updateVoiceUi();
}

function tone() {
  if (!voiceEnabled) return;

  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  oscillator.frequency.value = 520;
  gain.gain.setValueAtTime(0.025, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.16);
  oscillator.connect(gain);
  gain.connect(audioCtx.destination);
  oscillator.start();
  oscillator.stop(audioCtx.currentTime + 0.16);
}

function startVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    addMessage('navi', 'Spracheingabe wird von diesem Browser leider noch nicht unterstützt.');
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'de-DE';
  recognition.interimResults = false;
  $('#mic').classList.add('listening');
  recognition.onresult = (event) => {
    input.value = event.results[0][0].transcript;
  };
  recognition.onend = () => $('#mic').classList.remove('listening');
  recognition.onerror = () => $('#mic').classList.remove('listening');
  recognition.start();
}

document.addEventListener('pointermove', (event) => {
  const face = $('#face');
  const bounds = orb.getBoundingClientRect();
  const x = Math.max(-6, Math.min(6, (event.clientX - bounds.left - bounds.width / 2) / 28));
  const y = Math.max(-5, Math.min(5, (event.clientY - bounds.top - bounds.height / 2) / 28));
  face.style.transform = `translate(${x}px,${y}px)`;
});

stopVoiceButton.addEventListener('click', stopSpeaking);
voiceButton.addEventListener('click', toggleVoice);

Object.assign(window, {
  goHome,
  openChat,
  clearChat,
  startVoice,
});

updateVoiceUi();
if (voiceEnabled) void initializeSupertonic();
