/**
 * Server-side messages (notifications, push, emails) in every app language.
 * Each recipient gets the text in THEIR language (profiles.locale). Variables: {name}.
 * Dates are passed as { date: iso } and formatted in the recipient's language and the company time zone.
 */
export const LOCALES = ['en', 'es-MX', 'fr-CA', 'pa', 'hi', 'gu'] as const;
export type Locale = (typeof LOCALES)[number];

type Entry = { title: string; body: string };
type Dict = Record<string, Entry>;

const en = {
  'shift.new': { title: 'New shift', body: '{site} — {when}' },
  'shift.new_many': { title: 'New shifts', body: '{site} — {count} shifts' },
  'shift.changed': { title: 'Shift changed', body: '{site} — {when}' },
  'shift.cancelled': { title: 'Shift cancelled', body: '{site} — {when}' },
  'shift.open': { title: 'Open shift available', body: '{site} — {when} · {count} open' },
  'shift.reminder': { title: 'Shift starts in about 1 hour', body: '{site}' },
  'att.review': { title: 'Attendance needs review', body: 'An attendance record was flagged and needs your review.' },
  'att.late': { title: 'Employee has not clocked in', body: '{name} has not clocked in at {site}.' },
  'att.late_self': { title: 'You have not clocked in', body: 'Your shift at {site} has started.' },
  'att.out_self': { title: 'Did you forget to clock out?', body: 'You are still clocked in. Clock out now or tell your manager the correct time.' },
  'att.out': { title: 'Missing clock-out', body: '{name} is still clocked in after their shift.' },
  'att.no_show': { title: 'No-show', body: '{name} did not clock in for the shift at {site}.' },
  'ot.reached': { title: 'Overtime reached', body: '{name} has worked {worked} h this week (overtime after {limit} h).' },
  'ot.projected': { title: 'Overtime coming up', body: '{name} will reach overtime this week if all scheduled shifts are worked ({worked} h worked + {scheduled} h scheduled; overtime after {limit} h).' },
  'pay.ready': { title: 'Pay summary available', body: 'Your pay summary for the latest period is ready.' },
  'msg.new': { title: 'New message', body: 'New message from {name}' },
  'ts.adjusted': { title: 'Your hours were adjusted', body: '{name} changed a timesheet. Reason: {text}' },
  'ts.rejected': { title: 'Timesheet needs correction', body: 'A timesheet was sent back for correction.' },
  'dispute.opened': { title: 'Timesheet disputed', body: '{name} disputed a timesheet.' },
  'dispute.resolved': { title: 'Dispute resolved', body: '{text}' },
  'dispute.declined': { title: 'Dispute declined', body: '{text}' },
  'req.swap': { title: 'Shift swap request', body: '{name} asked you to take their shift.' },
  'req.pickup': { title: 'Open shift request', body: '{name} asked to work an open shift.' },
  'req.drop': { title: 'Shift drop request', body: '{name} asked to give up a shift.' },
  'req.swap_accepted': { title: 'Swap accepted', body: '{name} accepted. Waiting for manager approval.' },
  'req.swap_declined': { title: 'Swap declined', body: '{name} declined the swap.' },
  'req.swap_approve': { title: 'Shift swap to approve', body: 'Two employees agreed to swap a shift.' },
  'req.approved': { title: 'Shift request approved', body: 'Your schedule was updated.' },
  'req.rejected': { title: 'Shift request declined', body: 'Your manager declined the request.' },
  'toff.requested': { title: 'Time-off request', body: '{name}: {from} → {to}' },
  'toff.approved': { title: 'Time off approved', body: '{from} → {to}' },
  'toff.rejected': { title: 'Time off declined', body: '{from} → {to}' },
  'safety.injury': { title: 'Injury reported', body: '{name}: {text}' },
  'safety.incident': { title: 'Incident reported', body: '{name}: {text}' },
  'safety.near_miss': { title: 'Near miss reported', body: '{name}: {text}' },
  'safety.hazard': { title: 'Hazard reported', body: '{name}: {text}' },
  'safety.talk': { title: 'Sign the toolbox talk', body: '{text}' },
} satisfies Dict;
export type MessageKey = keyof typeof en;

