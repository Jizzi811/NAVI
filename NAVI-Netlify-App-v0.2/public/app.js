import {
  loadTextToSpeech,
  loadVoiceStyle,
  writeWavFile,
} from 'https://esm.sh/gh/supertone-inc/supertonic@dff55dc00064c398736080c78195f577527832ae/web/helper.js?bundle';

const SUPERTONIC_ONNX = 'https://huggingface.co/Supertone/supertonic-3/resolve/main/onnx';
const SUPERTONIC_VOICES = 'https://huggingface.co/Supertone/supertonic-3/resolve/main/voice_styles';
const VOICE_LABELS = {
  F1: 'Weiblich 1', F2: 'Weiblich 2', F3: 'Weiblich 3', F4: 'Weiblich 4', F5: 'Weiblich 5',
  M1: 'Männlich 1', M2: 'Männlich 2', M3: 'Männlich 3', M4: 'Männlich 4', M5: 'Männlich 5',
};

let mode = 'listen';
let history = [];
let voiceEnabled = localStorage.naviVoice === 'on';
let selectedVoice = localStorage.naviVoiceStyle || 'F2';
let audioCtx;
let textToSpeech = null;
let currentStyle = null;
let ttsInitPromise = null;
let ttsState = 'idle';
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
const voiceSelect = $('#voiceSelect');
const stopVoiceButton = $('#stopVoice');

function setVoiceStatus(text, state = '') {
  voiceStatus.textContent = text;
  voiceStatus.dataset.state = state;
}

function updateVoiceUi() {
  voiceButton.textContent = voiceEnabled ? '🔊' : '🔇';
  voiceButton.classList.toggle('active', voiceEnabled);
  voiceButton.setAttribute('aria-label', voiceEnabled ? 'NAVI-Stimme ausschalten' : 'NAVI-Stimme einschalten');
  voiceSelect.disabled = !voiceEnabled || ttsState === 'loading';
  stopVoiceButton.disabled = !voiceEnabled;

  if (!voiceEnabled) setVoiceStatus('Stimme aus');
  else if (ttsState === 'loading') setVoiceStatus('Supertonic wird geladen …', 'loading');
  else if (ttsState === 'ready') setVoiceStatus(`Supertonic · ${VOICE_LABELS[selectedVoice]}`, 'ready');
  else if (ttsState === 'fallback') setVoiceStatus('Browser-Stimme aktiv', 'fallback');
  else setVoiceStatus('Stimme wird vorbereitet …', 'loading');
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
  speak(starters[mode]);
}

function addMessage(role, text, typing = false) {
  const div = document.createElement('div');
  div.className = `msg ${role}${typing ? ' typing' : ''}`;
  div.textContent = text;
  if (role === 'navi' && !typing) {
    div.classList.add('speakable');
    div.title = 'Zum Vorlesen anklicken';
    div.addEventListener('click', () => speak(text));
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
    history.push({ role: 'user', content: text }, { role: 'assistant', content: data.reply });
    history = history.slice(-10);
    if (data.crisis) $('#crisis').classList.remove('hidden');
    speak(data.reply);
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
  speak(starters[mode]);
}

async function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  localStorage.naviVoice = voiceEnabled ? 'on' : 'off';
  if (!voiceEnabled) {
    stopSpeaking();
    updateVoiceUi();
    return;
  }
  updateVoiceUi();
  tone();
  void initializeSupertonic();
}

async function initializeSupertonic() {
  if (ttsState === 'ready') return true;
  if (ttsInitPromise) return ttsInitPromise;
  ttsState = 'loading';
  updateVoiceUi();
  ttsInitPromise = (async () => {
    const executionProvider = navigator.gpu ? 'webgpu' : 'wasm';
    const result = await loadTextToSpeech(
      SUPERTONIC_ONNX,
      { executionProviders: [executionProvider], graphOptimizationLevel: 'all' },
      (modelName, current, total) => setVoiceStatus(`Lade Stimme ${current}/${total}: ${modelName}`, 'loading'),
    );
    textToSpeech = result.textToSpeech;
    currentStyle = await loadVoiceStyle([`${SUPERTONIC_VOICES}/${selectedVoice}.json`]);
    ttsState = 'ready';
    updateVoiceUi();
    return true;
  })().catch((error) => {
    console.warn('Supertonic konnte nicht geladen werden. Browser-Stimme wird verwendet.', error);
    ttsState = 'fallback';
    updateVoiceUi();
    return false;
  });
  return ttsInitPromise;
}

