import { appendFile, readFile } from 'node:fs/promises';
import process from 'node:process';
import { parse } from 'yaml';
import { BOARDS, CATEGORIES, projectIdentity, publicUrl } from '../docs/submission-schema.mjs';

export const HOMEPAGE_DECISIONS = new Set(['featured', 'catalog']);

function localizedText(value) {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    return [value.en, value.zh].find(item => typeof item === 'string' && item.trim())?.trim() || '';
}

function catalog(text, label) {
    let data;
    try { data = parse(text, { maxAliasCount: 50 }); }
    catch (error) { throw new Error(`${label} is not valid YAML: ${error.message}`); }
    if (!Array.isArray(data?.projects)) throw new Error(`${label} must contain a projects array.`);
    return data.projects;
}

function itemDate(project) {
    if (typeof project.release_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(project.release_date)) return project.release_date;
    if (Number.isInteger(project.year) && Number.isInteger(project.month)) return `${project.year}-${String(project.month).padStart(2, '0')}-01`;
    return '';
}

function projectLabel(project, index) {
    return localizedText(project?.name) || project?.link || `Project ${index + 1}`;
}

function affectedProjects(baseProjects, headProjects) {
    const remaining = new Map();
    for (const project of baseProjects) {
        const serialized = JSON.stringify(project);
        remaining.set(serialized, (remaining.get(serialized) || 0) + 1);
    }
    return headProjects.flatMap((project, index) => {
        const serialized = JSON.stringify(project);
        const exactMatches = remaining.get(serialized) || 0;
        if (exactMatches > 0) {
            remaining.set(serialized, exactMatches - 1);
            return [];
        }
        try {
            const identity = projectIdentity(project.link);
            const added = !baseProjects.some(item => {
                try { return projectIdentity(item.link) === identity; }
                catch { return false; }
            });
            return [{ project, index, added }];
        } catch { return [{ project, index, added: true }]; }
    });
}

function identityCounts(projects) {
    const counts = new Map();
    projects.forEach(project => {
        try {
            const identity = projectIdentity(project.link);
            counts.set(identity, (counts.get(identity) || 0) + 1);
        } catch { /* Invalid links receive a focused error when the record changes. */ }
    });
    return counts;
}

export function inspectCatalogChange(baseText, headText, today = new Date().toISOString().slice(0, 10)) {
    const baseProjects = catalog(baseText, 'Base projects.yaml');
    const headProjects = catalog(headText, 'PR projects.yaml');
    const errors = [];
    const warnings = [];
    const baseIdentities = identityCounts(baseProjects);
    const headIdentities = new Map();

    headProjects.forEach((project, index) => {
        try {
            const identity = projectIdentity(project.link);
            const seen = headIdentities.get(identity) || [];
            seen.push(index);
            headIdentities.set(identity, seen);
        } catch { /* Affected invalid links receive a focused error below. */ }
    });

    for (const [identity, indexes] of headIdentities) {
        const allowed = Math.max(baseIdentities.get(identity) || 0, 1);
        if (indexes.length > allowed) {
            const index = indexes[allowed];
            errors.push(`${projectLabel(headProjects[index], index)} duplicates project ${indexes[0] + 1}.`);
        }
    }

    const affected = affectedProjects(baseProjects, headProjects);
    for (const { project, index, added } of affected) {
        const label = projectLabel(project, index);
        const name = localizedText(project.name);
        const description = localizedText(project.description);
        const author = localizedText(project.author);
        const category = typeof project.category === 'string' ? project.category : localizedText(project.category);
        const boards = typeof project.board === 'string' ? project.board.split(',').map(item => item.trim()).filter(Boolean) : [];
        const date = itemDate(project);

        if (name.length < 2 || name.length > 160) errors.push(`${label}: name must contain 2-160 characters.`);
        if (description.length < 20 || description.length > 3000) errors.push(`${label}: description must contain 20-3000 characters.`);
        if (author.length < 2 || author.length > 120) errors.push(`${label}: author must contain 2-120 characters.`);
        if (!CATEGORIES.includes(category)) errors.push(`${label}: category is not recognized.`);
        if (!boards.length || boards.some(board => !BOARDS.includes(board))) errors.push(`${label}: board list contains an unrecognized XIAO model.`);
        if (!publicUrl(project.link)) errors.push(`${label}: project link must be a public HTTPS URL.`);
        if (project.image && !publicUrl(project.image)) errors.push(`${label}: cover image must be a public HTTPS URL.`);
        if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || date > today) errors.push(`${label}: release date is missing, invalid, or in the future.`);

        if (added && project.homepage === 'review') errors.push(`${label}: homepage review is pending; choose featured or catalog before merging.`);
        else if (added && !HOMEPAGE_DECISIONS.has(project.homepage)) errors.push(`${label}: homepage must be set to featured or catalog before merging.`);
        else if (project.homepage != null && project.homepage !== 'review' && !HOMEPAGE_DECISIONS.has(project.homepage)) errors.push(`${label}: homepage must be featured, catalog, or review.`);
        if (project.homepage === 'featured' && !project.image) errors.push(`${label}: featured homepage projects require a cover image.`);
        if (!project.release_date) warnings.push(`${label}: add release_date for precise newest-first ordering.`);
    }

    return { errors, warnings, affected, total: headProjects.length };
}

