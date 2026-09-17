// Shell-side gettext helpers shared by every module of the extension.
//
// The extension (and its bound gettext domain, declared as `gettext-domain` in
// metadata.json) is resolved from this file's own URL via Extension.lookupByURL,
// which is the supported way to reach the extension from a submodule. Resolution
// happens lazily on first use — i.e. at runtime, after enable(), when the
// extension is registered and its translations are initialised — never at import
// time. Every `_()` / `ngettext()` call site in this project is inside a function
// body, so this stays correct.
//
// `format()` fills %s / %d placeholders left to right, keeping a whole sentence
// (with its numbers interpolated) as a single translatable msgid.
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

let cached = null;

function extension() {
    cached ??= Extension.lookupByURL(import.meta.url);
    if (!cached) throw new Error('Glasslight: extension context unavailable for gettext');
    return cached;
}

export function _(str) {
    return extension().gettext(str);
}

export function ngettext(singular, plural, count) {
    return extension().ngettext(singular, plural, count);
}

export function pgettext(context, str) {
    return extension().pgettext(context, str);
}

export function format(template, ...args) {
    let index = 0;
    return String(template).replace(/%[sd]/g, () => `${args[index++]}`);
}
