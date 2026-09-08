import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { validateSubmission, projectIdentity, toProjectEntry } from '../docs/submission-schema.mjs';
import { appendProject, createSubmission, SubmissionError } from '../worker/github.mjs';

export const valid = { name: { en: 'Desk weather station' }, author: { en: 'Community Maker' }, description: { en: 'A small weather station that displays room temperature and humidity.' }, link: 'https://github.com/example/weather', category: 'Smart Home', source: 'GitHub', boards: ['XIAO ESP32-C6'], image: '', releaseDate: '2026-01-02' };
const env = { GITHUB_OWNER: 'example', GITHUB_REPO: 'catalog', GITHUB_BASE_BRANCH: 'main' };
const pull = { number: 12, html_url: 'https://github.com/example/catalog/pull/12' };
const existingCatalog = 'projects:\n- name: Original\n  link: https://example.com/original\n';
const encoded = text => ({ sha: 'file-sha', encoding: 'base64', content: Buffer.from(text).toString('base64') });
const conflict = status => Object.assign(new SubmissionError('github_unavailable'), { githubStatus: status });

// Model the repository API so retry and concurrent-write behavior is observable.
function repository({ existingPull, catalog = existingCatalog, failPullOnce = false, raceWrite = false, racePull = false } = {}) {
    const calls = [];
    let branch;
    let content = catalog;
    let pr = existingPull;
    let failed = false;
    async function api(path, options = {}) {
        const method = options.method || 'GET';
        calls.push({ path, method, body: options.body });
        if (path.includes('/pulls?')) return pr ? [pr] : [];
        if (path.includes('/git/ref/heads/')) return { object: { sha: 'base-sha' } };
        if (path.endsWith('/git/refs')) {
            if (branch) throw conflict(422);
            branch = options.body.ref;
            return {};
        }
        if (path.includes('/contents/projects.yaml?')) return encoded(path.endsWith('ref=base-sha') ? catalog : content);
        if (path.endsWith('/contents/projects.yaml') && method === 'PUT') {
            assert.ok(options.body.branch.startsWith('project-submissions/'));
            assert.equal(options.body.sha, 'file-sha');
            content = Buffer.from(options.body.content, 'base64').toString();
            if (raceWrite) throw conflict(409);
            return {};
        }
        if (path.endsWith('/pulls') && method === 'POST') {
            if (failPullOnce && !failed) { failed = true; throw conflict(503); }
            pr = pull;
            if (racePull) throw conflict(422);
            return pr;
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
    }
    return { api, calls, get content() { return content; } };
}

test('valid submission normalizes fields, multiple boards and optional images', () => {
    const result = validateSubmission({ ...valid, name: { en: `  ${valid.name.en}  ` }, boards: [...valid.boards, ...valid.boards, 'XIAO RP2350'] });
    assert.equal(result.valid, true);
    assert.deepEqual(result.data.name, valid.name);
    assert.equal(result.data.boards.length, 2);
    const entry = toProjectEntry(result.data);
    assert.equal(entry.year, 2026);
    assert.equal(entry.month, 1);
    assert.equal(entry.release_date, valid.releaseDate);
    assert.equal('image' in entry, false);
});

test('empty, malformed, oversized fields, invalid URLs, unknown boards and dates fail', () => {
    for (const input of [null, {}, [], 'bad']) assert.equal(validateSubmission(input).valid, false);
    for (const [field, values] of Object.entries({ name: ['', 'x'.repeat(161)], author: [''], description: ['short', 'x'.repeat(3001)], link: ['javascript:alert(1)', 'https://user:pass@example.com', 'http://example.com', 'https://127.0.0.1'], image: ['not-a-url'], boards: [[], ['XIAO unknown']], category: ['unknown'], source: ['unknown'], releaseDate: ['2026-02-30', '2099-01-01', 'bad', '1969-01-01'] })) {
        for (const value of values) {
            const translated = ['name', 'author', 'description'].includes(field);
            assert.ok(validateSubmission({ ...valid, [field]: translated ? { en: value } : value }).errors[translated ? `${field}En` : field], `${field}: ${value}`);
        }
    }
});

test('custom platform is required only for Other and leap dates validate', () => {
    assert.ok(validateSubmission({ ...valid, source: 'Other' }).errors.sourceOther);
    const result = validateSubmission({ ...valid, source: 'Other', sourceOther: 'Maker Blog', releaseDate: '2024-02-29' });
    assert.equal(result.valid, true);
    assert.equal(toProjectEntry(result.data).author_type, 'Maker Blog');
});

test('link identity ignores tracking, fragments, GitHub case and trailing slashes', () => {
    assert.equal(projectIdentity('https://github.com/Example/Weather/?utm_source=test#readme'), projectIdentity(valid.link));
});

test('YAML append preserves real catalog and safely represents special characters', async () => {
    const original = await readFile(new URL('../projects.yaml', import.meta.url), 'utf8');
    const entry = toProjectEntry({ ...valid, name: 'A: test #1', description: 'Line one:\n- name: injected\n```\n<script>alert(1)</script>' });
    const result = appendProject(original, entry);
    assert.ok(result.startsWith(original.trimEnd()));
    const before = parse(original).projects;
    const after = parse(result).projects;
    assert.deepEqual(after.slice(0, -1), before);
    assert.deepEqual(after.at(-1), entry);
    assert.throws(() => appendProject('not: a catalog', entry), /invalid_catalog/);
});

test('submission creates one branch, appends one project and opens a PR against main', async () => {
    const repo = repository();
    const result = await createSubmission(valid, env, repo.api);
    assert.deepEqual(result, { status: 'created', number: 12, url: pull.html_url });
    assert.equal(parse(repo.content).projects.length, 2);
    const prRequest = repo.calls.find(call => call.path.endsWith('/pulls') && call.method === 'POST');
    assert.equal(prRequest.body.base, 'main');
    assert.ok(prRequest.body.head.startsWith('project-submissions/'));
    assert.equal(repo.calls.filter(call => call.method === 'PUT').length, 1);
});

test('existing PR returns immediately with no writes', async () => {
    const repo = repository({ existingPull: pull });
    assert.equal((await createSubmission(valid, env, repo.api)).status, 'existing');
    assert.equal(repo.calls.length, 1);
});

test('project already published is rejected before creating a branch', async () => {
    const repo = repository({ catalog: appendProject(existingCatalog, toProjectEntry(valid)) });
    await assert.rejects(createSubmission(valid, env, repo.api), error => error.code === 'duplicate_project');
    assert.ok(repo.calls.every(call => call.method === 'GET'));
});

test('retry after PR API failure reuses the branch without appending twice', async () => {
    const repo = repository({ failPullOnce: true });
    await assert.rejects(createSubmission(valid, env, repo.api));
    assert.equal((await createSubmission(valid, env, repo.api)).status, 'created');
    assert.equal(parse(repo.content).projects.length, 2);
    assert.equal(repo.calls.filter(call => call.method === 'PUT').length, 1);
});

test('concurrent file and PR creation recover the already-created result', async () => {
    const repo = repository({ raceWrite: true, racePull: true });
    assert.equal((await createSubmission(valid, env, repo.api)).status, 'existing');
    assert.equal(parse(repo.content).projects.length, 2);
});

test('all published Plus and Nordic board variants can be submitted together', () => {
    const boards = ['XIAO ESP32-S3 Plus', 'XIAO RP2040 Plus', 'XIAO SAMD21 Plus', 'XIAO nRF52840 Plus', 'XIAO nRF52840 Sense Plus', 'XIAO nRF54L15 Sense', 'XIAO nRF54LM20A', 'XIAO nRF54LM20A Sense'];
    for (const board of boards) {
        const result = validateSubmission({ ...valid, boards: [board] });
        assert.equal(result.valid, true, board);
        assert.equal(toProjectEntry(result.data).board, board);
    }
    const combined = validateSubmission({ ...valid, boards });
    assert.equal(combined.valid, true);
    assert.equal(toProjectEntry(combined.data).board, boards.join(', '));
});

test('board choices group each chip family and place variants after the standard model', async () => {
    const { BOARD_GROUPS, BOARDS } = await import('../docs/submission-schema.mjs');
    assert.ok(Array.isArray(BOARD_GROUPS));
    const displayed = BOARD_GROUPS.flatMap(group => group.boards);
    assert.deepEqual(displayed, BOARDS);
    assert.equal(new Set(displayed).size, 22);
    for (const [prefix, standard] of [['XIAO ESP32-', 'XIAO ESP32-S3'], ['XIAO nRF', 'XIAO nRF52840 (XIAO BLE)'], ['XIAO RP', 'XIAO RP2040'], ['XIAO SAMD21', 'XIAO SAMD21 (Seeeduino XIAO)'], ['XIAO RA', 'XIAO RA4M1'], ['XIAO MG', 'XIAO MG24']]) {
        const family = BOARD_GROUPS.find(group => group.boards.includes(standard));
        assert.ok(family);
        assert.deepEqual(family.boards, BOARDS.filter(board => board.startsWith(prefix)));
        for (const board of family.boards.filter(board => board.includes('Plus') || board.includes('Sense'))) {
            const base = board.replace(/ (Sense Plus|Sense|Plus).*$/, '');
            const index = family.boards.findIndex(item => item === base || item.startsWith(`${base} (`));
            assert.ok(index >= 0 && index < family.boards.indexOf(board), board);
        }
    }
});

test('English-only, Chinese-only and bilingual content preserve separate translations', async () => {
    const english = { name: { en: 'Weather station' }, description: { en: 'A XIAO weather station with a compact indoor temperature display.' }, author: { en: 'Maker' } };
    const chinese = { name: { zh: '\u5929\u6c14\u7ad9' }, description: { zh: '\u8fd9\u662f\u4e00\u4e2a\u4f7f\u7528 XIAO \u5f00\u53d1\u677f\u663e\u793a\u5ba4\u5185\u6e29\u5ea6\u548c\u6e7f\u5ea6\u7684\u684c\u9762\u5929\u6c14\u7ad9\u3002' }, author: { zh: '\u5c0f\u660e' } };
    const bilingual = Object.fromEntries(Object.keys(english).map(key => [key, { ...english[key], ...chinese[key] }]));
    for (const content of [english, chinese, bilingual]) {
        const result = validateSubmission({ ...valid, ...content });
        assert.equal(result.valid, true, JSON.stringify(result.errors));
        const entry = toProjectEntry(result.data);
        for (const key of Object.keys(content)) assert.deepEqual(entry[key], content[key]);
        const repo = repository();
        await createSubmission(result.data, env, repo.api);
        assert.deepEqual(parse(repo.content).projects.at(-1), entry);
        const pr = repo.calls.find(call => call.method === 'POST' && call.path.endsWith('/pulls'));
        assert.equal(pr.body.title, `feat: add ${content.name.en || content.name.zh}`);
    }
});

test('incomplete, blank and invalid translations return language-specific errors', () => {
    const complete = { ...valid, name: { en: 'Weather station' }, description: { en: 'A weather station using XIAO for temperature readings.' }, author: { en: 'Maker' } };
    assert.equal(validateSubmission(complete).valid, true);
    assert.ok(validateSubmission({ ...complete, name: {} }).errors.nameEn);
    assert.ok(validateSubmission({ ...complete, name: { ...complete.name, zh: '\u5929\u6c14\u7ad9' } }).errors.descriptionZh);
    assert.ok(validateSubmission({ ...complete, description: { ...complete.description, zh: ' ' } }).valid);
    assert.ok(validateSubmission({ ...complete, description: { ...complete.description, zh: 'short' } }).errors.descriptionZh);
    assert.ok(validateSubmission({ ...complete, author: { zh: 'x'.repeat(121) } }).errors.authorZh);
    assert.ok(validateSubmission({ ...complete, name: { en: 123 } }).errors.nameEn);
});
