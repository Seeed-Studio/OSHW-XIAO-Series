import { validateSubmission } from '../docs/submission-schema.mjs';
import { createSubmission, githubClient, installationToken, readLimitedText, SubmissionError } from './github.mjs';
import { getLikeSnapshot, setLike } from './likes.mjs';

const list = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);

export function isConfigured(env) {
    return ['GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_BASE_BRANCH', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY', 'TURNSTILE_SECRET', 'TURNSTILE_SITE_KEY', 'TURNSTILE_HOSTNAMES'].every(key => typeof env[key] === 'string' && env[key].trim());
}

export function likesAreConfigured(env) {
    return Boolean(env.LIKES_DB && env.LIKE_LIMITER?.limit && typeof env.LIKE_HASH_SECRET === 'string' && env.LIKE_HASH_SECRET.length >= 32);
}

async function parseJson(request, limit) {
    try { return JSON.parse(await readLimitedText(request, limit)); }
    catch (error) { if (error instanceof SubmissionError) throw error; throw new SubmissionError('invalid_json', 400); }
}

// Validate the one-use challenge token against this deployment's hostname and action.
export async function verifyChallenge(token, request, env, fetcher = fetch) {
    if (typeof token !== 'string' || !token || token.length > 2048) throw new SubmissionError('verification_required', 403);
    let result;
    try {
        const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: request.headers.get('CF-Connecting-IP') || '' }),
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error('verification_unavailable');
        result = JSON.parse(await readLimitedText(response, 16384));
    } catch { throw new SubmissionError('verification_failed', 403); }
    if (result.success !== true || result.action !== 'project_submission' || !list(env.TURNSTILE_HOSTNAMES).includes(result.hostname)) throw new SubmissionError('verification_failed', 403);
}

// Handle public configuration and validated submissions; GitHub credentials stay server-side.
export async function handleRequest(request, env, services = {}) {
    const origin = request.headers.get('Origin');
    const allowed = origin && list(env.ALLOWED_ORIGINS).includes(origin);
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin', ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}) };
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (!allowed) return reply({ error: 'origin_not_allowed' }, 403);
    const path = new URL(request.url).pathname;
    if (!['/api/config', '/api/submissions', '/api/likes'].includes(path)) return reply({ error: 'not_found' }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
    if (path === '/api/config' && request.method === 'GET') return reply({ ready: isConfigured(env), siteKey: env.TURNSTILE_SITE_KEY || '', repository: `${env.GITHUB_OWNER}/${env.GITHUB_REPO}` });
    if (path === '/api/likes') {
        if (!['POST', 'PUT'].includes(request.method)) return reply({ error: 'method_not_allowed' }, 405);
        if (!likesAreConfigured(env)) return reply({ error: 'service_unavailable' }, 503);
        try {
            if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply({ error: 'invalid_content_type' }, 415);
            const input = await parseJson(request, 4096);
            if (request.method === 'POST') return reply(await (services.getLikeSnapshot || getLikeSnapshot)(env.LIKES_DB, input?.visitorId, env.LIKE_HASH_SECRET));
            const limiter = await env.LIKE_LIMITER.limit({ key: `${env.GITHUB_REPO}:${request.headers.get('CF-Connecting-IP') || 'unknown'}` });
            if (!limiter.success) return reply({ error: 'rate_limited' }, 429);
            return reply(await (services.setLike || setLike)(env.LIKES_DB, input, env.LIKE_HASH_SECRET));
        } catch (error) {
            const code = error instanceof SubmissionError ? error.code : 'service_unavailable';
            console.error(JSON.stringify({ event: 'like_failed', code }));
            return reply({ error: code }, error instanceof SubmissionError ? error.status : 503);
        }
    }
    if (path !== '/api/submissions' || request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!isConfigured(env)) return reply({ error: 'service_unavailable' }, 503);
    try {
        if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply({ error: 'invalid_content_type' }, 415);
        const limiter = await env.SUBMISSION_LIMITER.limit({ key: `${env.GITHUB_REPO}:${request.headers.get('CF-Connecting-IP') || 'unknown'}` });
        if (!limiter.success) return reply({ error: 'rate_limited' }, 429);
        const input = await parseJson(request, 32768);
        const validation = validateSubmission(input);
        if (!validation.valid) return reply({ error: 'invalid_submission', fields: validation.errors }, 400);
        await verifyChallenge(input.turnstileToken, request, env, services.fetcher || fetch);
        const token = await (services.installationToken || installationToken)(env, services.fetcher || fetch);
        const result = await createSubmission(validation.data, env, githubClient(token, services.fetcher || fetch));
        return reply(result, result.status === 'created' ? 201 : 200);
    } catch (error) {
        const code = error instanceof SubmissionError ? error.code : 'service_unavailable';
        console.error(JSON.stringify({ event: 'submission_failed', code }));
        return reply({ error: code }, error instanceof SubmissionError ? error.status : 503);
    }
}

export default { fetch: handleRequest };
