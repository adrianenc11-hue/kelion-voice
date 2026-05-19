// Voice transcript normalizer.
// Goal: keep Romanian natural, but preserve technical English terms and
// detect when the user switches language so SpeechRecognition can follow.

const TECH_DICTIONARY = [
  [/\b(calion|celion|khelion|quelion|chelion|chellion|kelio|kill ion|helion)\b/gi, 'Kelion'],
  [/\b(kelion ai|kelion a i|chelion ai|calion ai)\b/gi, 'KelionAI'],
  [/\b(open router|open ruter|openruter)\b/gi, 'OpenRouter'],
  [/\b(clode|claud|cloud opus|cloude)\b/gi, 'Claude'],
  [/\b(sonet|sunet 4\.?6|sonnet)\b/gi, 'Sonnet'],
  [/\b(opus|opos)\b/gi, 'Opus'],
  [/\b(gemeni|jemini|jiminy|germany)\b/gi, 'Gemini'],
  [/\b(eleven labs|ileven labs)\b/gi, 'ElevenLabs'],
  [/\b(reiluei|railuei|railwai|reilway|rayilway)\b/gi, 'Railway'],
  [/\b(guit|ghit)\b/gi, 'Git'],
  [/\b(git hub|ghithub|guit hub)\b/gi, 'GitHub'],
  [/\b(piar|p r|pier)\b/gi, 'PR'],
  [/\b(comit|comite|comitul)\b/gi, 'commit'],
  [/\b(pushi|pushti|push ul|pus pe)\b/gi, 'push'],
  [/\b(pul|pull ul|pool)\b/gi, 'pull'],
  [/\b(diploie|deploi|deploit|diploy|diplooy)\b/gi, 'deploy'],
  [/\b(brans|branchul|branci)\b/gi, 'branch'],
  [/\b(repi|repo ul|ripou)\b/gi, 'repo'],
  [/\b(apii|e p i|eipi)\b/gi, 'API'],
  [/\b(uil|iu ai|ju ai)\b/gi, 'UI'],
  [/\b(bechend|backendul|bekend)\b/gi, 'backend'],
  [/\b(frontendul|front end|frondend)\b/gi, 'frontend'],
  [/\b(nod js|noud js|nout js)\b/gi, 'Node.js'],
  [/\b(doker|docar)\b/gi, 'Docker'],
  [/\b(data beis|daba beis)\b/gi, 'database'],
  [/\b(resand|rezend)\b/gi, 'Resend'],
  [/\b(stripe|straip)\b/gi, 'Stripe'],
  [/\b(tavili|tavly)\b/gi, 'Tavily'],
  [/\b(serper|sarper)\b/gi, 'Serper'],
];

const LANGUAGE_PROFILES = {
  ro: {
    lang: 'ro-RO',
    words: ['si', 'sau', 'vreau', 'trebuie', 'acum', 'maine', 'unde', 'cum', 'de ce', 'lucreaza', 'rezolva', 'verifica'],
  },
  en: {
    lang: 'en-US',
    words: ['the', 'and', 'please', 'what', 'why', 'how', 'check', 'fix', 'push', 'deploy', 'branch', 'commit'],
  },
  es: {
    lang: 'es-ES',
    words: ['que', 'como', 'por favor', 'ahora', 'trabaja', 'arregla', 'donde'],
  },
  fr: {
    lang: 'fr-FR',
    words: ['que', 'comment', 'pourquoi', 'maintenant', 'travaille', 'corrige', 'bonjour'],
  },
  de: {
    lang: 'de-DE',
    words: ['und', 'warum', 'wie', 'jetzt', 'bitte', 'arbeiten', 'korrigieren'],
  },
  it: {
    lang: 'it-IT',
    words: ['che', 'come', 'perche', 'adesso', 'lavora', 'correggi', 'ciao'],
  },
};

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function detectTranscriptLanguage(text, fallback = 'ro-RO') {
  const normalized = normalizeText(text);
  if (!normalized.trim()) return { code: fallback, family: fallback.slice(0, 2), confidence: 0 };

  const scores = Object.entries(LANGUAGE_PROFILES).map(([family, profile]) => {
    const score = profile.words.reduce((sum, word) => {
      const pattern = new RegExp(`\\b${word.replace(/\s+/g, '\\s+')}\\b`, 'i');
      return sum + (pattern.test(normalized) ? 1 : 0);
    }, 0);
    return { family, code: profile.lang, score };
  }).sort((a, b) => b.score - a.score);

  const best = scores[0];
  if (!best || best.score === 0) {
    const fb = fallback || 'ro-RO';
    return { code: fb, family: fb.slice(0, 2), confidence: 0.15 };
  }
  return {
    code: best.code,
    family: best.family,
    confidence: Math.min(0.95, 0.3 + best.score * 0.2),
  };
}

export function recognitionLangFor(detected, browserLang = 'ro-RO') {
  const guess = typeof detected === 'string'
    ? detected
    : detected?.code;
  if (guess && /^[a-z]{2}-[A-Z]{2}$/.test(guess)) return guess;
  if (browserLang && /^[a-z]{2}(-[A-Z]{2})?$/.test(browserLang)) return browserLang;
  return 'ro-RO';
}

export function correctTranscriptDetailed(text, options = {}) {
  if (!text) {
    return { text, language: options.browserLang || 'ro-RO', confidence: 0, changed: false };
  }
  let corrected = String(text);
  for (const [pattern, replacement] of TECH_DICTIONARY) {
    corrected = corrected.replace(pattern, replacement);
  }

  corrected = corrected.replace(/\s+/g, ' ').trim();
  if (corrected) corrected = corrected.charAt(0).toUpperCase() + corrected.slice(1);

  const lang = detectTranscriptLanguage(corrected, options.browserLang || 'ro-RO');
  return {
    text: corrected,
    language: lang.code,
    family: lang.family,
    confidence: lang.confidence,
    changed: corrected !== text,
  };
}

export function correctTranscript(text) {
  return correctTranscriptDetailed(text).text;
}
