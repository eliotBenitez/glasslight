import {_, format} from './i18n.js';

export function integerValue(text, label, minimum, maximum, fallback = null) {
    const source = text.trim() || (fallback === null ? '' : String(fallback));
    if (!/^-?\d+$/.test(source)) throw new Error(format(_('%s: enter an integer'), label));
    const value = Number(source);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
        throw new Error(format(_('%s: allowed from %d to %d'), label, minimum, maximum));
    return value;
}

export function durationValue(text) {
    const source = text.trim().toLocaleLowerCase().replaceAll(',', '.');
    if (!source) throw new Error(_('Enter a timer duration'));
    let seconds = 0;
    if (/^\d+(?::\d{1,2}){1,2}$/.test(source)) {
        const parts = source.split(':').map(Number);
        seconds = parts.length === 2 ? parts[0] * 60 + parts[1]
            : parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (/^\d+(?:\.\d+)?$/.test(source)) {
        seconds = Number(source) * 60;
    } else {
        const unit = /^(d|day|days|\u0434|\u0434\u043d|\u0434\u0435\u043d\u044c|\u0434\u043d\u044f|\u0434\u043d\u0435\u0439|h|hr|hour|hours|\u0447|\u0447\u0430\u0441|\u0447\u0430\u0441\u0430|\u0447\u0430\u0441\u043e\u0432|m|min|mins|minute|minutes|\u043c|\u043c\u0438\u043d|\u043c\u0438\u043d\u0443\u0442\u0430|\u043c\u0438\u043d\u0443\u0442\u044b|\u043c\u0438\u043d\u0443\u0442|s|sec|secs|second|seconds|\u0441|\u0441\u0435\u043a|\u0441\u0435\u043a\u0443\u043d\u0434\u0430|\u0441\u0435\u043a\u0443\u043d\u0434\u044b|\u0441\u0435\u043a\u0443\u043d\u0434)$/;
        const factor = value => value.startsWith('d') || value.startsWith('\u0434') ? 86400
            : value.startsWith('h') || value.startsWith('\u0447') ? 3600
                : value.startsWith('m') || value.startsWith('\u043c') ? 60 : 1;
        const token = /(\d+(?:\.\d+)?)\s*([\p{L}]+)/gu;
        let consumed = '';
        for (const match of source.matchAll(token)) {
            if (!unit.test(match[2])) throw new Error(format(_('Unknown unit «%s»'), match[2]));
            seconds += Number(match[1]) * factor(match[2]);
            consumed += match[0];
        }
        const compact = source.replace(/\s+/g, '');
        if (!consumed || consumed.replace(/\s+/g, '') !== compact)
            throw new Error(_('Duration example: 10 min, 1h 30m or 05:00'));
    }
    seconds = Math.round(seconds);
    if (seconds < 1 || seconds > 7 * 86400)
        throw new Error(_('A timer can last from 1 second to 7 days'));
    return seconds;
}

export function durationLabel(seconds) {
    const parts = [];
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds % 86400 / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const rest = seconds % 60;
    if (days) parts.push(format(_('%d d'), days));
    if (hours) parts.push(format(_('%d h'), hours));
    if (minutes) parts.push(format(_('%d min'), minutes));
    if (rest || !parts.length) parts.push(format(_('%d sec'), rest));
    return parts.join(' ');
}

export function alarmValue(text, now = new Date()) {
    const match = text.trim().match(/^(\d{1,2})[:.](\d{2})$/);
    if (!match) throw new Error(_('Enter a time as HH:MM'));
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) throw new Error(_('Invalid alarm time'));
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return {seconds: Math.max(1, Math.ceil((target - now) / 1000)),
        label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`};
}

export function changedCase(text, mode) {
    if (mode === 'upper') return text.toLocaleUpperCase();
    if (mode === 'lower') return text.toLocaleLowerCase();
    if (mode === 'title') return text.toLocaleLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu,
        (_match, prefix, letter) => prefix + letter.toLocaleUpperCase());
    throw new Error(_('Unknown case variant'));
}
