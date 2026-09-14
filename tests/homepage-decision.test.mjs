import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'yaml';
import { applyHomepageDecision } from '../scripts/apply-homepage-decision.mjs';

const existing = `projects:\n- name: Existing project\n  link: https://example.com/existing\n`;
const submitted = `\n- name: Submitted project\n  description: A complete project description for review.\n  link: https://example.com/submitted\n  homepage: review\n`;

test('reviewer label replaces the pending decision without reformatting the catalog', () => {
    const head = `${existing}${submitted}`;
    const updated = applyHomepageDecision(existing, head, 'featured');
    assert.equal(updated, head.replace('homepage: review', 'homepage: featured'));
    assert.equal(parse(updated).projects[1].homepage, 'featured');
});

test('reviewer label adds a missing decision to one new project', () => {
    const head = `${existing}${submitted.replace('  homepage: review\n', '')}`;
    const updated = applyHomepageDecision(existing, head, 'catalog');
    assert.equal(parse(updated).projects[1].homepage, 'catalog');
    assert.match(updated, /link: https:\/\/example\.com\/submitted\n  homepage: catalog\n/);
});

test('invalid decisions and ambiguous submissions are rejected', () => {
    assert.throws(() => applyHomepageDecision(existing, `${existing}${submitted}`, 'review'), /featured or catalog/);
    assert.throws(() => applyHomepageDecision(existing, existing, 'featured'), /exactly one new project/);
    assert.throws(() => applyHomepageDecision(existing, `${existing}${submitted}${submitted.replaceAll('submitted', 'another')}`, 'featured'), /found 2/);
});
