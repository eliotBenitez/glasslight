// Desktop-entry categories, not Apple-specific classifications. Pure data
// helpers keep filtering/ranking independent of the Shell actor lifecycle.
// `name` holds English source text translated at the render sites in
// extension.js via `_()`; it is not wrapped here because this module is
// evaluated at import time, before the gettext domain is bound.
export const CATEGORIES = [
    {id: 'all', name: 'All'},
    {id: 'office', name: 'Office', tags: ['Office', 'Finance']},
    {id: 'network', name: 'Internet', tags: ['Network']},
    {id: 'media', name: 'Media', tags: ['AudioVideo', 'Audio', 'Video']},
    {id: 'graphics', name: 'Graphics', tags: ['Graphics']},
    {id: 'games', name: 'Games', tags: ['Game']},
    {id: 'development', name: 'Development', tags: ['Development']},
    {id: 'education', name: 'Education', tags: ['Education', 'Science']},
    {id: 'utilities', name: 'Utilities', tags: ['Utility', 'System', 'Settings']},
    {id: 'other', name: 'Other'},
];

export const normalize = text => (text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();

export function categoryIds(value) {
    const tags = new Set((value ?? '').split(';'));
    const ids = CATEGORIES.filter(c => c.tags?.some(tag => tags.has(tag))).map(c => c.id);
    return ids.length ? ids : ['other'];
}

export function searchRank(query, record) {
    const name = normalize(record.title);
    if (!query) return 1;
    if (name === query) return 1000;
    if (name.startsWith(query)) return 800;
    if (name.split(/[\s._/-]+/).some(word => word.startsWith(query))) return 600;
    if (name.includes(query)) return 400;
    const terms = normalize(`${record.title} ${record.keywords} ${record.id}`);
    return query.split(/\s+/).every(term => terms.includes(term)) ? 100 : 0;
}

export function catalogue(records, category, query, preferredIds = [], limit = 6) {
    const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
    const items = records.filter(r => category === 'all' || r.categories.includes(category))
        .map(r => ({...r, rank: searchRank(query, r)})).filter(r => r.rank)
        .sort((a, b) => b.rank - a.rank || collator.compare(a.title, b.title) || a.id.localeCompare(b.id));
    const byId = new Map(items.map(item => [item.id, item]));
    const suggestions = !query && category === 'all'
        ? [...new Set(preferredIds)].map(id => byId.get(id)).filter(Boolean).slice(0, limit) : [];
    const suggestedIds = new Set(suggestions.map(item => item.id));
    return {suggestions, items: items.filter(item => !suggestedIds.has(item.id)), total: items.length};
}
