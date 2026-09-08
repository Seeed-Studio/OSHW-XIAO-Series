import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearch, buildSearchIndex, scoreProject, compareProjectResults } from '../docs/search.mjs';

const project = {
    name: { en: 'Wireless Keyboard', zh: '\u65e0\u7ebf\u952e\u76d8' },
    board: 'XIAO ESP32-C6',
    description: { en: 'A compact wireless input device.', zh: '\u4fbf\u643a\u8f93\u5165\u8bbe\u5907' },
    category: { en: 'Mechanical Keyboard', zh: '\u673a\u68b0\u952e\u76d8' }
};
const index = buildSearchIndex(project);

test('board formatting, case, and full-width characters normalize', () => {
    assert.equal(normalizeSearch('ESP32-C6'), normalizeSearch('esp32c6'));
    assert.equal(normalizeSearch('ＥＳＰ３２Ｃ６'), 'esp32c6');
    assert.ok(scoreProject(index, 'esp32c6'));
});
test('Chinese and English project fields are both searchable', () => {
    assert.ok(scoreProject(index, '\u952e\u76d8'));
    assert.ok(scoreProject(index, 'wireless'));
    assert.ok(scoreProject(index, '\u4fbf\u643a'));
});
test('all query terms must match across fields', () => {
    assert.ok(scoreProject(index, 'C6 keyboard'));
    assert.equal(scoreProject(index, 'C6 weather'), null);
});
test('one missing, extra, or substituted English letter is tolerated', () => {
    for (const query of ['keybord', 'keyboaard', 'keyboerd']) {
        assert.equal(scoreProject(index, query).approximate, true);
    }
    assert.equal(scoreProject(index, 'xyzkeyboardxyz'), null);
    assert.equal(scoreProject(index, 'C5'), null);
});
test('exact title matches score above description matches', () => {
    const secondary = buildSearchIndex({ name: 'Input device', description: 'A keyboard' });
    assert.ok(scoreProject(index, 'keyboard').score > scoreProject(secondary, 'keyboard').score);
    assert.equal(scoreProject(index, 'keyboard').approximate, false);
});
test('empty, punctuation, long, and missing field inputs are safe', () => {
    for (const query of ['', '   ', '---']) assert.equal(scoreProject(index, query).score, 0);
    assert.equal(scoreProject(index, 'x'.repeat(200)), null);
    assert.equal(scoreProject(buildSearchIndex({}), 'keyboard'), null);
});

function result(index, hasImage, year, month, score = 0, approximate = false) {
    return { index, hasImage, project: { year, month }, match: { score, approximate } };
}

test('default order places covers first and sorts each group newest first', () => {
    const rows = [result(0, false, 2026, 6), result(1, true, 2024, 12), result(2, true, 2026, 5), result(3, true, 2026, 6), result(4, false, 2025, 12)];
    assert.deepEqual(rows.sort(compareProjectResults).map(row => row.index), [3, 2, 1, 0, 4]);
});

test('search relevance ranks above image availability', () => {
    const rows = [result(0, true, 2026, 6, 2), result(1, false, 2024, 1, 10), result(2, true, 2026, 6, 12, true)];
    assert.deepEqual(rows.sort(compareProjectResults).map(row => row.index), [1, 0, 2]);
});

test('equal relevance prefers a cover and equal dates preserve source order', () => {
    const rows = [result(2, true, 2026, 6, 8), result(0, false, 2026, 6, 8), result(1, true, 2026, 6, 8)];
    assert.deepEqual(rows.sort(compareProjectResults).map(row => row.index), [1, 2, 0]);
});
