const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const crisisPatterns = [
  /ich (will|möchte) (nicht mehr leben|sterben)/i,
  /suizid|selbstmord|umbringen|töten|selbstverletz/i,
  /mir etwas antun|keinen ausweg mehr/i,
];

const modeGuidance = {
  listen: "Höre in erster Linie zu. Spiegele behutsam und stelle nur eine kurze, offene Frage.",
  sort: "Hilf, Gedanken in kleine Kategorien zu sortieren. Frage zuerst nach dem wichtigsten Knoten.",
  calm: "Antworte besonders ruhig und kurz. Biete eine einfache Grounding- oder Atemübung an, ohne Druck.",
  plan: "Hilf, genau einen kleinen nächsten Schritt und höchstens zwei optionale Schritte zu finden.",
};

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify(body) };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Nur POST ist erlaubt." });
  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Ungültige Anfrage." }); }
  const message = String(input.message || "").trim().slice(0, 3000);
  const mode = modeGuidance[input.mode] ? input.mode : "listen";
  const history = Array.isArray(input.history) ? input.history.slice(-10) : [];
  if (!message) return json(400, { error: "Bitte sag NAVI, was gerade los ist." });

  if (crisisPatterns.some((pattern) => pattern.test(message))) {
    return json(200, { crisis: true, reply: "Es klingt, als könntest du gerade in unmittelbarer Gefahr sein. Bitte bleib damit nicht allein. Ruf jetzt 112 an oder den Krisendienst beziehungsweise die TelefonSeelsorge unter 0800 111 0 111 oder 0800 111 0 222. Wenn es möglich ist: Geh zu einer vertrauten Person und sag klar: „Ich brauche gerade Hilfe und möchte nicht allein bleiben.“" });
  }

  if (!process.env.NVIDIA_API_KEY) return json(503, { error: "NAVI ist noch nicht mit NVIDIA verbunden." });

  const system = `Du bist NAVI, ein warmer, ruhiger deutschsprachiger Begleiter für emotionale Selbstreflexion. Du bist kein Therapeut, Arzt oder Krisendienst. Stelle keine Diagnosen, bewerte keine Medikamente und behaupte niemals, professionelle Behandlung zu ersetzen.

${modeGuidance[mode]}

Regeln:
- Antworte natürlich auf Deutsch, warm, konkret und meistens in 2 bis 5 Sätzen.
- Stelle höchstens eine Frage pro Antwort.
- Höre zuerst zu; erteile keine ungefragte Motivationsrede.
- Verwende therapeutisch inspirierte Alltagsmethoden wie Spiegeln, Grounding, Gedanken sortieren und kleine Schritte, aber keine Behandlung oder Diagnose.
- Bei Anzeichen akuter Selbst- oder Fremdgefährdung: unterbrich den normalen Dialog, rate zu 112 und menschlicher Unterstützung. Versprich keine Vertraulichkeit.
- Bei medizinischen oder rechtlichen Fragen: verweise an qualifizierte Fachpersonen.
- Behandle den Namen der Person sparsam und natürlich.`;

  const messages = [
    { role: "system", content: system },
    ...history.filter(x => ["user", "assistant"].includes(x?.role) && typeof x?.content === "string").map(x => ({ role: x.role, content: x.content.slice(0, 3000) })),
    { role: "user", content: message },
  ];

  try {
    const response = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: { "authorization": `Bearer ${process.env.NVIDIA_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.NVIDIA_MODEL || "nvidia/nemotron-3-nano-30b-a3b", messages, temperature: 0.55, top_p: 0.9, max_tokens: 420, stream: false }),
    });
    const data = await response.json();
    if (!response.ok) return json(502, { error: data?.detail || data?.message || "NVIDIA konnte gerade nicht antworten." });
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) return json(502, { error: "NAVI hat keine Antwort erhalten." });
    return json(200, { reply, crisis: false });
  } catch {
    return json(502, { error: "NAVI erreicht seinen Gedankenraum gerade nicht. Bitte versuche es gleich noch einmal." });
  }
}
