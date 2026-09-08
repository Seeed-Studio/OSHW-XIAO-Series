import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { handleRequest, verifyChallenge } from '../worker/index.mjs';
import { installationToken } from '../worker/github.mjs';

const origin = 'https://hub.example.com';
const input = { name: { en: 'Test project' }, author: { en: 'Test maker' }, description: { en: 'A working XIAO temperature display for a desk.' }, link: 'https://example.com/project', boards: ['XIAO ESP32-C6'], category: 'Smart Home', source: 'Web', releaseDate: '2026-01-01', turnstileToken: 'test-challenge' };
const configured = () => ({ GITHUB_OWNER: 'example', GITHUB_REPO: 'catalog', GITHUB_BASE_BRANCH: 'main', GITHUB_APP_CLIENT_ID: 'test-client', GITHUB_APP_INSTALLATION_ID: '123', GITHUB_APP_PRIVATE_KEY: 'test-only-key', TURNSTILE_SECRET: 'test-only-secret', TURNSTILE_SITE_KEY: 'public-key', TURNSTILE_HOSTNAMES: 'hub.example.com', ALLOWED_ORIGINS: origin, LIKE_HASH_SECRET: 'test-only-like-secret-with-32-characters', LIKES_DB: {}, SUBMISSION_LIMITER: { limit: async () => ({ success: true }) }, LIKE_LIMITER: { limit: async () => ({ success: true }) } });
const request = (body = input, options = {}) => new Request(`https://api.example.com${options.path || '/api/submissions'}`, { method: options.method || 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.1', ...options.headers }, ...(['POST', 'PUT'].includes(options.method || 'POST') ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('public config reveals only readiness, site key and repository', async () => {
    const env = configured();
    const response = await handleRequest(request(null, { path: '/api/config', method: 'GET' }), env);
    assert.deepEqual(await response.json(), { ready: true, siteKey: 'public-key', repository: 'example/catalog' });
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    delete env.GITHUB_APP_PRIVATE_KEY;
    assert.equal((await (await handleRequest(request(null, { path: '/api/config', method: 'GET' }), env)).json()).ready, false);
    assert.equal((await handleRequest(request(), env)).status, 503);
});

test('CORS rejects other origins and permits expected preflight', async () => {
    const blocked = await handleRequest(request(input, { headers: { Origin: 'https://attacker.example' } }), configured());
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.has('Access-Control-Allow-Origin'), false);
    assert.equal((await handleRequest(request(null, { method: 'OPTIONS' }), configured())).status, 204);
});

test('like snapshot and toggle routes return sanitized public data', async () => {
    const env = configured();
    const visitorId = '550e8400-e29b-41d4-a716-446655440000';
    const snapshot = await handleRequest(request({ visitorId }, { path: '/api/likes' }), env, {
        getLikeSnapshot: async (db, visitor, secret) => {
            assert.equal(db, env.LIKES_DB);
            assert.equal(visitor, visitorId);
            assert.equal(secret, env.LIKE_HASH_SECRET);
            return { likes: [{ project: 'https://example.com/project', count: 2 }], liked: [] };
        }
    });
    assert.equal(snapshot.status, 200);
    assert.deepEqual(await snapshot.json(), { likes: [{ project: 'https://example.com/project', count: 2 }], liked: [] });

    const toggle = await handleRequest(request({ project: 'https://example.com/project', visitorId, liked: true }, { path: '/api/likes', method: 'PUT' }), env, {
        setLike: async (db, body) => ({ project: body.project, count: 3, liked: body.liked })
    });
    assert.equal(toggle.status, 200);
    assert.deepEqual(await toggle.json(), { project: 'https://example.com/project', count: 3, liked: true });
});

