import { Buffer } from 'node:buffer';
import { sign } from 'node:crypto';
import { parse, parseDocument, stringify } from 'yaml';
import { projectIdentity, toProjectEntry } from '../docs/submission-schema.mjs';

export class SubmissionError extends Error {
    constructor(code, status = 502, details = {}) {
        super(code);
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

// Read bounded UTF-8 response bodies and cancel oversized streams.
export async function readLimitedText(message, limit) {
    const reader = message.body?.getReader();
    if (!reader) return '';
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > limit) { await reader.cancel(); throw new SubmissionError('payload_too_large', 413); }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks).toString('utf8');
}

export function githubClient(token, fetcher = fetch) {
    return async (path, options = {}) => {
        const response = await fetcher(`https://api.github.com${path}`, {
            method: options.method || 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'XIAO-Project-Hub', 'Content-Type': 'application/json' },
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: AbortSignal.timeout(15000)
        });
        let data;
        try { data = JSON.parse(await readLimitedText(response, 2 * 1024 * 1024)); }
        catch (error) { if (error instanceof SubmissionError) throw error; throw new SubmissionError('github_unavailable'); }
        if (!response.ok) {
            const error = new SubmissionError(response.status === 403 || response.status === 429 ? 'github_busy' : 'github_unavailable');
            error.githubStatus = response.status;
            throw error;
        }
        return data;
    };
}

// Mint a repository-scoped installation token using the server's GitHub App key.
export async function installationToken(env, fetcher = fetch) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_CLIENT_ID })).toString('base64url');
    const unsigned = `${header}.${payload}`;
    const signature = sign('RSA-SHA256', Buffer.from(unsigned), env.GITHUB_APP_PRIVATE_KEY).toString('base64url');
    const app = githubClient(`${unsigned}.${signature}`, fetcher);
    const installation = await app(`/app/installations/${encodeURIComponent(env.GITHUB_APP_INSTALLATION_ID)}/access_tokens`, {
        method: 'POST', body: { repositories: [env.GITHUB_REPO], permissions: { contents: 'write', pull_requests: 'write' } }
    });
    if (typeof installation.token !== 'string' || !installation.token) throw new SubmissionError('github_unavailable');
    return installation.token;
}

function fileContents(file) {
    if (file.encoding !== 'base64' || typeof file.content !== 'string' || !file.sha) throw new SubmissionError('invalid_catalog');
    return Buffer.from(file.content, 'base64').toString('utf8');
}

function catalogProjects(text) {
    let data;
    try { data = parse(text, { maxAliasCount: 50 }); }
    catch { throw new SubmissionError('invalid_catalog'); }
    if (!Array.isArray(data?.projects)) throw new SubmissionError('invalid_catalog');
    return data.projects;
}

function containsProject(text, identity) {
    return catalogProjects(text).some(project => {
        try { return projectIdentity(project.link) === identity; } catch { return false; }
    });
}

// Preserve the existing YAML text and append a safely serialized project entry.
export function appendProject(text, entry) {
    const projects = catalogProjects(text);
    const addition = stringify([entry], { lineWidth: 0 }).trimEnd();
    let result;
    if (projects.length === 0) {
        const sequence = parseDocument(text).get('projects', true);
        result = `${text.slice(0, sequence.range[0])}\n${addition}${text.slice(sequence.range[1])}`;
    } else result = `${text.trimEnd()}\n\n${addition}\n`;
    const parsed = catalogProjects(result);
    if (parsed.length !== projects.length + 1) throw new SubmissionError('invalid_catalog');
    return result;
}

// Repeated or concurrent submissions for a project reuse its deterministic branch and PR.
export async function createSubmission(data, env, api) {
    const identity = projectIdentity(data.link);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    const id = Buffer.from(digest).toString('hex').slice(0, 24);
    const branch = `project-submissions/${id}`;
    const root = `/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}`;
    const base = env.GITHUB_BASE_BRANCH;
    const findPull = async () => {
        const pulls = await api(`${root}/pulls?state=all&head=${encodeURIComponent(`${env.GITHUB_OWNER}:${branch}`)}&base=${encodeURIComponent(base)}&per_page=100`);
        if (!Array.isArray(pulls)) throw new SubmissionError('github_unavailable');
        return pulls[0];
    };
    const existing = await findPull();
    if (existing) return { status: 'existing', number: existing.number, url: existing.html_url };
    const ref = await api(`${root}/git/ref/heads/${encodeURIComponent(base)}`);
    const baseFile = await api(`${root}/contents/projects.yaml?ref=${encodeURIComponent(ref.object.sha)}`);
    const baseText = fileContents(baseFile);
    if (containsProject(baseText, identity)) throw new SubmissionError('duplicate_project', 409);
    try {
        await api(`${root}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: ref.object.sha } });
    } catch (error) { if (error.githubStatus !== 422) throw error; }
    const filePath = `${root}/contents/projects.yaml`;
    const branchFile = await api(`${filePath}?ref=${encodeURIComponent(branch)}`);
    const branchText = fileContents(branchFile);
    if (!containsProject(branchText, identity)) {
        try {
            await api(filePath, { method: 'PUT', body: {
                message: `feat: add ${data.name.replace(/[\r\n]/g, ' ')}`,
                branch, sha: branchFile.sha,
                content: Buffer.from(appendProject(branchText, toProjectEntry(data))).toString('base64')
            } });
        } catch (error) {
            if (![409, 422].includes(error.githubStatus)) throw error;
            const updated = await api(`${filePath}?ref=${encodeURIComponent(branch)}`);
            if (!containsProject(fileContents(updated), identity)) throw new SubmissionError('submission_in_progress', 409);
        }
    }
    const entry = toProjectEntry(data);
    const body = `A community project submission for review.\n\nProject details are included below and appended to projects.yaml.\n\n\`\`\`json\n${JSON.stringify(entry, null, 2).replace(/`/g, '\\u0060')}\n\`\`\`\n`;
    try {
        const pull = await api(`${root}/pulls`, { method: 'POST', body: { title: `feat: add ${data.name.replace(/[\r\n]/g, ' ')}`, head: branch, base, body, maintainer_can_modify: true } });
        return { status: 'created', number: pull.number, url: pull.html_url };
    } catch (error) {
        if (error.githubStatus !== 422) throw error;
        const pull = await findPull();
        if (!pull) throw error;
        return { status: 'existing', number: pull.number, url: pull.html_url };
    }
}
