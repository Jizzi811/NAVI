# NAVI

Empathischer Alltagsbegleiter mit NVIDIA Nemotron. NAVI ist kein Ersatz für Psychotherapie oder medizinische Hilfe.

## Netlify

1. Ordner als neues Repository hochladen oder direkt in Netlify importieren.
2. Unter **Site configuration → Environment variables** `NVIDIA_API_KEY` hinterlegen.
3. Optional `NVIDIA_MODEL` setzen; Standard ist `nvidia/nemotron-3-nano-30b-a3b`.
4. Deploy starten.

Der Schlüssel gehört niemals in `public/index.html` oder eine Browser-Variable.