const es: Record<MessageKey, Entry> = {
  'shift.new': { title: 'Nuevo turno', body: '{site} — {when}' },
  'shift.new_many': { title: 'Nuevos turnos', body: '{site} — {count} turnos' },
  'shift.changed': { title: 'Turno modificado', body: '{site} — {when}' },
  'shift.cancelled': { title: 'Turno cancelado', body: '{site} — {when}' },
  'shift.open': { title: 'Turno disponible', body: '{site} — {when} · {count} lugar(es)' },
  'shift.reminder': { title: 'Tu turno empieza en 1 hora aprox.', body: '{site}' },
  'att.review': { title: 'Asistencia por revisar', body: 'Un registro de asistencia fue marcado y necesita tu revisión.' },
  'att.late': { title: 'Empleado sin registrar entrada', body: '{name} no ha registrado su entrada en {site}.' },
  'att.late_self': { title: 'No has registrado tu entrada', body: 'Tu turno en {site} ya empezó.' },
  'att.out_self': { title: '¿Olvidaste registrar tu salida?', body: 'Sigues con la entrada registrada. Registra tu salida ahora o avisa a tu encargado la hora correcta.' },
  'att.out': { title: 'Falta registrar salida', body: '{name} sigue registrado después de su turno.' },
  'att.no_show': { title: 'Falta', body: '{name} no se presentó al turno en {site}.' },
  'ot.reached': { title: 'Horas extra alcanzadas', body: '{name} lleva {worked} h esta semana (horas extra después de {limit} h).' },
  'ot.projected': { title: 'Horas extra próximas', body: '{name} tendrá horas extra esta semana si trabaja todos sus turnos ({worked} h trabajadas + {scheduled} h programadas; horas extra después de {limit} h).' },
  'pay.ready': { title: 'Resumen de pago disponible', body: 'Tu resumen de pago del último periodo está listo.' },
  'msg.new': { title: 'Nuevo mensaje', body: 'Nuevo mensaje de {name}' },
  'ts.adjusted': { title: 'Se ajustaron tus horas', body: '{name} modificó una hoja de horas. Motivo: {text}' },
  'ts.rejected': { title: 'Hoja de horas por corregir', body: 'Se devolvió una hoja de horas para corregirla.' },
  'dispute.opened': { title: 'Hoja de horas en disputa', body: '{name} disputó una hoja de horas.' },
  'dispute.resolved': { title: 'Disputa resuelta', body: '{text}' },
  'dispute.declined': { title: 'Disputa rechazada', body: '{text}' },
  'req.swap': { title: 'Solicitud de cambio de turno', body: '{name} te pidió que tomes su turno.' },
  'req.pickup': { title: 'Solicitud de turno disponible', body: '{name} pidió trabajar un turno disponible.' },
  'req.drop': { title: 'Solicitud para dejar un turno', body: '{name} pidió dejar un turno.' },
  'req.swap_accepted': { title: 'Cambio aceptado', body: '{name} aceptó. Falta la aprobación del encargado.' },
  'req.swap_declined': { title: 'Cambio rechazado', body: '{name} rechazó el cambio.' },
  'req.swap_approve': { title: 'Cambio de turno por aprobar', body: 'Dos empleados acordaron cambiar un turno.' },
  'req.approved': { title: 'Solicitud aprobada', body: 'Tu horario se actualizó.' },
  'req.rejected': { title: 'Solicitud rechazada', body: 'Tu encargado rechazó la solicitud.' },
  'toff.requested': { title: 'Solicitud de días libres', body: '{name}: {from} → {to}' },
  'toff.approved': { title: 'Días libres aprobados', body: '{from} → {to}' },
  'toff.rejected': { title: 'Días libres rechazados', body: '{from} → {to}' },
  'safety.injury': { title: 'Lesión reportada', body: '{name}: {text}' },
  'safety.incident': { title: 'Incidente reportado', body: '{name}: {text}' },
  'safety.near_miss': { title: 'Casi accidente reportado', body: '{name}: {text}' },
  'safety.hazard': { title: 'Peligro reportado', body: '{name}: {text}' },
  'safety.talk': { title: 'Firma la charla de seguridad', body: '{text}' },
};

const fr: Record<MessageKey, Entry> = {
  'shift.new': { title: 'Nouveau quart', body: '{site} — {when}' },
  'shift.new_many': { title: 'Nouveaux quarts', body: '{site} — {count} quarts' },
  'shift.changed': { title: 'Quart modifié', body: '{site} — {when}' },
  'shift.cancelled': { title: 'Quart annulé', body: '{site} — {when}' },
  'shift.open': { title: 'Quart disponible', body: '{site} — {when} · {count} place(s)' },
  'shift.reminder': { title: 'Ton quart commence dans environ 1 heure', body: '{site}' },
  'att.review': { title: 'Présence à vérifier', body: 'Une présence a été signalée et doit être vérifiée.' },
  'att.late': { title: 'Employé non pointé', body: '{name} n’a pas pointé son arrivée à {site}.' },
  'att.late_self': { title: 'Tu n’as pas pointé', body: 'Ton quart à {site} est commencé.' },
  'att.out_self': { title: 'As-tu oublié de pointer ta sortie?', body: 'Tu es toujours pointé. Pointe ta sortie maintenant ou donne l’heure exacte à ton gestionnaire.' },
  'att.out': { title: 'Sortie non pointée', body: '{name} est toujours pointé après son quart.' },
  'att.no_show': { title: 'Absence', body: '{name} ne s’est pas présenté au quart à {site}.' },
  'ot.reached': { title: 'Heures supplémentaires atteintes', body: '{name} a travaillé {worked} h cette semaine (heures supplémentaires après {limit} h).' },
  'ot.projected': { title: 'Heures supplémentaires à venir', body: '{name} fera des heures supplémentaires cette semaine si tous ses quarts sont travaillés ({worked} h travaillées + {scheduled} h prévues; heures supplémentaires après {limit} h).' },
  'pay.ready': { title: 'Résumé de paie disponible', body: 'Ton résumé de paie de la dernière période est prêt.' },
  'msg.new': { title: 'Nouveau message', body: 'Nouveau message de {name}' },
  'ts.adjusted': { title: 'Tes heures ont été ajustées', body: '{name} a modifié une feuille de temps. Raison : {text}' },
  'ts.rejected': { title: 'Feuille de temps à corriger', body: 'Une feuille de temps a été renvoyée pour correction.' },
  'dispute.opened': { title: 'Feuille de temps contestée', body: '{name} a contesté une feuille de temps.' },
  'dispute.resolved': { title: 'Contestation résolue', body: '{text}' },
  'dispute.declined': { title: 'Contestation refusée', body: '{text}' },
  'req.swap': { title: 'Demande d’échange de quart', body: '{name} te demande de prendre son quart.' },
  'req.pickup': { title: 'Demande de quart disponible', body: '{name} veut travailler un quart disponible.' },
  'req.drop': { title: 'Demande pour céder un quart', body: '{name} veut céder un quart.' },
  'req.swap_accepted': { title: 'Échange accepté', body: '{name} a accepté. En attente de l’approbation du gestionnaire.' },
  'req.swap_declined': { title: 'Échange refusé', body: '{name} a refusé l’échange.' },
  'req.swap_approve': { title: 'Échange de quart à approuver', body: 'Deux employés ont accepté d’échanger un quart.' },
  'req.approved': { title: 'Demande approuvée', body: 'Ton horaire a été mis à jour.' },
  'req.rejected': { title: 'Demande refusée', body: 'Ton gestionnaire a refusé la demande.' },
  'toff.requested': { title: 'Demande de congé', body: '{name} : {from} → {to}' },
  'toff.approved': { title: 'Congé approuvé', body: '{from} → {to}' },
  'toff.rejected': { title: 'Congé refusé', body: '{from} → {to}' },
  'safety.injury': { title: 'Blessure signalée', body: '{name} : {text}' },
  'safety.incident': { title: 'Incident signalé', body: '{name} : {text}' },
  'safety.near_miss': { title: 'Quasi-accident signalé', body: '{name} : {text}' },
  'safety.hazard': { title: 'Danger signalé', body: '{name} : {text}' },
  'safety.talk': { title: 'Signe la causerie sécurité', body: '{text}' },
};

