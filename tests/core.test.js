import {categoryIds, catalogue} from '../appCatalog.js';
import {evaluateExpression, formatCalcResult} from '../calculator.js';
import {fold, score} from '../search.js';

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

print('Core tests passed');
