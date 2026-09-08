import { BOARD_GROUPS, CATEGORIES, SOURCES, validateSubmission } from './submission-schema.mjs?v=3';
import { FORM_LANG } from './submission-locales.mjs?v=3';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let challengeScript;

function loadChallenge() {
    if (window.turnstile) return Promise.resolve();
    if (challengeScript) return challengeScript;
    challengeScript = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.onload = resolve;
        script.onerror = () => { challengeScript = null; script.remove(); reject(new Error('verification_failed')); };
        document.head.append(script);
    });
    return challengeScript;
}

// Attach the contribution dialog and retain draft fields across close/reopen and language changes.
export function initSubmissionForm({ getLanguage, getCategoryLabel }) {
    const dialog = document.createElement('dialog');
    dialog.className = 'submission-dialog';
    dialog.id = 'submission-dialog';
    dialog.setAttribute('aria-labelledby', 'submission-title');
    document.body.append(dialog);
    let apiBase = '';
    let configuration;
    let widgetId;
    let token = '';
    let pending = false;
    let openedFrom;
    let generation = 0;
    const L = () => FORM_LANG[getLanguage()];
    const readForm = () => {
        const form = dialog.querySelector('form');
        if (!form) return {};
        const fields = new FormData(form);
        const data = { ...Object.fromEntries(fields), boards: fields.getAll('boards') };
        for (const key of ['name', 'author', 'description']) {
            data[key] = { en: fields.get(`${key}En`) || '', zh: fields.get(`${key}Zh`) || '' };
            delete data[`${key}En`];
            delete data[`${key}Zh`];
        }
        return data;
    };
    const status = (message, retry = false) => {
        dialog.querySelector('#submission-message').textContent = message;
        dialog.querySelector('#submission-retry').hidden = !retry;
    };
    const updateSubmit = () => {
        const button = dialog.querySelector('#submission-submit');
        if (!button) return;
        button.disabled = pending || !configuration?.ready || !token;
        button.textContent = pending ? L().submitting : L().submit;
    };
    const removeWidget = () => {
        if (widgetId !== undefined && window.turnstile) window.turnstile.remove(widgetId);
        widgetId = undefined;
        token = '';
    };

    function render(draft = {}) {
        removeWidget();
        const language = L();
        const field = (name, type = 'text', wide = false, optional = false, hint = '') => `<div class="submission-field${wide ? ' submission-wide' : ''}"><label for="submission-${name}">${language[name]}${optional ? `<span class="submission-optional">${language.optional}</span>` : '<span class="submission-required">*</span>'}</label><input id="submission-${name}" name="${name}" type="${type}" ${optional ? '' : 'required'} maxlength="${['link', 'image'].includes(name) ? 2048 : name === 'name' ? 160 : name === 'author' ? 120 : 40}" aria-describedby="${name}-error${hint ? ` ${name}-hint` : ''}" ${type === 'url' ? 'placeholder="https://…"' : ''}>${hint ? `<p class="submission-hint" id="${name}-hint">${hint}</p>` : ''}<p class="submission-error" id="${name}-error"></p></div>`;
        const options = (name, values) => `<div class="submission-field"><label for="submission-${name}">${language[name]}<span class="submission-required">*</span></label><select id="submission-${name}" name="${name}" required aria-describedby="${name}-error"><option value="">${language.choose}</option>${values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(name === 'category' ? getCategoryLabel(value) : value)}</option>`).join('')}</select><p class="submission-error" id="${name}-error"></p></div>`;
        const translatedField = (key, locale) => {
            const name = `${key}${locale === 'en' ? 'En' : 'Zh'}`;
            const attributes = `id="submission-${name}" name="${name}" lang="${locale}" maxlength="${key === 'description' ? 3000 : key === 'name' ? 160 : 120}" aria-describedby="${name}-error"`;
            return `<div class="submission-field"><label for="submission-${name}">${language[key]}</label>${key === 'description' ? `<textarea ${attributes}></textarea>` : `<input type="text" ${attributes}>`}<p class="submission-error" id="${name}-error"></p></div>`;
        };
        dialog.innerHTML = `<div class="submission-heading"><h2 id="submission-title">${language.title}</h2><p>${language.intro}</p><button class="submission-close" data-action="close" aria-label="${language.close}">×</button></div>
            <form class="submission-content" novalidate>
                <fieldset class="submission-fields">
                    <p class="submission-hint submission-wide" id="submission-content-hint">${language.contentHint}</p>
                    <div class="submission-translations submission-wide">${['en', 'zh'].map(locale => `<fieldset class="submission-translation" aria-describedby="submission-content-hint"><legend>${locale === 'en' ? language.english : language.chinese}</legend>${translatedField('name', locale)}${translatedField('author', locale)}${translatedField('description', locale)}<p class="submission-hint">${language.descriptionHint}</p></fieldset>`).join('')}</div>
                    ${field('link', 'url', true)}
                    ${options('category', CATEGORIES)}${options('source', SOURCES)}
                    <div id="submission-source-other" class="submission-wide" hidden>${field('sourceOther')}</div>
                    <div class="submission-field submission-wide"><span id="boards-label" class="submission-board-label">${language.boards}<span class="submission-required">*</span></span><p class="submission-hint" id="boards-hint">${language.boardsHint}</p><div class="submission-boards" role="group" aria-labelledby="boards-label" aria-describedby="boards-hint boards-error">${BOARD_GROUPS.map(group => `<fieldset class="submission-board-group"><legend>${escapeHtml(group.label)}</legend><div class="submission-board-options">${group.boards.map(board => `<label><input type="checkbox" name="boards" value="${escapeHtml(board)}">${escapeHtml(board)}</label>`).join('')}</div></fieldset>`).join('')}</div><p class="submission-error" id="boards-error"></p></div>
                    ${field('image', 'url', true, true, language.imageHint)}
                    ${field('releaseDate', 'date')}
                </fieldset>
                <div class="submission-status" role="status" aria-live="polite"><p id="submission-message">${language.checking}</p><button type="button" class="submission-retry" id="submission-retry" data-action="retry" hidden>${language.retry}</button></div>
                <div class="submission-challenge" id="submission-challenge"></div>
                <p class="submission-notice">${language.notice}</p>
                <div class="submission-actions"><button type="button" class="submission-secondary" data-action="close">${language.cancel}</button><button type="submit" class="submission-submit" id="submission-submit" disabled>${language.submit}</button></div>
            </form><div class="submission-success" hidden></div>`;
        dialog.querySelector('[name="releaseDate"]').max = new Date().toISOString().slice(0, 10);
        for (const input of dialog.querySelectorAll('input, textarea, select')) {
            if (input.name === 'boards') input.checked = draft.boards?.includes(input.value) || false;
            else {
                const translated = input.name.match(/^(name|author|description)(En|Zh)$/);
                const value = translated ? draft[translated[1]]?.[translated[2].toLowerCase()] : draft[input.name];
                if (value) input.value = value;
            }
        }
        dialog.querySelector('#submission-source-other').hidden = draft.source !== 'Other';
    }

    async function connect() {
        const current = ++generation;
        configuration = undefined;
        removeWidget();
        updateSubmit();
        status(L().checking);
        try {
            const configResponse = await fetch(new URL('./submission-config.json', import.meta.url), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
            if (!configResponse.ok) throw new Error('configuration_unavailable');
            const config = await configResponse.json();
            apiBase = config.apiBaseUrl?.replace(/\/$/, '') || (['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://127.0.0.1:8787' : '');
            if (!apiBase) throw new Error('configuration_unavailable');
            const response = await fetch(`${apiBase}/api/config`, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
            if (!response.ok) throw new Error('configuration_unavailable');
            const received = await response.json();
            if (current !== generation || !dialog.open) return;
            configuration = received;
            if (!configuration.ready || !configuration.siteKey) throw new Error('configuration_unavailable');
            await loadChallenge();
            if (current !== generation || !dialog.open) return;
            status(L().verification);
            widgetId = window.turnstile.render(dialog.querySelector('#submission-challenge'), {
                sitekey: configuration.siteKey, action: 'project_submission', theme: 'dark', size: innerWidth < 420 ? 'compact' : 'flexible', language: getLanguage() === 'zh' ? 'zh-CN' : 'en',
                callback: value => { token = value; status(L().notice); updateSubmit(); },
                'expired-callback': () => { token = ''; status(L().verificationFailed); updateSubmit(); },
                'error-callback': () => { token = ''; status(L().verificationFailed, true); updateSubmit(); }
            });
        } catch {
            if (current === generation) { configuration = undefined; status(L().unavailable, true); }
        } finally { if (current === generation) updateSubmit(); }
    }

    function showErrors(errors) {
        const language = L();
        const messages = { nameEn: language.validName, nameZh: language.validName, authorEn: language.validAuthor, authorZh: language.validAuthor, descriptionEn: language.validDescription, descriptionZh: language.validDescription, link: language.validUrl, image: language.validUrl, boards: language.selectBoards, releaseDate: language.validDate, category: language.required, source: language.required, sourceOther: language.validSource };
        dialog.querySelectorAll('.submission-error').forEach(element => element.textContent = '');
        dialog.querySelectorAll('[aria-invalid]').forEach(element => element.removeAttribute('aria-invalid'));
        const names = Object.keys(errors).filter(name => Object.hasOwn(messages, name));
        for (const name of names) {
            dialog.querySelector(`#${name}-error`).textContent = errors[name] === 'language_required' ? language.languageRequired : errors[name] === 'incomplete_translation' ? language.incompleteTranslation : messages[name];
            dialog.querySelector(`[name="${name}"]`)?.setAttribute('aria-invalid', 'true');
        }
        dialog.querySelector(`[name="${names[0]}"]`)?.focus();
    }

    async function submit(event) {
        event.preventDefault();
        if (pending) return;
        const validation = validateSubmission(readForm());
        showErrors(validation.errors);
        if (!validation.valid) { status(L().invalid); return; }
        if (!configuration?.ready || !token) { status(configuration?.ready ? L().verification : L().unavailable, !configuration?.ready); return; }
        pending = true;
        updateSubmit();
        dialog.querySelector('fieldset').disabled = true;
        dialog.querySelectorAll('[data-action="close"]').forEach(button => button.disabled = true);
        status(L().submitting);
        let succeeded = false;
        try {
            const response = await fetch(`${apiBase}/api/submissions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...validation.data, turnstileToken: token }), signal: AbortSignal.timeout(60000) });
            const result = await response.json();
            if (!response.ok) {
                if (result.fields) showErrors(result.fields);
                status(({ rate_limited: L().rate, duplicate_project: L().duplicate, verification_required: L().verificationFailed, verification_failed: L().verificationFailed, submission_in_progress: L().progress, invalid_submission: L().invalid })[result.error] || L().failed);
                return;
            }
            const url = new URL(result.url);
            const expected = `/${configuration.repository}/pull/`;
            if (url.origin !== 'https://github.com' || !url.pathname.startsWith(expected) || !/^\d+$/.test(url.pathname.slice(expected.length)) || !['created', 'existing'].includes(result.status)) throw new Error('invalid_response');
            const language = L();
            dialog.querySelector('form').hidden = true;
            const success = dialog.querySelector('.submission-success');
            success.hidden = false;
            success.innerHTML = `<span class="success-mark" aria-hidden="true">✓</span><h3 tabindex="-1">${result.status === 'created' ? language.created : language.existing}</h3><p>${result.status === 'created' ? language.createdDetail : language.existingDetail}</p><a class="project-link" href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${language.viewPull} #${Number(result.number)}</a><button data-action="another">${language.another}</button>`;
            success.querySelector('h3').focus();
            succeeded = true;
        } catch { status(L().failed); }
        finally {
            pending = false;
            token = '';
            if (widgetId !== undefined && window.turnstile) {
                if (succeeded) removeWidget(); else window.turnstile.reset(widgetId);
            }
            dialog.querySelector('fieldset').disabled = false;
            dialog.querySelectorAll('[data-action="close"]').forEach(button => button.disabled = false);
            updateSubmit();
        }
    }

    dialog.addEventListener('submit', submit);
    dialog.addEventListener('change', event => {
        if (event.target.name === 'source') dialog.querySelector('#submission-source-other').hidden = event.target.value !== 'Other';
    });
    dialog.addEventListener('click', event => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'close' && !pending) dialog.close();
        if (action === 'retry') void connect();
        if (action === 'another') { render(); void connect(); }
    });
    dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
    dialog.addEventListener('close', () => { generation++; removeWidget(); openedFrom?.focus(); });
    document.getElementById('contributeBtn').addEventListener('click', event => {
        event.preventDefault();
        openedFrom = event.currentTarget;
        if (!dialog.querySelector('form').hidden) render(readForm());
        dialog.showModal();
        if (!dialog.querySelector('form').hidden) void connect();
    });
    render();
    return { updateLanguage() { if (!pending) render(readForm()); } };
}