const pa: Record<MessageKey, Entry> = {
  'shift.new': { title: 'ਨਵੀਂ ਸ਼ਿਫਟ', body: '{site} — {when}' },
  'shift.new_many': { title: 'ਨਵੀਆਂ ਸ਼ਿਫਟਾਂ', body: '{site} — {count} ਸ਼ਿਫਟਾਂ' },
  'shift.changed': { title: 'ਸ਼ਿਫਟ ਬਦਲੀ ਗਈ', body: '{site} — {when}' },
  'shift.cancelled': { title: 'ਸ਼ਿਫਟ ਰੱਦ ਹੋ ਗਈ', body: '{site} — {when}' },
  'shift.open': { title: 'ਖਾਲੀ ਸ਼ਿਫਟ ਉਪਲਬਧ', body: '{site} — {when} · {count} ਖਾਲੀ' },
  'shift.reminder': { title: 'ਸ਼ਿਫਟ ਲਗਭਗ 1 ਘੰਟੇ ਵਿੱਚ ਸ਼ੁਰੂ', body: '{site}' },
  'att.review': { title: 'ਹਾਜ਼ਰੀ ਦੀ ਜਾਂਚ ਕਰੋ', body: 'ਇੱਕ ਹਾਜ਼ਰੀ ਰਿਕਾਰਡ ’ਤੇ ਨਿਸ਼ਾਨ ਲੱਗਾ ਹੈ ਅਤੇ ਤੁਹਾਡੀ ਜਾਂਚ ਚਾਹੀਦੀ ਹੈ।' },
  'att.late': { title: 'ਕਰਮਚਾਰੀ ਨੇ ਕਲੌਕ-ਇਨ ਨਹੀਂ ਕੀਤਾ', body: '{name} ਨੇ {site} ’ਤੇ ਕਲੌਕ-ਇਨ ਨਹੀਂ ਕੀਤਾ।' },
  'att.late_self': { title: 'ਤੁਸੀਂ ਕਲੌਕ-ਇਨ ਨਹੀਂ ਕੀਤਾ', body: '{site} ’ਤੇ ਤੁਹਾਡੀ ਸ਼ਿਫਟ ਸ਼ੁਰੂ ਹੋ ਗਈ ਹੈ।' },
  'att.out_self': { title: 'ਕੀ ਤੁਸੀਂ ਕਲੌਕ-ਆਊਟ ਕਰਨਾ ਭੁੱਲ ਗਏ?', body: 'ਤੁਸੀਂ ਅਜੇ ਵੀ ਕਲੌਕ-ਇਨ ਹੋ। ਹੁਣੇ ਕਲੌਕ-ਆਊਟ ਕਰੋ ਜਾਂ ਆਪਣੇ ਮੈਨੇਜਰ ਨੂੰ ਸਹੀ ਸਮਾਂ ਦੱਸੋ।' },
  'att.out': { title: 'ਕਲੌਕ-ਆਊਟ ਨਹੀਂ ਹੋਇਆ', body: '{name} ਸ਼ਿਫਟ ਤੋਂ ਬਾਅਦ ਵੀ ਕਲੌਕ-ਇਨ ਹੈ।' },
  'att.no_show': { title: 'ਗੈਰ-ਹਾਜ਼ਰ', body: '{name} {site} ਦੀ ਸ਼ਿਫਟ ਲਈ ਨਹੀਂ ਆਇਆ।' },
  'ot.reached': { title: 'ਓਵਰਟਾਈਮ ਸ਼ੁਰੂ', body: '{name} ਨੇ ਇਸ ਹਫ਼ਤੇ {worked} ਘੰਟੇ ਕੰਮ ਕੀਤਾ ({limit} ਘੰਟੇ ਤੋਂ ਬਾਅਦ ਓਵਰਟਾਈਮ)।' },
  'ot.projected': { title: 'ਓਵਰਟਾਈਮ ਆਉਣ ਵਾਲਾ ਹੈ', body: 'ਜੇ {name} ਸਾਰੀਆਂ ਸ਼ਿਫਟਾਂ ਕਰਦਾ ਹੈ ਤਾਂ ਇਸ ਹਫ਼ਤੇ ਓਵਰਟਾਈਮ ਹੋਵੇਗਾ ({worked} ਘੰਟੇ ਕੀਤੇ + {scheduled} ਘੰਟੇ ਸ਼ਡਿਊਲ; {limit} ਘੰਟੇ ਤੋਂ ਬਾਅਦ ਓਵਰਟਾਈਮ)।' },
  'pay.ready': { title: 'ਤਨਖਾਹ ਦਾ ਵੇਰਵਾ ਤਿਆਰ', body: 'ਪਿਛਲੇ ਪੀਰੀਅਡ ਦਾ ਤੁਹਾਡਾ ਤਨਖਾਹ ਵੇਰਵਾ ਤਿਆਰ ਹੈ।' },
  'msg.new': { title: 'ਨਵਾਂ ਸੁਨੇਹਾ', body: '{name} ਵੱਲੋਂ ਨਵਾਂ ਸੁਨੇਹਾ' },
  'ts.adjusted': { title: 'ਤੁਹਾਡੇ ਘੰਟੇ ਬਦਲੇ ਗਏ', body: '{name} ਨੇ ਟਾਈਮਸ਼ੀਟ ਬਦਲੀ। ਕਾਰਨ: {text}' },
  'ts.rejected': { title: 'ਟਾਈਮਸ਼ੀਟ ਠੀਕ ਕਰੋ', body: 'ਇੱਕ ਟਾਈਮਸ਼ੀਟ ਠੀਕ ਕਰਨ ਲਈ ਵਾਪਸ ਭੇਜੀ ਗਈ।' },
  'dispute.opened': { title: 'ਟਾਈਮਸ਼ੀਟ ’ਤੇ ਇਤਰਾਜ਼', body: '{name} ਨੇ ਟਾਈਮਸ਼ੀਟ ’ਤੇ ਇਤਰਾਜ਼ ਕੀਤਾ।' },
  'dispute.resolved': { title: 'ਇਤਰਾਜ਼ ਹੱਲ ਹੋਇਆ', body: '{text}' },
  'dispute.declined': { title: 'ਇਤਰਾਜ਼ ਨਾਮਨਜ਼ੂਰ', body: '{text}' },
  'req.swap': { title: 'ਸ਼ਿਫਟ ਬਦਲਣ ਦੀ ਬੇਨਤੀ', body: '{name} ਨੇ ਤੁਹਾਨੂੰ ਆਪਣੀ ਸ਼ਿਫਟ ਲੈਣ ਲਈ ਕਿਹਾ ਹੈ।' },
  'req.pickup': { title: 'ਖਾਲੀ ਸ਼ਿਫਟ ਦੀ ਬੇਨਤੀ', body: '{name} ਖਾਲੀ ਸ਼ਿਫਟ ’ਤੇ ਕੰਮ ਕਰਨਾ ਚਾਹੁੰਦਾ ਹੈ।' },
  'req.drop': { title: 'ਸ਼ਿਫਟ ਛੱਡਣ ਦੀ ਬੇਨਤੀ', body: '{name} ਇੱਕ ਸ਼ਿਫਟ ਛੱਡਣਾ ਚਾਹੁੰਦਾ ਹੈ।' },
  'req.swap_accepted': { title: 'ਬਦਲੀ ਮਨਜ਼ੂਰ', body: '{name} ਨੇ ਮਨਜ਼ੂਰ ਕੀਤਾ। ਮੈਨੇਜਰ ਦੀ ਮਨਜ਼ੂਰੀ ਦੀ ਉਡੀਕ।' },
  'req.swap_declined': { title: 'ਬਦਲੀ ਨਾਮਨਜ਼ੂਰ', body: '{name} ਨੇ ਬਦਲੀ ਤੋਂ ਨਾਂਹ ਕੀਤੀ।' },
  'req.swap_approve': { title: 'ਸ਼ਿਫਟ ਬਦਲੀ ਮਨਜ਼ੂਰ ਕਰੋ', body: 'ਦੋ ਕਰਮਚਾਰੀ ਸ਼ਿਫਟ ਬਦਲਣ ਲਈ ਰਾਜ਼ੀ ਹਨ।' },
  'req.approved': { title: 'ਬੇਨਤੀ ਮਨਜ਼ੂਰ', body: 'ਤੁਹਾਡਾ ਸ਼ਡਿਊਲ ਅੱਪਡੇਟ ਹੋ ਗਿਆ।' },
  'req.rejected': { title: 'ਬੇਨਤੀ ਨਾਮਨਜ਼ੂਰ', body: 'ਤੁਹਾਡੇ ਮੈਨੇਜਰ ਨੇ ਬੇਨਤੀ ਨਾਮਨਜ਼ੂਰ ਕੀਤੀ।' },
  'toff.requested': { title: 'ਛੁੱਟੀ ਦੀ ਬੇਨਤੀ', body: '{name}: {from} → {to}' },
  'toff.approved': { title: 'ਛੁੱਟੀ ਮਨਜ਼ੂਰ', body: '{from} → {to}' },
  'toff.rejected': { title: 'ਛੁੱਟੀ ਨਾਮਨਜ਼ੂਰ', body: '{from} → {to}' },
  'safety.injury': { title: 'ਸੱਟ ਦੀ ਰਿਪੋਰਟ', body: '{name}: {text}' },
  'safety.incident': { title: 'ਘਟਨਾ ਦੀ ਰਿਪੋਰਟ', body: '{name}: {text}' },
  'safety.near_miss': { title: 'ਹਾਦਸੇ ਤੋਂ ਬਚਾਅ ਦੀ ਰਿਪੋਰਟ', body: '{name}: {text}' },
  'safety.hazard': { title: 'ਖ਼ਤਰੇ ਦੀ ਰਿਪੋਰਟ', body: '{name}: {text}' },
  'safety.talk': { title: 'ਸੇਫਟੀ ਮੀਟਿੰਗ ’ਤੇ ਦਸਤਖ਼ਤ ਕਰੋ', body: '{text}' },
};

