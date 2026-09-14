import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { isMap, isSeq, parse, parseDocument } from 'yaml';
import { projectIdentity } from '../docs/submission-schema.mjs';

export const HOMEPAGE_DECISIONS = new Set(['featured', 'catalog']);

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : '';
}

function projects(text, label) {
    let data;
    try { data = parse(text, { maxAliasCount: 50 }); }
    catch (error) { throw new Error(`${label} is not valid YAML: ${error.message}`); }
    if (!Array.isArray(data?.projects)) throw new Error(`${label} must contain a projects array.`);
    return data.projects;
}

function newProjectIndexes(baseProjects, headProjects) {
    const baseIdentities = new Set(baseProjects.flatMap(project => {
        try { return [projectIdentity(project.link)]; }
        catch { return []; }
    }));
    return headProjects.flatMap((project, index) => {
        try { return baseIdentities.has(projectIdentity(project.link)) ? [] : [index]; }
        catch { return []; }
    });
}

/**
 * Apply the reviewer-selected homepage placement to one newly submitted project.
 * 将审核者选择的首页去向写入一个新投稿项目。
 */
export function applyHomepageDecision(baseText, headText, decision) {
    if (!HOMEPAGE_DECISIONS.has(decision)) throw new Error('Homepage decision must be featured or catalog.');
    const baseProjects = projects(baseText, 'Base projects.yaml');
    const headProjects = projects(headText, 'PR projects.yaml');
    const indexes = newProjectIndexes(baseProjects, headProjects);
    if (indexes.length !== 1) throw new Error(`Expected exactly one new project, found ${indexes.length}.`);

    const document = parseDocument(headText, { keepSourceTokens: true });
    const sequence = document.get('projects', true);
    if (!isSeq(sequence)) throw new Error('PR projects.yaml must contain a projects sequence.');
    const project = sequence.items[indexes[0]];
    if (!isMap(project)) throw new Error('The submitted project must be a YAML map.');

    const homepage = project.items.find(pair => pair.key?.value === 'homepage');
    if (homepage?.value?.range) {
        const [start, end] = homepage.value.range;
        return `${headText.slice(0, start)}${decision}${headText.slice(end)}`;
    }

    const insertion = project.range?.[1];
    if (!Number.isInteger(insertion)) throw new Error('The submitted project location could not be determined.');
    return `${headText.slice(0, insertion)}  homepage: ${decision}\n${headText.slice(insertion)}`;
}

async function main() {
    const basePath = argument('--base');
    const headPath = argument('--head');
    const decision = argument('--decision');
    if (!basePath || !headPath || !decision) {
        throw new Error('Usage: node scripts/apply-homepage-decision.mjs --base <base projects.yaml> --head <PR projects.yaml> --decision <featured|catalog>');
    }
    const [baseText, headText] = await Promise.all([readFile(basePath, 'utf8'), readFile(headPath, 'utf8')]);
    const updated = applyHomepageDecision(baseText, headText, decision);
    await writeFile(headPath, updated, 'utf8');
    console.log(`Applied homepage: ${decision} to the submitted project.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
