import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {_} from './i18n.js';

export function dbusCall(name, path, interfaceName, method, parameters = null, replyType = null) {
    return new Promise((resolve, reject) => Gio.DBus.session.call(name, path, interfaceName, method,
        parameters, replyType, Gio.DBusCallFlags.NONE, -1, null, (connection, result) => {
            try { resolve(connection.call_finish(result)); } catch (error) { reject(error); }
        }));
}

// Drive whichever MPRIS player is most relevant: prefer a Playing one, then a
// Paused one, then the first available. Returns a localized notification.
export async function mprisControl(method) {
    const reply = await dbusCall('org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', 'ListNames', null, new GLib.VariantType('(as)'));
    const players = reply.deepUnpack()[0].filter(name => name.startsWith('org.mpris.MediaPlayer2.')).sort();
    if (!players.length) throw new Error(_('No active media player found'));
    const states = [];
    for (const name of players) {
        try {
            const stateReply = await dbusCall(name, '/org/mpris/MediaPlayer2',
                'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'PlaybackStatus']),
                new GLib.VariantType('(v)'));
            const unpacked = stateReply.deepUnpack()[0];
            states.push({name, status: unpacked?.deepUnpack?.() ?? unpacked});
        } catch (_error) { states.push({name, status: 'Stopped'}); }
    }
    const player = states.find(item => item.status === 'Playing')
        ?? states.find(item => item.status === 'Paused') ?? states[0];
    await dbusCall(player.name, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', method);
    return {notification: method === 'Next' ? _('Next track') : method === 'Previous' ? _('Previous track') : _('Playback toggled')};
}
