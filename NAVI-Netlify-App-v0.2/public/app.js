const FIXED_VOICE_LABEL = 'NAVI-Stimme M5';

let mode = 'listen';
let history = [];
let voiceEnabled = false;
let audioCtx;
let voiceWorker = null;
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
  voiceButton.setAttribute(
    'aria-label',
    voiceEnabled ? 'NAVI-Stimme ausschalten' : 'NAVI-Stimme einschalten',
  );
  stopVoiceButton.disabled = !voiceEnabled;

  if (!voiceEnabled) {
    setVoiceStatus('Stimme ist aus · Lautsprecher zum Aktivieren');
  } else if (ttsState === 'loading') {
    setVoiceStatus('Stimme lädt im Hintergrund …', 'loading');
  } else if (ttsState === 'ready') {
    setVoiceStatus(`${FIXED_VOICE_LABEL} bereit · ${ttsBackend}`, 'ready');
  } else if (ttsState === 'error') {
    setVoiceStatus('Stimme konnte nicht geladen werden · erneut antippen', 'error');
  } else {
    setVoiceStatus('Stimme wird vorbereitet …', 'loading');
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
}

function addMessage(role, text, typing = false) {
  const div = document.createElement('div');
  div.className = `msg ${role}${typing ? ' typing' : ''}`;
  div.textContent = text;

  if (role === 'navi' && !typing) {
    div.classList.add('speakable');
    div.title = 'Noch einmal vorlesen';
    div.addEventListener('click', () => {
      if (voiceEnabled) {
        void speak(text);
      } else {
        setVoiceStatus('Zum Vorlesen zuerst den Lautsprecher aktivieren');
      }
    });
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
    if (voiceEnabled) void speak(data.reply);
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
}

function ensureVoiceWorker() {
  if (voiceWorker) return voiceWorker;

  voiceWorker = new Worker('/supertonic-worker.js?v=worker-20260722', { type: 'module' });

  voiceWorker.onmessage = ({ data }) => {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'progress') {
      if (voiceEnabled) setVoiceStatus(data.message, 'loading');
      return;
    }

    if (data.type === 'ready') {
      ttsState = 'ready';
      ttsBackend = data.backend || 'WebAssembly';
      updateVoiceUi();
      return;
    }

    if (data.type === 'audio') {
      playWorkerAudio(data.id, data.buffer);
      return;
    }

    if (data.type === 'error') {
      console.error('Supertonic Worker:', data.detail);
      if (data.id && data.id !== speechToken) return;
      ttsState = 'error';
      setVoiceStatus(`Stimmenfehler: ${data.detail || 'Unbekannter Fehler'}`.slice(0, 180), 'error');
    }
  };

  voiceWorker.onerror = (error) => {
    console.error('Supertonic Worker konnte nicht gestartet werden.', error);
    ttsState = 'error';
    setVoiceStatus('Stimmen-Worker konnte nicht gestartet werden', 'error');
  };

  return voiceWorker;
}

async function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  localStorage.setItem('naviVoice', 'off');

  if (!voiceEnabled) {
    stopSpeaking();
    updateVoiceUi();
    return;
  }

  if (ttsState === 'error') ttsState = 'idle';
  ttsState = ttsState === 'ready' ? 'ready' : 'loading';
  updateVoiceUi();
  tone();
  ensureVoiceWorker().postMessage({ type: 'init' });
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
  updateVoiceUi();
}

async function speak(text) {
  if (!voiceEnabled || !text) return;

  stopSpeaking();
  const id = speechToken;
  ttsState = ttsState === 'ready' ? 'ready' : 'loading';
  setVoiceStatus(ttsState === 'ready' ? 'NAVI erzeugt Sprache …' : 'Stimme lädt im Hintergrund …', 'loading');
  ensureVoiceWorker().postMessage({ type: 'speak', id, text });
}

function playWorkerAudio(id, buffer) {
  if (!voiceEnabled || id !== speechToken || !(buffer instanceof ArrayBuffer)) return;

  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  currentAudio = new Audio(currentAudioUrl);

  currentAudio.onplay = () => {
    if (id !== speechToken) return;
    orb.classList.add('talking');
    setVoiceStatus(`${FIXED_VOICE_LABEL} spricht`, 'ready');
  };
  currentAudio.onended = () => finishAudio(id);
  currentAudio.onerror = () => finishAudio(id);

  currentAudio.play().catch((error) => {
    console.error('Audio konnte nicht gestartet werden.', error);
    setVoiceStatus('Zum Abspielen bitte noch einmal auf die Antwort tippen', 'error');
  });
}

function finishAudio(id) {
  if (id !== speechToken) return;
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

localStorage.setItem('naviVoice', 'off');
updateVoiceUi();