const hi: Record<MessageKey, Entry> = {
  'shift.new': { title: 'नई शिफ्ट', body: '{site} — {when}' },
  'shift.new_many': { title: 'नई शिफ्टें', body: '{site} — {count} शिफ्टें' },
  'shift.changed': { title: 'शिफ्ट बदली गई', body: '{site} — {when}' },
  'shift.cancelled': { title: 'शिफ्ट रद्द', body: '{site} — {when}' },
  'shift.open': { title: 'खाली शिफ्ट उपलब्ध', body: '{site} — {when} · {count} खाली' },
  'shift.reminder': { title: 'शिफ्ट लगभग 1 घंटे में शुरू', body: '{site}' },
  'att.review': { title: 'हाज़िरी जाँचें', body: 'एक हाज़िरी रिकॉर्ड पर निशान लगा है और आपकी जाँच चाहिए।' },
  'att.late': { title: 'कर्मचारी ने क्लॉक-इन नहीं किया', body: '{name} ने {site} पर क्लॉक-इन नहीं किया।' },
  'att.late_self': { title: 'आपने क्लॉक-इन नहीं किया', body: '{site} पर आपकी शिफ्ट शुरू हो गई है।' },
  'att.out_self': { title: 'क्या आप क्लॉक-आउट करना भूल गए?', body: 'आप अभी भी क्लॉक-इन हैं। अभी क्लॉक-आउट करें या अपने मैनेजर को सही समय बताएँ।' },
  'att.out': { title: 'क्लॉक-आउट नहीं हुआ', body: '{name} शिफ्ट के बाद भी क्लॉक-इन है।' },
  'att.no_show': { title: 'गैरहाज़िर', body: '{name} {site} की शिफ्ट पर नहीं आया।' },
  'ot.reached': { title: 'ओवरटाइम शुरू', body: '{name} ने इस हफ़्ते {worked} घंटे काम किया ({limit} घंटे के बाद ओवरटाइम)।' },
  'ot.projected': { title: 'ओवरटाइम आने वाला है', body: 'अगर {name} सभी शिफ्टें करता है तो इस हफ़्ते ओवरटाइम होगा ({worked} घंटे किए + {scheduled} घंटे तय; {limit} घंटे के बाद ओवरटाइम)।' },
  'pay.ready': { title: 'वेतन सारांश तैयार', body: 'पिछली अवधि का आपका वेतन सारांश तैयार है।' },
  'msg.new': { title: 'नया संदेश', body: '{name} से नया संदेश' },
  'ts.adjusted': { title: 'आपके घंटे बदले गए', body: '{name} ने टाइमशीट बदली। कारण: {text}' },
  'ts.rejected': { title: 'टाइमशीट ठीक करें', body: 'एक टाइमशीट सुधार के लिए वापस भेजी गई।' },
  'dispute.opened': { title: 'टाइमशीट पर आपत्ति', body: '{name} ने टाइमशीट पर आपत्ति की।' },
  'dispute.resolved': { title: 'आपत्ति सुलझी', body: '{text}' },
  'dispute.declined': { title: 'आपत्ति अस्वीकार', body: '{text}' },
  'req.swap': { title: 'शिफ्ट बदलने का अनुरोध', body: '{name} ने आपसे उनकी शिफ्ट लेने को कहा है।' },
  'req.pickup': { title: 'खाली शिफ्ट का अनुरोध', body: '{name} खाली शिफ्ट पर काम करना चाहता है।' },
  'req.drop': { title: 'शिफ्ट छोड़ने का अनुरोध', body: '{name} एक शिफ्ट छोड़ना चाहता है।' },
  'req.swap_accepted': { title: 'बदलाव स्वीकार', body: '{name} ने स्वीकार किया। मैनेजर की मंज़ूरी बाकी है।' },
  'req.swap_declined': { title: 'बदलाव अस्वीकार', body: '{name} ने बदलाव से मना किया।' },
  'req.swap_approve': { title: 'शिफ्ट बदलाव मंज़ूर करें', body: 'दो कर्मचारी शिफ्ट बदलने को राज़ी हैं।' },
  'req.approved': { title: 'अनुरोध मंज़ूर', body: 'आपका शेड्यूल अपडेट हो गया।' },
  'req.rejected': { title: 'अनुरोध अस्वीकार', body: 'आपके मैनेजर ने अनुरोध अस्वीकार किया।' },
  'toff.requested': { title: 'छुट्टी का अनुरोध', body: '{name}: {from} → {to}' },
  'toff.approved': { title: 'छुट्टी मंज़ूर', body: '{from} → {to}' },
  'toff.rejected': { title: 'छुट्टी अस्वीकार', body: '{from} → {to}' },
  'safety.injury': { title: 'चोट की रिपोर्ट', body: '{name}: {text}' },
  'safety.incident': { title: 'घटना की रिपोर्ट', body: '{name}: {text}' },
  'safety.near_miss': { title: 'बाल-बाल बचे की रिपोर्ट', body: '{name}: {text}' },
  'safety.hazard': { title: 'ख़तरे की रिपोर्ट', body: '{name}: {text}' },
  'safety.talk': { title: 'सेफ़्टी मीटिंग पर हस्ताक्षर करें', body: '{text}' },
};

