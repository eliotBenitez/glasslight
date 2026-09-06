import Gio from 'gi://Gio';
import {_} from './i18n.js';

// Rejection-sampled randomness drawn from /dev/urandom so generated numbers and
// passwords are unbiased and never fall back to Math.random.
export function secureBytes(count) {
    const stream = Gio.File.new_for_path('/dev/urandom').read(null);
    const output = [];
    try {
        while (output.length < count) {
            const bytes = stream.read_bytes(count - output.length, null).toArray();
            if (!bytes.length) throw new Error(_('Could not obtain random data'));
            output.push(...bytes);
        }
    } finally { stream.close(null); }
    return output;
}

export function randomInteger(minimum, maximum) {
    const span = maximum - minimum + 1;
    const limit = Math.floor(0x100000000 / span) * span;
    while (true) {
        const bytes = secureBytes(4);
        const value = bytes[0] * 0x1000000 + bytes[1] * 0x10000 + bytes[2] * 0x100 + bytes[3];
        if (value < limit) return minimum + value % span;
    }
}

export function password(length) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-=?';
    const limit = Math.floor(256 / alphabet.length) * alphabet.length;
    let result = '';
    while (result.length < length) for (const value of secureBytes(Math.max(16, length))) {
        if (value < limit) result += alphabet[value % alphabet.length];
        if (result.length === length) break;
    }
    return result;
}
