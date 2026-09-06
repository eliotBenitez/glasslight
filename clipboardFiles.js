import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import {_} from './i18n.js';

export const FILE_TYPES = ['x-special/gnome-copied-files', 'text/uri-list'];

// Never follow arbitrary URLs from clipboard text. Only explicit local file
// lists are eligible, with URI decoding delegated to GLib/GIO.
export function localImageFiles(text, type) {
    const lines = text.replace(/\0+$/, '').split(/\r?\n/);
    if (type === 'x-special/gnome-copied-files') {
        if (!['copy', 'cut'].includes(lines.shift())) return [];
    }
    const result = [];
    const seen = new Set();
    for (const line of lines) {
        const uri = line.trim();
        if (!uri || uri.startsWith('#') || !/^file:\/\/(?:\/|localhost\/)/i.test(uri)) continue;
        try {
            const [path, host] = GLib.filename_from_uri(uri);
            if (host && host.toLowerCase() !== 'localhost') continue;
            const file = Gio.File.new_for_path(path);
            if (!/\.(png|jpe?g|webp|bmp)$/i.test(file.get_basename()) || seen.has(file.get_uri())) continue;
            seen.add(file.get_uri());
            result.push(file);
            if (result.length === 8) break;
        } catch (_) { /* Malformed URI: skip, do not treat it as a path. */ }
    }
    return result;
}

export async function selectionBytes(mime, limit, cancel) {
    const output = Gio.MemoryOutputStream.new_resizable();
    try {
        await new Promise((resolve, reject) => global.display.get_selection().transfer_async(
            Meta.SelectionType.SELECTION_CLIPBOARD, mime, limit + 1, output, cancel,
            (selection, result) => {try {selection.transfer_finish(result); resolve();} catch (e) {reject(e);}}));
        output.close(null);
        const bytes = output.steal_as_bytes();
        if (bytes.get_size() > limit) throw new Error(_('The clipboard file list is too large'));
        return bytes;
    } finally {
        if (!output.is_closed()) output.close(null);
    }
}

export async function localImageBytes(file, limit, cancel) {
    const info = await new Promise((resolve, reject) => file.query_info_async(
        'standard::type,standard::size,standard::content-type,standard::display-name',
        Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, cancel,
        (source, result) => {try {resolve(source.query_info_finish(result));} catch (e) {reject(e);}}));
    if (info.get_file_type() !== Gio.FileType.REGULAR) throw new Error(_('This is not a regular image file'));
    if (info.get_size() > limit) throw new Error(_('Image larger than 16 MiB'));
    const mime = Gio.content_type_get_mime_type(info.get_content_type() ?? '');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/bmp'].includes(mime))
        throw new Error(_('Unsupported image format'));
    const stream = await new Promise((resolve, reject) => file.read_async(GLib.PRIORITY_LOW, cancel,
        (source, result) => {try {resolve(source.read_finish(result));} catch (e) {reject(e);}}));
    const output = Gio.MemoryOutputStream.new_resizable();
    try {
        let total = 0;
        while (true) {
            const chunk = await new Promise((resolve, reject) => stream.read_bytes_async(
                Math.min(65536, limit + 1 - total), GLib.PRIORITY_LOW, cancel,
                (source, result) => {try {resolve(source.read_bytes_finish(result));} catch (e) {reject(e);}}));
            if (!chunk.get_size()) break;
            total += chunk.get_size();
            if (total > limit) throw new Error(_('Image larger than 16 MiB'));
            output.write_bytes(chunk, cancel); // Memory-only, not filesystem I/O.
        }
        output.close(null);
        return {bytes: output.steal_as_bytes(), mime, name: info.get_display_name()};
    } finally {
        stream.close_async(GLib.PRIORITY_LOW, null, (source, result) => {try {source.close_finish(result);} catch (_) {}});
        if (!output.is_closed()) output.close(null);
    }
}