const gu: Record<MessageKey, Entry> = {
  'shift.new': { title: 'નવી શિફ્ટ', body: '{site} — {when}' },
  'shift.new_many': { title: 'નવી શિફ્ટો', body: '{site} — {count} શિફ્ટો' },
  'shift.changed': { title: 'શિફ્ટ બદલાઈ', body: '{site} — {when}' },
  'shift.cancelled': { title: 'શિફ્ટ રદ', body: '{site} — {when}' },
  'shift.open': { title: 'ખાલી શિફ્ટ ઉપલબ્ધ', body: '{site} — {when} · {count} ખાલી' },
  'shift.reminder': { title: 'શિફ્ટ લગભગ 1 કલાકમાં શરૂ', body: '{site}' },
  'att.review': { title: 'હાજરી તપાસો', body: 'એક હાજરી રેકોર્ડ પર નિશાન લાગ્યું છે અને તમારી તપાસ જોઈએ છે.' },
  'att.late': { title: 'કર્મચારીએ ક્લોક-ઇન કર્યું નથી', body: '{name} એ {site} પર ક્લોક-ઇન કર્યું નથી.' },
  'att.late_self': { title: 'તમે ક્લોક-ઇન કર્યું નથી', body: '{site} પર તમારી શિફ્ટ શરૂ થઈ ગઈ છે.' },
  'att.out_self': { title: 'શું તમે ક્લોક-આઉટ કરવાનું ભૂલી ગયા?', body: 'તમે હજુ ક્લોક-ઇન છો. હમણાં ક્લોક-આઉટ કરો અથવા તમારા મેનેજરને સાચો સમય જણાવો.' },
  'att.out': { title: 'ક્લોક-આઉટ બાકી', body: '{name} શિફ્ટ પછી પણ ક્લોક-ઇન છે.' },
  'att.no_show': { title: 'ગેરહાજર', body: '{name} {site} ની શિફ્ટમાં આવ્યા નથી.' },
  'ot.reached': { title: 'ઓવરટાઇમ શરૂ', body: '{name} એ આ અઠવાડિયે {worked} કલાક કામ કર્યું ({limit} કલાક પછી ઓવરટાઇમ).' },
  'ot.projected': { title: 'ઓવરટાઇમ આવી રહ્યો છે', body: 'જો {name} બધી શિફ્ટ કરે તો આ અઠવાડિયે ઓવરટાઇમ થશે ({worked} કલાક કર્યા + {scheduled} કલાક નક્કી; {limit} કલાક પછી ઓવરટાઇમ).' },
  'pay.ready': { title: 'પગાર સારાંશ તૈયાર', body: 'છેલ્લા સમયગાળાનો તમારો પગાર સારાંશ તૈયાર છે.' },
  'msg.new': { title: 'નવો સંદેશ', body: '{name} તરફથી નવો સંદેશ' },
  'ts.adjusted': { title: 'તમારા કલાકો બદલાયા', body: '{name} એ ટાઇમશીટ બદલી. કારણ: {text}' },
  'ts.rejected': { title: 'ટાઇમશીટ સુધારો', body: 'એક ટાઇમશીટ સુધારા માટે પાછી મોકલવામાં આવી.' },
  'dispute.opened': { title: 'ટાઇમશીટ પર વાંધો', body: '{name} એ ટાઇમશીટ પર વાંધો ઉઠાવ્યો.' },
  'dispute.resolved': { title: 'વાંધો ઉકેલાયો', body: '{text}' },
  'dispute.declined': { title: 'વાંધો નામંજૂર', body: '{text}' },
  'req.swap': { title: 'શિફ્ટ બદલવાની વિનંતી', body: '{name} એ તમને તેમની શિફ્ટ લેવા કહ્યું છે.' },
  'req.pickup': { title: 'ખાલી શિફ્ટની વિનંતી', body: '{name} ખાલી શિફ્ટમાં કામ કરવા માંગે છે.' },
  'req.drop': { title: 'શિફ્ટ છોડવાની વિનંતી', body: '{name} એક શિફ્ટ છોડવા માંગે છે.' },
  'req.swap_accepted': { title: 'બદલી સ્વીકારી', body: '{name} એ સ્વીકાર્યું. મેનેજરની મંજૂરી બાકી છે.' },
  'req.swap_declined': { title: 'બદલી નામંજૂર', body: '{name} એ બદલીની ના પાડી.' },
  'req.swap_approve': { title: 'શિફ્ટ બદલી મંજૂર કરો', body: 'બે કર્મચારીઓ શિફ્ટ બદલવા સંમત થયા છે.' },
  'req.approved': { title: 'વિનંતી મંજૂર', body: 'તમારું શેડ્યૂલ અપડેટ થયું.' },
  'req.rejected': { title: 'વિનંતી નામંજૂર', body: 'તમારા મેનેજરે વિનંતી નામંજૂર કરી.' },
  'toff.requested': { title: 'રજાની વિનંતી', body: '{name}: {from} → {to}' },
  'toff.approved': { title: 'રજા મંજૂર', body: '{from} → {to}' },
  'toff.rejected': { title: 'રજા નામંજૂર', body: '{from} → {to}' },
  'safety.injury': { title: 'ઈજાનો રિપોર્ટ', body: '{name}: {text}' },
  'safety.incident': { title: 'ઘટનાનો રિપોર્ટ', body: '{name}: {text}' },
  'safety.near_miss': { title: 'અકસ્માત ટળ્યાનો રિપોર્ટ', body: '{name}: {text}' },
  'safety.hazard': { title: 'જોખમનો રિપોર્ટ', body: '{name}: {text}' },
  'safety.talk': { title: 'સેફ્ટી મીટિંગ પર સહી કરો', body: '{text}' },
};