async function changeVoice(value) {
  if (!VOICE_LABELS[value]) return;
  selectedVoice = value;
  localStorage.naviVoiceStyle = value;
  if (ttsState !== 'ready') {
    updateVoiceUi();
    return;
  }
  try {
    voiceSelect.disabled = true;
    setVoiceStatus(`Lade ${VOICE_LABELS[value]} …`, 'loading');
    currentStyle = await loadVoiceStyle([`${SUPERTONIC_VOICES}/${value}.json`]);
    updateVoiceUi();
  } catch (error) {
    console.warn('Stimme konnte nicht gewechselt werden.', error);
    ttsState = 'fallback';
    updateVoiceUi();
  }
}

function stopSpeaking() {
  speechToken += 1;
  window.speechSynthesis?.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
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
  if (ttsState === 'idle') void initializeSupertonic();
  if (ttsState === 'ready' && textToSpeech && currentStyle) {
    try {
      await speakWithSupertonic(text, token);
      return;
    } catch (error) {
      console.warn('Supertonic-Ausgabe fehlgeschlagen. Browser-Stimme wird verwendet.', error);
      ttsState = 'fallback';
      updateVoiceUi();
    }
  }
  speakWithBrowser(text, token);
}

async function speakWithSupertonic(text, token) {
  setVoiceStatus('NAVI erzeugt Sprache …', 'loading');
  const { wav, duration } = await textToSpeech.call(text, 'de', currentStyle, 6, 1.0, 0.22);
  if (token !== speechToken || !voiceEnabled) return;
  const wavLength = Math.floor(textToSpeech.sampleRate * duration[0]);
  const wavBuffer = writeWavFile(wav.slice(0, wavLength), textToSpeech.sampleRate);
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  currentAudioUrl = URL.createObjectURL(blob);
  currentAudio = new Audio(currentAudioUrl);
  currentAudio.onplay = () => {
    orb.classList.add('talking');
    setVoiceStatus(`NAVI spricht · ${VOICE_LABELS[selectedVoice]}`, 'ready');
  };
  currentAudio.onended = () => {
    orb.classList.remove('talking');
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
    currentAudio = null;
    updateVoiceUi();
  };
  currentAudio.onerror = () => {
    orb.classList.remove('talking');
    updateVoiceUi();
  };
  await currentAudio.play();
}

function speakWithBrowser(text, token) {
  if (!('speechSynthesis' in window)) {
    setVoiceStatus('Sprachausgabe nicht unterstützt', 'fallback');
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'de-DE';
  utterance.rate = 0.96;
  utterance.pitch = 1.0;
  const voices = window.speechSynthesis.getVoices();
  const germanVoice = voices.find((voice) => voice.lang?.toLowerCase().startsWith('de'));
  if (germanVoice) utterance.voice = germanVoice;
  utterance.onstart = () => {
    if (token !== speechToken) return;
    orb.classList.add('talking');
    setVoiceStatus('NAVI spricht · Browser-Stimme', 'fallback');
  };
  utterance.onend = () => {
    if (token !== speechToken) return;
    orb.classList.remove('talking');
    updateVoiceUi();
  };
  utterance.onerror = () => {
    orb.classList.remove('talking');
    updateVoiceUi();
  };
  window.speechSynthesis.speak(utterance);
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
  recognition.onresult = (event) => { input.value = event.results[0][0].transcript; };
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

voiceSelect.value = selectedVoice;
voiceSelect.addEventListener('change', (event) => changeVoice(event.target.value));
stopVoiceButton.addEventListener('click', stopSpeaking);
voiceButton.addEventListener('click', toggleVoice);
window.speechSynthesis?.getVoices();
updateVoiceUi();
if (voiceEnabled) void initializeSupertonic();

Object.assign(window, { goHome, openChat, clearChat, toggleVoice, stopSpeaking, startVoice });
