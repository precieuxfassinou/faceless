import { moment, sinceWords, type Deadline, type Snapshot } from './insights';
import { lang, t } from './i18n';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** « A », « A et B », « A, B et C » (ou « and » en anglais) */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  const and = lang() === 'fr' ? 'et' : 'and';
  return `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;
}

export function dayWords(date: string, now: any): string {
  const fr = lang() === 'fr';
  const d = moment(date, 'YYYY-MM-DD').locale(lang());
  const diff = now.clone().startOf('day').diff(d.clone().startOf('day'), 'days');
  if (diff === 0) return fr ? 'aujourd’hui' : 'today';
  if (diff === 1) return fr ? 'hier' : 'yesterday';
  const sameYear = d.year() === now.year();
  return fr ? `le ${d.format(sameYear ? 'D MMMM' : 'D MMMM YYYY')}` : `on ${d.format(sameYear ? 'MMMM D' : 'MMMM D, YYYY')}`;
}

export function untilWords(d: Deadline, now: any): string {
  const fr = lang() === 'fr';
  if (d.precise) {
    const days = d.when.clone().startOf('day').diff(now.clone().startOf('day'), 'days');
    if (days <= 0) return fr ? 'aujourd’hui' : 'today';
    if (days === 1) return fr ? 'demain' : 'tomorrow';
    if (days <= 60) return fr ? `dans ${days} jours` : `in ${days} days`;
  }
  const months = d.when.clone().startOf('month').diff(now.clone().startOf('month'), 'months');
  if (months <= 0) return fr ? 'ce mois-ci' : 'this month';
  if (months === 1) return fr ? 'le mois prochain' : 'next month';
  return fr ? `dans environ ${months} mois` : `in about ${months} months`;
}

export const weekdayName = (n: number) => t().weekdays[n] ?? t().weekdays[5]!;

/**
 * Le paragraphe d'ouverture : des faits tirés du vault, dans l'ordre où ils servent la journée.
 * Pas de salutation, pas d'adjectif : une phrase n'apparaît que si elle apprend quelque chose.
 */
export function compose(s: Snapshot, opts: { deadDays: number; reviewWeekday: number }): string[] {
  const fr = lang() === 'fr';
  const now = s.now.clone().locale(lang());
  const out: string[] = [fr
    ? `${cap(now.format('dddd D MMMM'))}, ${now.format('H')} h ${now.format('mm')}.`
    : `${now.format('dddd, MMMM D')}, ${now.format('h:mm A')}.`];

  const withReprise = s.projects.filter(p => p.reprise?.date).sort((a, b) => b.reprise!.date!.localeCompare(a.reprise!.date!));
  const lastTouched = s.projects.find(p => !p.sleeping);
  if (withReprise[0]) {
    const p = withReprise[0];
    out.push(fr ? `Ton dernier point de reprise porte sur ${p.name}, ${dayWords(p.reprise!.date!, now)}.`
      : `Your last checkpoint is on ${p.name}, ${dayWords(p.reprise!.date!, now)}.`);
  } else if (lastTouched) {
    out.push(fr ? `Dernier projet touché : ${lastTouched.name}.` : `Last project touched: ${lastTouched.name}.`);
  }

  const sleeping = s.projects.filter(p => p.sleeping);
  if (sleeping.length) {
    const groups = new Map<string, string[]>();
    for (const p of sleeping) {
      const w = sinceWords(p.last, now);
      groups.set(w, [...(groups.get(w) ?? []), p.name]);
    }
    const verb = (n: number) => fr ? (n > 1 ? 'dorment' : 'dort') : (n > 1 ? 'have been idle' : 'has been idle');
    // « A dort depuis août ; B et C, depuis juillet. »
    const parts = [...groups].map(([w, names], i) => i === 0 ? `${joinList(names)} ${verb(names.length)} ${w}` : `${joinList(names)}, ${w}`);
    out.push(`${parts.join(fr ? ' ; ' : '; ')}.`);
  }

  const n = s.deadTasks.length;
  if (n === 1) out.push(fr ? `Une tâche datée est dépassée depuis plus de ${opts.deadDays} jours.` : `One dated task is more than ${opts.deadDays} days overdue.`);
  else if (n > 1) out.push(fr ? `${n} tâches datées sont dépassées depuis plus de ${opts.deadDays} jours.` : `${n} dated tasks are more than ${opts.deadDays} days overdue.`);

  if (s.isReviewDay) {
    const started = s.review && s.review.basename.startsWith(now.format('YYYY-MM-DD'));
    const day = weekdayName(opts.reviewWeekday);
    out.push(started
      ? (fr ? 'La revue de la semaine est commencée.' : 'The weekly review is started.')
      : (fr ? `C’est ${day} : la revue de la semaine t’attend.` : `It’s ${day}: the weekly review is waiting.`));
  }

  const next = s.deadlines[0];
  if (next) out.push(`${next.label} ${untilWords(next, now)}.`);

  if (s.briefing) out.push(fr ? 'Le briefing de ce matin est prêt.' : 'This morning’s briefing is ready.');
  return out;
}
