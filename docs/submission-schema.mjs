export const CATEGORIES = ['AI Gadget', 'Gaming', 'Hardware Design', 'Healthcare', 'IoT', 'LED Lighting', 'Mechanical Keyboard', 'Robotics', 'Scientific Tools', 'Smart Home', 'Telecommunication', 'Tools & Accessories', 'Wearables', 'Others'];
export const BOARDS = ['XIAO ESP32-C3', 'XIAO ESP32-C5', 'XIAO ESP32-C6', 'XIAO ESP32-S3', 'XIAO ESP32-S3 Sense', 'XIAO ESP32-S3 Plus', 'XIAO RP2040', 'XIAO RP2040 Plus', 'XIAO RP2350', 'XIAO SAMD21 (Seeeduino XIAO)', 'XIAO SAMD21 Plus', 'XIAO nRF52840 (XIAO BLE)', 'XIAO nRF52840 Sense (XIAO BLE Sense)', 'XIAO nRF52840 Plus', 'XIAO nRF52840 Sense Plus', 'XIAO nRF54L15', 'XIAO nRF54L15 Sense', 'XIAO nRF54LM20A', 'XIAO nRF54LM20A Sense', 'XIAO RA4M1', 'XIAO MG24', 'XIAO MG24 Sense'];
export const SOURCES = ['GitHub', 'YouTube', 'Hackster', 'Instructables', 'Hackaday', 'Web', 'Other'];

// Return a public HTTPS URL, or an empty string for invalid input.
export function publicUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return '';
    try {
        const url = new URL(value.trim());
        if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) return '';
        return url.href;
    } catch { return ''; }
}

// Canonicalize project links for duplicate detection and stable submission branches.
export function projectIdentity(value) {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key);
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    if (url.hostname === 'github.com') url.pathname = url.pathname.toLowerCase();
    url.searchParams.sort();
    return url.href;
}

// Validate shared form fields and return normalized data with field-specific errors.
export function validateSubmission(input, today = new Date().toISOString().slice(0, 10)) {
    const errors = {};
    const data = {};
    for (const [key, minimum, maximum] of [['name', 2, 160], ['author', 2, 120], ['description', 20, 3000]]) {
        data[key] = typeof input?.[key] === 'string' ? input[key].trim() : '';
        if (data[key].length < minimum || data[key].length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(data[key])) errors[key] = 'invalid_length';
    }
    data.link = publicUrl(input?.link);
    if (!data.link) errors.link = 'invalid_url';
    data.image = input?.image ? publicUrl(input.image) : '';
    if (input?.image && !data.image) errors.image = 'invalid_url';
    data.category = input?.category;
    if (!CATEGORIES.includes(data.category)) errors.category = 'required';
    data.source = input?.source;
    if (!SOURCES.includes(data.source)) errors.source = 'required';
    data.sourceOther = typeof input?.sourceOther === 'string' ? input.sourceOther.trim() : '';
    if (data.source === 'Other' && (!/^[\p{L}\p{N} .&_-]{2,40}$/u.test(data.sourceOther))) errors.sourceOther = 'invalid_source';
    data.boards = Array.isArray(input?.boards) ? [...new Set(input.boards)] : [];
    if (!data.boards.length || data.boards.length > BOARDS.length || data.boards.some(board => !BOARDS.includes(board))) errors.boards = 'required';
    data.releaseDate = input?.releaseDate;
    const date = typeof data.releaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.releaseDate) ? new Date(`${data.releaseDate}T00:00:00Z`) : new Date(NaN);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== data.releaseDate || data.releaseDate > today || data.releaseDate < '1970-01-01') errors.releaseDate = 'invalid_date';
    return { data, errors, valid: Object.keys(errors).length === 0 };
}

export function toProjectEntry(data) {
    return {
        name: data.name,
        description: data.description,
        board: data.boards.join(', '),
        category: data.category,
        year: Number(data.releaseDate.slice(0, 4)),
        month: Number(data.releaseDate.slice(5, 7)),
        release_date: data.releaseDate,
        author: data.author,
        author_type: data.source === 'Other' ? data.sourceOther : data.source,
        link: data.link,
        ...(data.image ? { image: data.image } : {})
    };
}
