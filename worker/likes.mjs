import { projectIdentity, publicUrl } from '../docs/submission-schema.mjs';
import { SubmissionError } from './github.mjs';

const VISITOR_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validProject(value) {
    const link = publicUrl(value);
    if (!link) throw new SubmissionError('invalid_like', 400);
    return projectIdentity(link);
}

function validVisitor(value) {
    if (typeof value !== 'string' || !VISITOR_PATTERN.test(value)) throw new SubmissionError('invalid_like', 400);
    return value.toLowerCase();
}

// Convert the browser identifier into a non-reversible database value.
export async function hashVisitor(visitorId, secret) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(validVisitor(visitorId)));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

// Return public totals and the current browser's liked projects in one database round trip.
export async function getLikeSnapshot(db, visitorId, secret) {
    const voterHash = await hashVisitor(visitorId, secret);
    const [counts, liked] = await db.batch([
        db.prepare('SELECT project_url AS project, COUNT(*) AS count FROM project_likes GROUP BY project_url'),
        db.prepare('SELECT project_url AS project FROM project_likes WHERE voter_hash = ?').bind(voterHash)
    ]);
    return {
        likes: (counts.results || []).map(row => ({ project: String(row.project), count: Number(row.count) || 0 })),
        liked: (liked.results || []).map(row => String(row.project))
    };
}

// Store the requested final state, then return the authoritative project total.
export async function setLike(db, input, secret) {
    const project = validProject(input?.project);
    const voterHash = await hashVisitor(input?.visitorId, secret);
    if (typeof input?.liked !== 'boolean') throw new SubmissionError('invalid_like', 400);
    const change = input.liked
        ? db.prepare('INSERT INTO project_likes (project_url, voter_hash) VALUES (?, ?) ON CONFLICT(project_url, voter_hash) DO NOTHING').bind(project, voterHash)
        : db.prepare('DELETE FROM project_likes WHERE project_url = ? AND voter_hash = ?').bind(project, voterHash);
    const [, total] = await db.batch([
        change,
        db.prepare('SELECT COUNT(*) AS count FROM project_likes WHERE project_url = ?').bind(project)
    ]);
    return { project, count: Number(total.results?.[0]?.count) || 0, liked: input.liked };
}
