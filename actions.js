import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {alarmValue, changedCase, durationLabel, durationValue, integerValue} from './actionUtils.js';
import {fold} from './search.js';
import {randomInteger, password} from './random.js';
import {mprisControl} from './mpris.js';
import {_, format} from './i18n.js';

// Match a leading quick-key ("timer 10m", "rn 1 6") to an action, returning the
// remaining words as positional arguments. Pure string matching.
export function quickAction(text, actions) {
    const parts = text.trim().split(/\s+/);
    if (!parts[0]) return null;
    const key = fold(parts.shift());
    const action = actions.find(candidate => candidate.quickKeys?.includes(key));
    return action ? {action, args: parts} : null;
}

// Build the action catalogue fresh on each render (titles such as Do Not Disturb
// depend on live settings). `ctx` supplies the launcher-owned side effects that
// cannot be expressed as pure helpers:
//   notifications          – org.gnome.desktop.notifications Gio.Settings
//   scheduleNotification   – (seconds, title, body) => void
//   cancelClipboardRead    – abort an in-flight clipboard transfer
//   clearClipboard         – drop the launcher's local clipboard history
export function buildActions(ctx) {
    const integer = (text, label, minimum, maximum, fallback = null) =>
        integerValue(text, label, minimum, maximum, fallback);
    return [
        {id: 'random-number', title: _('Random number'), quickKeys: ['rn'],
            keywords: _('random number generator'), detail: _('Pick a number between a minimum and maximum'),
            fallback: 'view-refresh-symbolic',
            params: [
                {id: 'minimum', label: _('Minimum value'), hint: _('Minimum · default 1'),
                    parse: text => integer(text, _('Minimum'), -1000000000, 1000000000, 1)},
                {id: 'maximum', label: _('Maximum value'), hint: _('Maximum · default 100'),
                    parse: (text, values) => {
                        const value = integer(text, _('Maximum'), -1000000000, 1000000000, 100);
                        if (value < values.minimum) throw new Error(_('Maximum must be at least the minimum'));
                        return value;
                    }},
            ],
            quickValues: args => ({minimum: args[0], maximum: args[1]}),
            run: values => ({value: String(randomInteger(values.minimum, values.maximum)),
                detail: format(_('Random number from %d to %d'), values.minimum, values.maximum)})},
        {id: 'timer', title: _('Start a timer'), quickKeys: ['timer'],
            keywords: _('timer countdown'), detail: _('Notify when the countdown ends'),
            fallback: 'alarm-symbolic',
            params: [{id: 'duration', label: _('Duration'), hint: _('For example: 10 min, 1h 30m or 05:00'),
                parse: durationValue}],
            quickValues: args => ({duration: args.join(' ')}),
            run: values => {
                const duration = durationLabel(values.duration);
                ctx.scheduleNotification(values.duration, _('Timer finished'), format(_('%s elapsed'), duration));
                return {notification: format(_('Timer set for %s'), duration)};
            }},
        {id: 'alarm', title: _('Set an alarm'), quickKeys: ['alarm'],
            keywords: _('alarm clock'), detail: _('Notify at a specific time'),
            fallback: 'preferences-system-time-symbolic',
            params: [{id: 'time', label: _('Alarm time'), hint: _('Time as HH:MM'), parse: alarmValue}],
            quickValues: args => ({time: args.join(' ')}),
            run: values => {
                ctx.scheduleNotification(values.time.seconds, _('Alarm'), format(_('It is now %s'), values.time.label));
                return {notification: format(_('Alarm set for %s'), values.time.label)};
            }},
        {id: 'coin', title: _('Flip a coin'), quickKeys: ['coin'],
            keywords: _('coin flip'), detail: _('Randomly pick one of two sides'),
            fallback: 'media-playlist-shuffle-symbolic', params: [],
            run: () => ({value: randomInteger(0, 1) ? _('Heads') : _('Tails'), detail: _('Coin flip result')})},
        {id: 'dice', title: _('Roll a die'), quickKeys: ['dice'],
            keywords: _('dice roll'), detail: _('Roll a die with a chosen number of sides'),
            fallback: 'media-playlist-shuffle-symbolic',
            params: [{id: 'sides', label: _('Number of sides'), hint: _('Sides · default 6'),
                parse: text => integer(text, _('Number of sides'), 2, 1000, 6)}],
            quickValues: args => ({sides: args[0]}),
            run: values => ({value: String(randomInteger(1, values.sides)), detail: format(_('d%d roll'), values.sides)})},
        {id: 'password', title: _('Generate a password'), quickKeys: ['pass'],
            keywords: _('password generate'), detail: _('Create a password of letters, digits and symbols'),
            fallback: 'dialog-password-symbolic',
            params: [{id: 'length', label: _('Password length'), hint: _('From 4 to 128 characters · default 16'),
                parse: text => integer(text, _('Password length'), 4, 128, 16)}],
            quickValues: args => ({length: args[0]}),
            run: values => ({value: password(values.length), detail: format(_('%d characters · Enter — copy'), values.length)})},
        {id: 'uuid', title: _('Generate a UUID'), quickKeys: ['uuid'],
            keywords: _('uuid guid identifier'), detail: _('Create a random UUID v4'),
            fallback: 'insert-link-symbolic', params: [],
            run: () => ({value: GLib.uuid_string_random(), detail: _('UUID v4 · Enter — copy')})},
        {id: 'change-case', title: _('Change text case'), quickKeys: ['case'],
            keywords: _('change case uppercase lowercase title'), detail: _('Process typed or copied text'),
            fallback: 'format-text-bold-symbolic',
            params: [
                {id: 'case', label: _('Case variant'), hint: _('Choose a variant'),
                    choices: [
                        {value: 'upper', title: _('UPPERCASE'), detail: 'UPPERCASE'},
                        {value: 'lower', title: _('lowercase'), detail: 'lowercase'},
                        {value: 'title', title: _('Title Case'), detail: 'Title Case'},
                    ],
                    parse: text => {
                        const value = fold(text);
                        // Accept both English and Russian keywords regardless of the
                        // active locale so quick-typed variants keep working.
                        const aliases = {upper: 'upper', uppercase: 'upper', 'верхний': 'upper', lower: 'lower',
                            lowercase: 'lower', 'нижний': 'lower', title: 'title', 'заглавные': 'title'};
                        if (!aliases[value]) throw new Error(_('Choose a case variant'));
                        return aliases[value];
                    }},
                {id: 'text', label: _('Text'), hint: _('Enter text or use the clipboard contents'),
                    prefillClipboard: true, parse: text => {
                        if (!text.length) throw new Error(_('Enter text to process'));
                        return text;
                    }},
            ],
            quickValues: args => ({case: args[0], text: args.slice(1).join(' ')}),
            run: values => ({value: changedCase(values.text, values.case), detail: _('Converted text · Enter — copy')})},
        {id: 'dnd', title: ctx.notifications.get_boolean('show-banners') ? _('Turn on Do Not Disturb') : _('Turn off Do Not Disturb'),
            quickKeys: ['dnd'], keywords: _('dnd do not disturb notifications'),
            detail: ctx.notifications.get_boolean('show-banners') ? _('Hide notification banners') : _('Show notification banners again'),
            fallback: 'notifications-disabled-symbolic', params: [], run: () => {
                const enabled = ctx.notifications.get_boolean('show-banners');
                ctx.notifications.set_boolean('show-banners', !enabled);
                return {notification: enabled ? _('Do Not Disturb enabled') : _('Do Not Disturb disabled')};
            }},
        {id: 'media-play', title: _('Play / pause'), quickKeys: ['play'],
            keywords: _('media play pause'), detail: _('Control the active MPRIS player'),
            fallback: 'media-playback-start-symbolic', params: [], run: () => mprisControl('PlayPause')},
        {id: 'media-next', title: _('Next track'), quickKeys: ['next'],
            keywords: _('media next track'), detail: _('Skip to the next track'),
            fallback: 'media-skip-forward-symbolic', params: [], run: () => mprisControl('Next')},
        {id: 'media-previous', title: _('Previous track'), quickKeys: ['prev'],
            keywords: _('media previous track'), detail: _('Return to the previous track'),
            fallback: 'media-skip-backward-symbolic', params: [], run: () => mprisControl('Previous')},
        {id: 'copy-date', title: _('Copy the date'), quickKeys: ['date'],
            keywords: _('date today'), detail: _('Current date in the system format'),
            fallback: 'x-office-calendar-symbolic', params: [],
            run: () => ({value: new Intl.DateTimeFormat(undefined, {dateStyle: 'full'}).format(new Date()),
                detail: _('Current date · Enter — copy')})},
        {id: 'copy-time', title: _('Copy the time'), quickKeys: ['time'],
            keywords: _('time now'), detail: _('Current time in the system format'),
            fallback: 'preferences-system-time-symbolic', params: [],
            run: () => ({value: new Intl.DateTimeFormat(undefined, {timeStyle: 'medium'}).format(new Date()),
                detail: _('Current time · Enter — copy')})},
        {id: 'clear-clipboard', title: _('Clear the clipboard'), quickKeys: ['clipclear'],
            keywords: _('clear clipboard'), detail: _('Remove the system clipboard and local history'),
            fallback: 'edit-clear-all-symbolic', params: [], run: () => {
                ctx.cancelClipboardRead();
                ctx.clearClipboard();
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, '');
                return {notification: _('Clipboard cleared')};
            }},
        {id: 'settings', title: _('System settings'), quickKeys: ['settings'],
            keywords: _('settings preferences'), detail: _('Open GNOME settings'), fallback: 'emblem-system-symbolic',
            params: [], closeBeforeRun: true, run: () => {
                const app = GioUnix.DesktopAppInfo.new('org.gnome.Settings.desktop');
                if (!app) throw new Error(_('The Settings app was not found'));
                app.launch([], global.create_app_launch_context(0, -1));
            }},
        {id: 'screenshot', title: _('Screenshot'), quickKeys: ['shot'], keywords: _('screenshot capture'),
            detail: _('Open the area selector'), fallback: 'camera-photo-symbolic', params: [], closeBeforeRun: true,
            run: () => Main.screenshotUI.open()},
        {id: 'show-apps', title: _('Show applications'), quickKeys: ['apps'], keywords: _('apps overview'),
            detail: _('GNOME app grid'), fallback: 'view-app-grid-symbolic', params: [], closeBeforeRun: true,
            run: () => Main.overview.showApps()},
        {id: 'home', title: _('Home folder'), quickKeys: ['home'], keywords: _('home files'),
            detail: _('Open the file manager'), fallback: 'user-home-symbolic', params: [], closeBeforeRun: true,
            run: () => Gio.AppInfo.launch_default_for_uri(
                Gio.File.new_for_path(GLib.get_home_dir()).get_uri(), global.create_app_launch_context(0, -1))},
        {id: 'lock', title: _('Lock the screen'), quickKeys: ['lock'], keywords: _('lock screen'),
            detail: _('Lock the current session'), fallback: 'system-lock-screen-symbolic', params: [], closeBeforeRun: true,
            run: () => Main.screenShield.lock(true)},
    ];
}
