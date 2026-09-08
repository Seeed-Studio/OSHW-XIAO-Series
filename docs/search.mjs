// Normalize searchable text and board identifiers.
export function normalizeSearch(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function textValues(value) {
    return typeof value === 'string' ? value : Object.values(value || {}).join(' ');
}

// Match a single insertion, deletion, or substitution in an English word.
function isNearWord(left, right) {
    if (Math.abs(left.length - right.length) > 1) return false;
    let i = 0;
    let j = 0;
    let changes = 0;
    while (i < left.length && j < right.length) {
        if (left[i] === right[j]) { i++; j++; continue; }
        if (++changes > 1) return false;
        if (left.length >= right.length) i++;
        if (right.length >= left.length) j++;
    }
    return changes + (left.length - i) + (right.length - j) <= 1;
}

// Build weighted bilingual fields once for each loaded project.
export function buildSearchIndex(project) {
    return [['name', 10], ['board', 8], ['category', 6], ['author', 3], ['description', 2], ['author_type', 1]]
        .map(([key, weight]) => {
            const text = textValues(project[key]);
            return { text: normalizeSearch(text), words: text.toLowerCase().match(/[a-z]+/g) || [], weight };
        });
}

// Return a score only when every query term matches; exact matches rank first.
export function scoreProject(index, query) {
    const terms = query.trim().split(/\s+/).map(normalizeSearch).filter(Boolean);
    if (!terms.length) return { score: 0, approximate: false };
    let score = 0;
    let approximate = false;
    for (const term of terms) {
        const exact = index.filter(field => field.text.includes(term));
        if (exact.length) {
            score += Math.max(...exact.map(field => field.weight));
            continue;
        }
        const near = /^[a-z]{5,32}$/.test(term) && index.some(field => field.words.some(word => isNearWord(term, word)));
        if (!near) return null;
        approximate = true;
        score += 0.5;
    }
    return { score, approximate };
}

// Order by match quality, available cover, newest date, then original position.
export function compareProjectResults(left, right) {
    return Number(left.match.approximate) - Number(right.match.approximate)
        || right.match.score - left.match.score
        || Number(right.hasImage) - Number(left.hasImage)
        || right.project.year - left.project.year
        || right.project.month - left.project.month
        || left.index - right.index;
}