test('like writes enforce availability, content type, JSON size and rate limits', async () => {
    const env = configured();
    const body = { project: 'https://example.com/project', visitorId: '550e8400-e29b-41d4-a716-446655440000', liked: true };
    assert.equal((await handleRequest(request(body, { path: '/api/likes', method: 'PUT', headers: { 'Content-Type': 'text/plain' } }), env)).status, 415);
    assert.equal((await handleRequest(request('{', { path: '/api/likes', method: 'PUT' }), env)).status, 400);
    assert.equal((await handleRequest(request('x'.repeat(5000), { path: '/api/likes', method: 'PUT' }), env)).status, 413);
    assert.equal((await handleRequest(request(body, { path: '/api/likes', method: 'PUT' }), { ...env, LIKE_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
    assert.equal((await handleRequest(request(body, { path: '/api/likes', method: 'PUT' }), { ...env, LIKE_HASH_SECRET: '' })).status, 503);
});

test('rate, content type, malformed JSON, invalid fields and oversized bodies fail before GitHub', async () => {
    const env = configured();
    let externalCalls = 0;
    const services = { fetcher: async () => { externalCalls++; throw new Error('Unexpected outbound request'); } };
    const limited = { ...env, SUBMISSION_LIMITER: { limit: async () => ({ success: false }) } };
    assert.equal((await handleRequest(request(), limited, services)).status, 429);
    assert.equal((await handleRequest(request(input, { headers: { 'Content-Type': 'text/plain' } }), env, services)).status, 415);
    assert.equal((await handleRequest(request('{'), env, services)).status, 400);
    assert.equal((await handleRequest(request({ ...input, boards: [] }), env, services)).status, 400);
    assert.equal((await handleRequest(request('x'.repeat(33000)), env, services)).status, 413);
    assert.equal(externalCalls, 0);
});

test('challenge validates success, action and hostname before minting an app token', async () => {
    const env = configured();
    for (const response of [ { success: false }, { success: true, action: 'wrong', hostname: 'hub.example.com' }, { success: true, action: 'project_submission', hostname: 'other.example' } ]) {
        await assert.rejects(verifyChallenge('challenge', request(), env, async () => json(response)), /verification_failed/);
    }
    await assert.rejects(verifyChallenge('', request(), env), /verification_required/);
    let minted = false;
    const response = await handleRequest(request(), env, { fetcher: async () => json({ success: false }), installationToken: async () => { minted = true; } });
    assert.equal(response.status, 403);
    assert.equal(minted, false);
});

test('validated API submission returns a real-shaped GitHub PR response after all writes', async () => {
    const calls = [];
    const catalog = { encoding: 'base64', sha: 'file-sha', content: Buffer.from('projects: []\n').toString('base64') };
    const services = {
        installationToken: async () => 'test-installation-token',
        fetcher: async (url, options) => {
            calls.push({ url, options });
            if (url.includes('/siteverify')) return json({ success: true, action: 'project_submission', hostname: 'hub.example.com' });
            assert.equal(options.headers.Authorization, 'Bearer test-installation-token');
            if (url.includes('/pulls?')) return json([]);
            if (url.includes('/git/ref/heads/')) return json({ object: { sha: 'base-sha' } });
            if (url.includes('/git/refs')) return json({});
            if (url.includes('/contents/')) return json(options.method === 'PUT' ? {} : catalog);
            if (url.endsWith('/pulls')) return json({ number: 42, html_url: 'https://github.com/example/catalog/pull/42' });
            throw new Error('Unexpected URL');
        }
    };
    const response = await handleRequest(request(), configured(), services);
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { status: 'created', number: 42, url: 'https://github.com/example/catalog/pull/42' });
    assert.equal(calls.filter(call => call.options.method === 'PUT').length, 1);
});

test('GitHub errors return a sanitized error without upstream details or credentials', async () => {
    const response = await handleRequest(request(), configured(), {
        installationToken: async () => 'test-installation-token',
        fetcher: async url => url.includes('/siteverify') ? json({ success: true, action: 'project_submission', hostname: 'hub.example.com' }) : json({ message: 'Sensitive upstream detail' }, 403)
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'github_busy' });
});

test('installation JWT signature, lifetime and permission scope match the GitHub App contract', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const env = { ...configured(), GITHUB_APP_PRIVATE_KEY: privateKey };
    const result = await installationToken(env, async (url, options) => {
        assert.ok(url.endsWith('/app/installations/123/access_tokens'));
        const [header, payload, signature] = options.headers.Authorization.slice(7).split('.');
        assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')), true);
        const claims = JSON.parse(Buffer.from(payload, 'base64url'));
        assert.equal(claims.iss, 'test-client');
        assert.ok(claims.exp - claims.iat <= 600);
        assert.deepEqual(JSON.parse(options.body), { repositories: ['catalog'], permissions: { contents: 'write', pull_requests: 'write' } });
        return json({ token: 'test-installation-token' });
    });
    assert.equal(result, 'test-installation-token');
});


test('full-length UTF-8 translations fit the request limit and reach challenge validation', async () => {
    let verified = false;
    const full = { ...input, name: { en: 'Weather station', zh: '\u5929\u6c14\u7ad9' }, description: { en: '\u754c'.repeat(3000), zh: '\u6e29'.repeat(3000) } };
    const response = await handleRequest(request(full), configured(), { fetcher: async () => { verified = true; return json({ success: false }); } });
    assert.equal(response.status, 403);
    assert.equal(verified, true);
});
