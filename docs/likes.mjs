import { projectIdentity } from './submission-schema.mjs?v=4';

const VISITOR_KEY = 'xiao-project-hub-visitor';
const VISITOR_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let memoryVisitor;

function storage() {
    try { return localStorage; } catch { return undefined; }
}

function visitorId() {
    const saved = storage()?.getItem(VISITOR_KEY);
    if (VISITOR_PATTERN.test(saved || '')) return saved;
    memoryVisitor ||= crypto.randomUUID();
    try { storage()?.setItem(VISITOR_KEY, memoryVisitor); } catch { /* Use the in-memory visitor for this page. */ }
    return memoryVisitor;
}

function identity(project) {
    try { return projectIdentity(project.link); } catch { return ''; }
}

// Order popular results by likes, cover availability, date, and source position.
export function comparePopularResults(left, right) {
    return right.likes - left.likes
        || Number(right.hasImage) - Number(left.hasImage)
        || right.project.year - left.project.year
        || right.project.month - left.project.month
        || left.index - right.index;
}

export function initLikes({ configUrl, onChange }) {
    const counts = new Map();
    const liked = new Set();
    const pending = new Set();
    let apiBase = '';
    let available = false;
    let error = false;

    function state(project) {
        const key = identity(project);
        return { count: counts.get(key) || 0, liked: liked.has(key), pending: pending.has(key), available, error };
    }

    function serviceState() {
        return { available, error };
    }

    async function load() {
        try {
            const response = await fetch(configUrl, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
            if (!response.ok) throw new Error('configuration_unavailable');
            const config = await response.json();
            apiBase = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:8787' : config.apiBaseUrl?.replace(/\/$/, '');
            if (!apiBase) throw new Error('configuration_unavailable');
            const snapshot = await fetch(`${apiBase}/api/likes`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: visitorId() }), signal: AbortSignal.timeout(10000), cache: 'no-store'
            });
            if (!snapshot.ok) throw new Error('likes_unavailable');
            const data = await snapshot.json();
            counts.clear();
            liked.clear();
            for (const item of data.likes || []) counts.set(item.project, Number(item.count) || 0);
            for (const project of data.liked || []) liked.add(project);
            available = true;
            error = false;
        } catch {
            available = false;
            error = true;
        }
        onChange();
    }

    async function toggle(project) {
        const key = identity(project);
        if (!available || !key || pending.has(key)) return;
        pending.add(key);
        error = false;
        onChange();
        try {
            const response = await fetch(`${apiBase}/api/likes`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: key, visitorId: visitorId(), liked: !liked.has(key) }), signal: AbortSignal.timeout(10000)
            });
            if (!response.ok) throw new Error('like_failed');
            const result = await response.json();
            counts.set(result.project, Number(result.count) || 0);
            if (result.liked) liked.add(result.project); else liked.delete(result.project);
        } catch { error = true; }
        finally { pending.delete(key); onChange(); }
    }

    return { state, serviceState, load, toggle };
}