const DICTS: Record<Locale, Record<MessageKey, Entry>> = { en, 'es-MX': es, 'fr-CA': fr, pa, hi, gu };

/** Email wording around every message. */
const EMAIL: Record<Locale, Record<'open' | 'copy' | 'footer' | 'invite_subject' | 'invite_title' | 'invite_body' | 'invite_expires' | 'invite_cta' | 'role_admin' | 'role_manager' | 'role_supervisor' | 'role_payroll' | 'role_employee', string>> = {
  en: {
    open: 'Open Blue Collar', copy: 'Or copy this link:', footer: 'You received this email because of activity on your Blue Collar account. If this wasn’t you, you can ignore it.',
    invite_subject: 'You’re invited to join {company} on Blue Collar', invite_title: '{inviter} invited you to {company}', invite_body: 'You’ve been invited to join {company} as {role}.',
    invite_expires: 'This invitation expires on {when}.', invite_cta: 'Accept invitation',
    role_admin: 'Administrator', role_manager: 'Manager', role_supervisor: 'Supervisor', role_payroll: 'Payroll', role_employee: 'Employee',
  },
  'es-MX': {
    open: 'Abrir Blue Collar', copy: 'O copia este enlace:', footer: 'Recibiste este correo por actividad en tu cuenta de Blue Collar. Si no fuiste tú, puedes ignorarlo.',
    invite_subject: 'Te invitaron a unirte a {company} en Blue Collar', invite_title: '{inviter} te invitó a {company}', invite_body: 'Te invitaron a unirte a {company} como {role}.',
    invite_expires: 'Esta invitación vence el {when}.', invite_cta: 'Aceptar invitación',
    role_admin: 'Administrador', role_manager: 'Encargado', role_supervisor: 'Supervisor', role_payroll: 'Nómina', role_employee: 'Empleado',
  },
  'fr-CA': {
    open: 'Ouvrir Blue Collar', copy: 'Ou copie ce lien :', footer: 'Tu reçois ce courriel à cause d’une activité dans ton compte Blue Collar. Si ce n’était pas toi, tu peux l’ignorer.',
    invite_subject: 'Invitation à joindre {company} sur Blue Collar', invite_title: '{inviter} t’invite à joindre {company}', invite_body: 'Tu es invité à joindre {company} comme {role}.',
    invite_expires: 'Cette invitation expire le {when}.', invite_cta: 'Accepter l’invitation',
    role_admin: 'Administrateur', role_manager: 'Gestionnaire', role_supervisor: 'Superviseur', role_payroll: 'Paie', role_employee: 'Employé',
  },
  pa: {
    open: 'Blue Collar ਖੋਲ੍ਹੋ', copy: 'ਜਾਂ ਇਹ ਲਿੰਕ ਕਾਪੀ ਕਰੋ:', footer: 'ਤੁਹਾਨੂੰ ਇਹ ਈਮੇਲ ਤੁਹਾਡੇ Blue Collar ਖਾਤੇ ਦੀ ਗਤੀਵਿਧੀ ਕਰਕੇ ਮਿਲੀ ਹੈ। ਜੇ ਇਹ ਤੁਸੀਂ ਨਹੀਂ ਸੀ, ਤਾਂ ਇਸਨੂੰ ਨਜ਼ਰਅੰਦਾਜ਼ ਕਰ ਸਕਦੇ ਹੋ।',
    invite_subject: 'ਤੁਹਾਨੂੰ Blue Collar ’ਤੇ {company} ਵਿੱਚ ਸ਼ਾਮਲ ਹੋਣ ਦਾ ਸੱਦਾ', invite_title: '{inviter} ਨੇ ਤੁਹਾਨੂੰ {company} ਵਿੱਚ ਸੱਦਾ ਦਿੱਤਾ', invite_body: 'ਤੁਹਾਨੂੰ {company} ਵਿੱਚ {role} ਵਜੋਂ ਸ਼ਾਮਲ ਹੋਣ ਦਾ ਸੱਦਾ ਹੈ।',
    invite_expires: 'ਇਹ ਸੱਦਾ {when} ਨੂੰ ਖ਼ਤਮ ਹੋ ਜਾਵੇਗਾ।', invite_cta: 'ਸੱਦਾ ਮਨਜ਼ੂਰ ਕਰੋ',
    role_admin: 'ਐਡਮਿਨ', role_manager: 'ਮੈਨੇਜਰ', role_supervisor: 'ਸੁਪਰਵਾਈਜ਼ਰ', role_payroll: 'ਪੇਰੋਲ', role_employee: 'ਕਰਮਚਾਰੀ',
  },
  hi: {
    open: 'Blue Collar खोलें', copy: 'या यह लिंक कॉपी करें:', footer: 'आपको यह ईमेल आपके Blue Collar खाते की गतिविधि के कारण मिला है। अगर यह आप नहीं थे, तो इसे अनदेखा कर सकते हैं।',
    invite_subject: 'आपको Blue Collar पर {company} से जुड़ने का निमंत्रण', invite_title: '{inviter} ने आपको {company} में आमंत्रित किया', invite_body: 'आपको {company} में {role} के रूप में जुड़ने का निमंत्रण है।',
    invite_expires: 'यह निमंत्रण {when} को समाप्त होगा।', invite_cta: 'निमंत्रण स्वीकार करें',
    role_admin: 'एडमिन', role_manager: 'मैनेजर', role_supervisor: 'सुपरवाइज़र', role_payroll: 'पेरोल', role_employee: 'कर्मचारी',
  },
  gu: {
    open: 'Blue Collar ખોલો', copy: 'અથવા આ લિંક કૉપિ કરો:', footer: 'તમારા Blue Collar એકાઉન્ટની પ્રવૃત્તિને કારણે તમને આ ઇમેઇલ મળ્યો છે. જો આ તમે ન હતા, તો તેને અવગણી શકો છો.',
    invite_subject: 'તમને Blue Collar પર {company} માં જોડાવાનું આમંત્રણ', invite_title: '{inviter} એ તમને {company} માં આમંત્રિત કર્યા', invite_body: 'તમને {company} માં {role} તરીકે જોડાવાનું આમંત્રણ છે.',
    invite_expires: 'આ આમંત્રણ {when} ના રોજ પૂરું થશે.', invite_cta: 'આમંત્રણ સ્વીકારો',
    role_admin: 'એડમિન', role_manager: 'મેનેજર', role_supervisor: 'સુપરવાઇઝર', role_payroll: 'પેરોલ', role_employee: 'કર્મચારી',
  },
};