async function probe(url, expectedType) {
    if (!url) return null;
    try {
        const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'XIAO-Project-Catalog-Check/1.0' } });
        if (!response.ok) return `responded with HTTP ${response.status}`;
        const contentType = response.headers.get('content-type') || '';
        if (expectedType && contentType && !contentType.toLowerCase().startsWith(expectedType)) return `returned ${contentType} instead of ${expectedType}`;
        return null;
    } catch (error) { return `could not be checked (${error.message})`; }
}

export async function inspectRemoteSources(result) {
    const warnings = [...result.warnings];
    for (const { project, index } of result.affected) {
        const label = projectLabel(project, index);
        const projectWarning = await probe(publicUrl(project.link));
        if (projectWarning) warnings.push(`${label}: project URL ${projectWarning}.`);
        if (project.image) {
            const imageWarning = await probe(publicUrl(project.image), 'image/');
            if (imageWarning) warnings.push(`${label}: cover image ${imageWarning}.`);
        }
    }
    return { ...result, warnings };
}

export function formatSummary(result) {
    const decisionRows = result.affected.map(({ project, added }) => `| ${localizedText(project.name) || project.link} | ${added ? 'New' : 'Updated'} | ${project.homepage || 'Not set'} |`).join('\n');
    return [
        '# XIAO project catalog review',
        '',
        `Checked ${result.affected.length} changed project${result.affected.length === 1 ? '' : 's'} in a catalog containing ${result.total} projects.`,
        '',
        decisionRows ? `| Project | Change | Homepage decision |\n| --- | --- | --- |\n${decisionRows}\n` : 'No project records changed.\n',
        `## Errors (${result.errors.length})`,
        '',
        ...(result.errors.length ? result.errors.map(item => `- ${item}`) : ['- None']),
        '',
        `## Warnings (${result.warnings.length})`,
        '',
        ...(result.warnings.length ? result.warnings.map(item => `- ${item}`) : ['- None']),
        ''
    ].join('\n');
}

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : '';
}

async function main() {
    const basePath = argument('--base');
    const headPath = argument('--head') || 'projects.yaml';
    if (!basePath) throw new Error('Usage: npm run validate:projects -- --base <base projects.yaml> [--head <PR projects.yaml>]');
    const [baseText, headText] = await Promise.all([readFile(basePath, 'utf8'), readFile(headPath, 'utf8')]);
    const result = await inspectRemoteSources(inspectCatalogChange(baseText, headText));
    const summary = formatSummary(result);
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
    if (result.errors.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error.message); process.exitCode = 1; });
