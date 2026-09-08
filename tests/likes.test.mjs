import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePopularResults } from '../docs/likes.mjs';
import { getLikeSnapshot, hashVisitor, setLike } from '../worker/likes.mjs';

class Statement {
    constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.db, this.sql, values); }
}

class LikesDatabase {
    constructor() { this.rows = new Map(); }
    prepare(sql) { return new Statement(this, sql); }
    async batch(statements) {
        return statements.map(statement => {
            const [project, voter] = statement.values;
            if (statement.sql.startsWith('INSERT')) this.rows.set(`${project}\n${voter}`, { project, voter });
            if (statement.sql.startsWith('DELETE')) this.rows.delete(`${project}\n${voter}`);
            if (statement.sql.includes('GROUP BY')) {
                const totals = new Map();
                for (const row of this.rows.values()) totals.set(row.project, (totals.get(row.project) || 0) + 1);
                return { results: [...totals].map(([item, count]) => ({ project: item, count })) };
            }
            if (statement.sql.includes('WHERE voter_hash')) return { results: [...this.rows.values()].filter(row => row.voter === statement.values[0]).map(row => ({ project: row.project })) };
            if (statement.sql.startsWith('SELECT COUNT')) return { results: [{ count: [...this.rows.values()].filter(row => row.project === project).length }] };
            return { results: [] };
        });
    }
}

const visitor = '123e4567-e89b-42d3-a456-426614174000';
const project = 'https://example.com/project';

test('anonymous likes are idempotent and can be removed', async () => {
    const db = new LikesDatabase();
    assert.deepEqual(await setLike(db, { project, visitorId: visitor, liked: true }, 'secret'), { project: 'https://example.com/project', count: 1, liked: true });
    assert.equal((await setLike(db, { project, visitorId: visitor, liked: true }, 'secret')).count, 1);
    assert.deepEqual((await getLikeSnapshot(db, visitor, 'secret')).liked, ['https://example.com/project']);
    assert.equal((await setLike(db, { project, visitorId: visitor, liked: false }, 'secret')).count, 0);
});

test('visitor hashes are stable, secret-specific, and reject malformed votes', async () => {
    assert.equal(await hashVisitor(visitor, 'secret'), await hashVisitor(visitor, 'secret'));
    assert.notEqual(await hashVisitor(visitor, 'secret'), await hashVisitor(visitor, 'another-secret'));
    const db = new LikesDatabase();
    await assert.rejects(setLike(db, { project, visitorId: 'bad', liked: true }, 'secret'), /invalid_like/);
    await assert.rejects(setLike(db, { project: 'http://example.com', visitorId: visitor, liked: true }, 'secret'), /invalid_like/);
});

test('popular sorting uses likes, covers, dates, then source position', () => {
    const base = { project: { year: 2025, month: 1 }, hasImage: false, index: 1, likes: 2 };
    assert.ok(comparePopularResults({ ...base, likes: 3 }, base) < 0);
    assert.ok(comparePopularResults({ ...base, hasImage: true }, base) < 0);
    assert.ok(comparePopularResults({ ...base, project: { year: 2026, month: 1 } }, base) < 0);
    assert.ok(comparePopularResults({ ...base, index: 0 }, base) < 0);
});
