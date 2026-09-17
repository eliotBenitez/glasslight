// The query is substituted into a template only when the user activates the web
// result, so nothing leaves the device while typing. Brand names are not
// translated; `%s` marks where the URL-encoded query goes.
export const SEARCH_ENGINES = [
    {id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s'},
    {id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s'},
    {id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s'},
    {id: 'yandex', name: 'Yandex', url: 'https://yandex.ru/search/?text=%s'},
    {id: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q=%s'},
    {id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/do/search?query=%s'},
    {id: 'ecosia', name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s'},
];

const TEMPLATE_HOST = /^https?:\/\/([^\s/?#:@]+)[^\s]*$/i;

export function isSearchTemplate(template) {
    return typeof template === 'string' && TEMPLATE_HOST.test(template) && template.includes('%s');
}

// An invalid or empty custom template falls back to the default engine rather
// than producing an unopenable result.
export function resolveSearchEngine(id, customTemplate) {
    if (id === 'custom' && isSearchTemplate(customTemplate)) {
        const name = customTemplate.match(TEMPLATE_HOST)[1].replace(/^www\./i, '');
        return {id, name, url: customTemplate};
    }
    return SEARCH_ENGINES.find(engine => engine.id === id) ?? SEARCH_ENGINES[0];
}

export function searchUrl(engine, query) {
    return engine.url.split('%s').join(encodeURIComponent(query));
}
