import {categoryIds, catalogue} from '../appCatalog.js';
import {evaluateExpression, formatCalcResult} from '../calculator.js';
import {fold, score} from '../search.js';
import {resolveSearchEngine, searchUrl} from '../searchEngines.js';
import {buildSettingsActions} from '../settingsSearch.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function assertEqual(actual, expected, message) {
    assert(Object.is(actual, expected), `${message}: expected ${expected}, got ${actual}`);
}

function assertClose(actual, expected, message) {
    assert(Math.abs(actual - expected) < 1e-12,
        `${message}: expected approximately ${expected}, got ${actual}`);
}

const arithmetic = evaluateExpression('3 * (4 + 1)');
assert(arithmetic !== null, 'valid arithmetic expression should be evaluated');
assertEqual(arithmetic.value, 15, 'operator precedence');
assertClose(evaluateExpression('sin(pi / 6)').value, 0.5, 'named functions and constants');
assertClose(evaluateExpression('sin²(pi / 6)').value, 0.25, 'superscript powers');
assertEqual(evaluateExpression('1.2.3'), null, 'invalid numeric search should not be evaluated');
assertEqual(formatCalcResult(0.1 + 0.2).plain, '0.3', 'floating-point noise should be rounded');

assertEqual(fold('Café'), 'cafe', 'search folding should remove diacritics');
assert(score('term', 'Terminal') > score('term', 'XTerm'), 'prefixes should rank above substrings');
assertEqual(categoryIds('AudioVideo;Player;')[0], 'media', 'desktop categories should be mapped');

const records = [
    {id: 'org.example.Editor', title: 'Editor', keywords: 'text code', categories: ['development']},
    {id: 'org.example.Terminal', title: 'Terminal', keywords: 'shell command', categories: ['development']},
];
const result = catalogue(records, 'all', '', ['org.example.Terminal']);
assertEqual(result.suggestions[0].id, 'org.example.Terminal', 'preferred app should be suggested');
assertEqual(result.items.length, 1, 'suggested app should not be duplicated in all apps');
assertEqual(result.total, 2, 'catalogue total should include suggestions');

const google = resolveSearchEngine('google', '');
assertEqual(searchUrl(google, 'a b&c'), 'https://www.google.com/search?q=a%20b%26c', 'web query should be URL-encoded');
assertEqual(resolveSearchEngine('unknown', '').id, 'duckduckgo', 'unknown engine should fall back to the default');
assertEqual(resolveSearchEngine('custom', 'ftp://example.org/%s').id, 'duckduckgo', 'non-http template should be rejected');
assertEqual(resolveSearchEngine('custom', 'https://example.org/').id, 'duckduckgo', 'template without %s should be rejected');
const custom = resolveSearchEngine('custom', 'https://www.example.org/find?q=%s');
assertEqual(custom.name, 'example.org', 'custom engine should be named after its host');
assertEqual(searchUrl(custom, 'привет'), 'https://www.example.org/find?q=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82', 'non-Latin query');

function settingsEntry(overrides = {}) {
    return {
        get_id: () => 'gnome-sound-panel.desktop',
        get_categories: () => 'GNOME;Settings;X-GNOME-Settings-Panel;',
        get_is_hidden: () => false,
        should_show: () => false,
        get_name: () => 'Звук',
        get_display_name: () => 'Звук',
        get_description: () => 'Громкость и устройства',
        get_keywords: () => ['микрофон', 'динамики'],
        get_icon: () => null,
        ...overrides,
    };
}

const soundPanel = settingsEntry();
const usersPanel = settingsEntry({
    get_id: () => 'gnome-users-panel.desktop',
    get_name: () => 'Users',
    get_display_name: () => 'Users',
    get_description: () => null,
    get_keywords: () => null,
});
let launchedPanel = null;
const settingsContext = {detail: 'Системные настройки', keywords: 'настройки параметры',
    launch: app => { launchedPanel = app; }};
const settingsActions = buildSettingsActions([
    soundPanel, usersPanel,
    settingsEntry({get_is_hidden: () => true}),
    settingsEntry({get_id: () => 'org.gnome.Settings.desktop'}),
    settingsEntry({get_categories: () => 'Settings;'}),
    settingsEntry({get_categories: () => null}),
    settingsEntry({get_id: () => null}),
    settingsEntry({get_id: () => 'gnome-sound-panel.desktop.backup'}),
    settingsEntry({get_categories: () => 'Not-X-GNOME-Settings-Panel;'}),
], settingsContext);
assertEqual(settingsActions.length, 2, 'only installed GNOME panels should be included, including NoDisplay entries');
assertEqual(buildSettingsActions([], settingsContext).length, 0, 'missing Settings should yield an empty catalogue');
assertEqual(launchedPanel, null, 'catalogue discovery should not launch Settings');
const soundAction = settingsActions[0];
assertEqual(soundAction.title, 'Звук', 'panel titles should use desktop-entry translations');
assertEqual(soundAction.detail, 'Системные настройки', 'panels should be labelled as system settings');
assertEqual(soundAction.params.length, 0, 'panel activation should not prompt for parameters');
assertEqual(soundAction.closeBeforeRun, true, 'launcher should close before opening Settings');
assertEqual(soundAction.fallback, 'preferences-system-symbolic', 'missing panel icons should have a fallback');
assertEqual(score('', soundAction.title), 1, 'panels should be browsable with an empty query');
assertEqual(score(fold('ЗВУК'), soundAction.title), 1000, 'localized panel titles should be searchable');
assert(score('микрофон', soundAction.keywords) > 0, 'localized panel keywords should be searchable');
assert(score('громкость', soundAction.keywords) > 0, 'panel descriptions should be searchable');
assert(score(fold('настройки микрофон'), soundAction.keywords) > 0, 'settings and panel keywords should match together');
assert(score('sound', soundAction.keywords) > 0, 'English panel identifiers should remain searchable');
assertEqual(score('несуществующийраздел', soundAction.keywords), 0, 'unknown queries should not match panels');
assertEqual(launchedPanel, null, 'searching should not launch Settings');
soundAction.run();
assertEqual(launchedPanel, soundPanel, 'activation should launch the selected desktop entry');
settingsActions[1].run();
assertEqual(launchedPanel, usersPanel, 'nested panels should retain their original desktop entry');
assertEqual(settingsActions[1].id, 'settings:gnome-users-panel.desktop', 'panel action IDs should be namespaced');
assert(!settingsActions[1].keywords.includes('null'), 'missing descriptions and keywords should be tolerated');
let launchFailed = false;
try {
    buildSettingsActions([soundPanel], {...settingsContext,
        launch: () => { throw new Error('Settings unavailable'); }})[0].run();
} catch (error) {
    launchFailed = error.message === 'Settings unavailable';
}
assert(launchFailed, 'launch failures should reach the existing action error handler');

print('Core tests passed');
