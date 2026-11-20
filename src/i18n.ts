/* Langue de l'interface : celle d'Obsidian (français ou anglais), modifiable dans les réglages. */

export type Lang = 'fr' | 'en';

export function obsidianLang(): Lang {
  const l = window.localStorage.getItem('language') || navigator.language || 'en';
  return l.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

const FR = {
  ribbon: 'Ouvrir Faceless', cmdOpen: 'Ouvrir l\'accueil', cmdReview: 'Revue de la semaine', cmdStop: 'Arrêter la lecture',
  sub: 'vault · système local',
  listen: 'Écouter', listenAll: 'Écouter, briefing compris', openBriefing: 'Ouvrir le briefing', refresh: 'Actualiser',
  pReprise: 'Reprendre', pProjects: 'Projets', pBriefing: 'Briefing', pForgotten: 'Note à relire', pDead: 'Tâches à trancher',
  pStatus: 'État du système', pReview: 'Revue de la semaine', pAsk: 'Demander au vault',
  asleep: (n: number) => `${n} en veille`, thisMorning: 'ce matin', modified: (w: string) => `modifiée ${w}`, viaClaudian: 'via Claudian',
  openReprise: 'Ouvrir le point de reprise', open: 'Ouvrir', reread: 'Relue', another: 'Une autre',
  overdueBy: (d: number) => `Échéance dépassée de plus de ${d} jours.`, abandon: 'Abandonner', keep: 'Garder', andMore: (n: number) => `et ${n} autres`,
  sNotes: 'Notes', sOrphans: 'Sans lien entrant', sUnresolved: 'Liens vers une note absente', sIndex: 'Instructions', sChangelog: 'Dernier changelog',
  orphansTitle: 'Notes sans lien entrant', unresolvedTitle: 'Liens vers une note absente',
  reviewText: 'Sept questions fixes, une à trois phrases chacune.', openReview: 'Ouvrir la revue', startReview: 'Commencer la revue',
  askPlaceholder: 'question au vault, Entrée pour envoyer',
  questions: ['Qu\'est-ce qui bloque chacun de mes projets actifs ?', 'Quelles décisions sont encore en attente, et qui doit trancher ?', 'Qu\'ai-je écrit dans le vault cette semaine ?'],
  galaxy: 'Galaxie 3D', claudian: 'Claudian', search: 'Recherche',
  active: (a: number, s: number) => `${a} actifs · ${s} en veille`, steps: (d: number, t: number) => `${d}/${t} étapes`,
  roadmaps: (p: string) => `roadmaps ${p}`, sleepingTip: 'endormi', asleepShort: 'veille', noRoadmap: 'Pas de roadmap', roadmap: 'Roadmap',
  reviewQuestions: ['Qu\'est-ce qui est sorti cette semaine ?', 'Qu\'est-ce qui devait sortir et n\'est pas sorti ?', 'Qu\'est-ce que j\'ai évité, et pourquoi ?',
    'Quel projet a avancé, lequel a dormi ?', 'Une chose à abandonner.', 'Une chose à protéger la semaine prochaine.', 'Les trois priorités de la semaine prochaine.'],
  reviewTitle: (w: number) => `Revue de la semaine ${w}`, reviewHint: 'Une à trois phrases par question. Rien de plus.', reviewFile: 'Revue', briefingFile: 'Briefing',
  taskAbandoned: (f: string) => `Tâche abandonnée dans ${f}.`, lineChanged: 'La ligne a changé depuis l\'affichage : rien n\'a été modifié.',
  noSpeech: 'La synthèse vocale n\'est pas disponible.', noLocalVoice: 'Aucune voix dans cette langue sur ce système.',
  piperMissing: 'Voix naturelle non configurée : Réglages → Faceless → Voix. En attendant, voix du système.',
  piperFailed: (m: string) => `Voix naturelle indisponible (${m}) : voix du système à la place.`,
  claudianMissing: 'Zone de saisie de Claudian introuvable : la question est copiée, colle-la dans le chat.',
  claudianWrite: 'Impossible d\'écrire dans Claudian : la question est copiée, colle-la dans le chat.',
  askPrefix: 'Réponds uniquement à partir de mon vault Obsidian : cherche les notes pertinentes, cite-les sous forme de liens [[...]], et dis « non trouvé dans le vault » si l\'information n\'y est pas.',
  question: 'Question',
  changeIcon: 'Changer l\'icône', autoIcon: 'Icône automatique', iconSearch: 'Chercher une icône Phosphor (ex. book, database, calendar)…',
  colorSearch: 'Couleur (Entrée = garder la couleur du dossier)', current: 'actuelle',
  testPhrase: 'Bonjour. Je suis Faceless. Voici à quoi ressemble ma voix.',
  weekdays: ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
};

type Dict = typeof FR;

const EN: Dict = {
  ribbon: 'Open Faceless', cmdOpen: 'Open home', cmdReview: 'Weekly review', cmdStop: 'Stop reading',
  sub: 'vault · local system',
  listen: 'Listen', listenAll: 'Listen, briefing included', openBriefing: 'Open briefing', refresh: 'Refresh',
  pReprise: 'Pick up', pProjects: 'Projects', pBriefing: 'Briefing', pForgotten: 'Note to revisit', pDead: 'Tasks to settle',
  pStatus: 'System status', pReview: 'Weekly review', pAsk: 'Ask the vault',
  asleep: (n: number) => `${n} idle`, thisMorning: 'this morning', modified: (w: string) => `edited ${w}`, viaClaudian: 'via Claudian',
  openReprise: 'Open checkpoint', open: 'Open', reread: 'Revisited', another: 'Another one',
  overdueBy: (d: number) => `Overdue by more than ${d} days.`, abandon: 'Drop', keep: 'Keep', andMore: (n: number) => `and ${n} more`,
  sNotes: 'Notes', sOrphans: 'No incoming link', sUnresolved: 'Links to missing notes', sIndex: 'Instructions', sChangelog: 'Last changelog',
  orphansTitle: 'Notes with no incoming link', unresolvedTitle: 'Links to missing notes',
  reviewText: 'Seven fixed questions, one to three sentences each.', openReview: 'Open review', startReview: 'Start review',
  askPlaceholder: 'ask your vault, Enter to send',
  questions: ['What is blocking each of my active projects?', 'Which decisions are still pending, and who decides?', 'What did I write in the vault this week?'],
  galaxy: '3D galaxy', claudian: 'Claudian', search: 'Search',
  active: (a: number, s: number) => `${a} active · ${s} idle`, steps: (d: number, t: number) => `${d}/${t} steps`,
  roadmaps: (p: string) => `roadmaps ${p}`, sleepingTip: 'idle', asleepShort: 'idle', noRoadmap: 'No roadmap', roadmap: 'Roadmap',
  reviewQuestions: ['What shipped this week?', 'What was supposed to ship and didn\'t?', 'What did I avoid, and why?',
    'Which project moved forward, which one slept?', 'One thing to drop.', 'One thing to protect next week.', 'The three priorities for next week.'],
  reviewTitle: (w: number) => `Weekly review ${w}`, reviewHint: 'One to three sentences per question. Nothing more.', reviewFile: 'Review', briefingFile: 'Briefing',
  taskAbandoned: (f: string) => `Task dropped in ${f}.`, lineChanged: 'The line changed since it was displayed: nothing was modified.',
  noSpeech: 'Speech synthesis is not available.', noLocalVoice: 'No voice in this language on this system.',
  piperMissing: 'Natural voice not configured: Settings → Faceless → Voice. Using the system voice meanwhile.',
  piperFailed: (m: string) => `Natural voice unavailable (${m}): using the system voice.`,
  claudianMissing: 'Claudian input not found: the question is copied, paste it in the chat.',
  claudianWrite: 'Could not write into Claudian: the question is copied, paste it in the chat.',
  askPrefix: 'Answer only from my Obsidian vault: find the relevant notes, cite them as [[...]] links, and say "not found in the vault" if the information is not there.',
  question: 'Question',
  changeIcon: 'Change icon', autoIcon: 'Automatic icon', iconSearch: 'Search a Phosphor icon (e.g. book, database, calendar)…',
  colorSearch: 'Color (Enter = keep the folder color)', current: 'current',
  testPhrase: 'Hello. I am Faceless. This is what my voice sounds like.',
  weekdays: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};

let current: Lang = obsidianLang();
export function setLang(l: Lang) { current = l; }
export function lang(): Lang { return current; }
export function t(): Dict { return current === 'fr' ? FR : EN; }
