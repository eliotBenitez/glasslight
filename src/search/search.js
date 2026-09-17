// Diacritic-folding + fuzzy scoring shared by the launcher's result lists and
// the action catalogue. Pure string helpers, independent of the Shell actors.
export const fold = text => (text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

export function score(query, text) {
    const value = fold(text);
    if (!query) return 1;
    if (query === value) return 1000;
    if (value.startsWith(query)) return 800;
    if (value.split(/[\s._/-]+/).some(word => word.startsWith(query))) return 600;
    const index = value.indexOf(query);
    if (index >= 0) return 300 - Math.min(index, 200);
    return query.split(/\s+/).every(term => value.includes(term)) ? 100 : 0;
}
