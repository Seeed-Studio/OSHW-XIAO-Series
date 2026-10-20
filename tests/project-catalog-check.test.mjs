import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parse } from 'yaml';
import { isCategoryEntry } from '../docs/submission-schema.mjs';
import { formatSummary, inspectCatalogChange } from '../scripts/check-project-catalog.mjs';

const project = {
    name: { en: 'Desk weather station' },
    description: { en: 'A compact XIAO weather station with a clear indoor temperature display.' },
    board: 'XIAO ESP32-C6',
    category: { en: 'Smart Home', zh: '智能家居' },
    year: 2026,
    month: 9,
    release_date: '2026-09-01',
    author: { en: 'Community Maker' },
    author_type: 'GitHub',
    link: 'https://github.com/example/weather',
    image: 'https://example.com/weather.jpg',
    homepage: 'featured'
};

const yaml = value => value.length
    ? `projects:\n${value.map(item => `- ${JSON.stringify(item)}`).join('\n')}\n`
    : 'projects: []\n';

test('new featured and catalog projects pass an explicit homepage decision', () => {
    const result = inspectCatalogChange(yaml([]), yaml([project, { ...project, link: 'https://example.com/catalog', homepage: 'catalog', image: undefined }]));
    assert.deepEqual(result.errors, []);
    assert.equal(result.affected.length, 2);
});

test('changed projects require canonical English and Chinese category labels', () => {
    for (const category of ['Smart Home', { en: 'Smart Home' }, { en: 'Smart Home', zh: '智能家' }]) {
        const result = inspectCatalogChange(yaml([]), yaml([{ ...project, category }]));
        assert.match(result.errors.join('\n'), /category must contain the canonical en and zh labels/);
    }
});

test('published catalog uses canonical English and Chinese category labels', async () => {
    const catalog = parse(await readFile(new URL('../projects.yaml', import.meta.url), 'utf8'));
    const invalid = catalog.projects.filter(item => !isCategoryEntry(item.category));
    assert.deepEqual(invalid.map(item => item.name?.en || item.name?.zh || item.link), []);
});

test('pending homepage decisions block new project merges', () => {
    const result = inspectCatalogChange(yaml([]), yaml([{ ...project, homepage: 'review' }]));
    assert.match(result.errors.join('\n'), /homepage review is pending/);
    assert.match(result.errors.join('\n'), /placement: landing page \+ project hub/);
    assert.match(result.errors.join('\n'), /placement: project hub only/);
    assert.match(formatSummary(result), /Homepage decision/);
});

test('featured projects require an image and duplicate links fail', () => {
    const result = inspectCatalogChange(yaml([]), yaml([{ ...project, image: undefined }, { ...project, name: { en: 'Duplicate project' } }]));
    const errors = result.errors.join('\n');
    assert.match(errors, /require a cover image/);
    assert.match(errors, /duplicates project/);
});

test('unchanged legacy projects do not need a homepage decision', () => {
    const legacy = { ...project };
    delete legacy.homepage;
    const result = inspectCatalogChange(yaml([legacy]), yaml([legacy]));
    assert.deepEqual(result.errors, []);
    assert.equal(result.affected.length, 0);
});