export function normalizeLocale(l: string | null | undefined): Locale {
  if (!l) return 'en';
  if ((LOCALES as readonly string[]).includes(l)) return l as Locale;
  const base = l.split('-')[0];
  if (base === 'es') return 'es-MX';
  if (base === 'fr') return 'fr-CA';
  return (LOCALES as readonly string[]).includes(base ?? '') ? (base as Locale) : 'en';
}

export type Vars = Record<string, string | number | { date: string }>;

/** Intl locale tag for dates (Punjabi in Gurmukhi script, India for Hindi/Gujarati digits). */
const INTL: Record<Locale, string> = { en: 'en-CA', 'es-MX': 'es-MX', 'fr-CA': 'fr-CA', pa: 'pa-Guru-IN', hi: 'hi-IN', gu: 'gu-IN' };

export function formatDate(iso: string, locale: Locale, timeZone = 'UTC') {
  try {
    return new Intl.DateTimeFormat(INTL[locale], { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}

function fill(s: string, vars: Vars, locale: Locale, timeZone: string) {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return formatDate(v.date, locale, timeZone);
    return String(v);
  });
}

export function render(key: MessageKey, vars: Vars, locale: Locale, timeZone = 'UTC'): Entry {
  const e = DICTS[locale][key] ?? en[key];
  return { title: fill(e.title, vars, locale, timeZone), body: fill(e.body, vars, locale, timeZone) };
}

export function emailText(locale: Locale, key: keyof (typeof EMAIL)['en'], vars: Vars = {}, timeZone = 'UTC') {
  return fill(EMAIL[locale][key], vars, locale, timeZone);
}

export const HTML_LANG: Record<Locale, string> = { en: 'en', 'es-MX': 'es-MX', 'fr-CA': 'fr-CA', pa: 'pa', hi: 'hi', gu: 'gu' };
