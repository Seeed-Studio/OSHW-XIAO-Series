// Attach a shared full-description preview to the project grid; return its dismiss handler.
export function initDescriptionPreview(grid) {
    const preview = document.createElement('div');
    preview.id = 'description-preview';
    preview.className = 'description-preview';
    preview.setAttribute('popover', 'manual');
    preview.setAttribute('role', 'tooltip');
    preview.tabIndex = 0;
    document.body.append(preview);
    let active;
    let closeTimer;

    function dismiss() {
        clearTimeout(closeTimer);
        active?.removeAttribute('aria-describedby');
        active = undefined;
        if (preview.matches(':popover-open')) preview.hidePopover();
    }

    // Place the preview within the viewport, above or below the active description.
    function position() {
        const rect = active.getBoundingClientRect();
        const width = preview.offsetWidth;
        const height = preview.offsetHeight;
        const below = innerHeight - rect.bottom - 12;
        const top = below >= height || below >= rect.top - 12 ? rect.bottom + 8 : rect.top - height - 8;
        preview.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
        preview.style.top = `${Math.max(12, Math.min(top, innerHeight - height - 12))}px`;
    }

    function show(description) {
        clearTimeout(closeTimer);
        if (active === description) return;
        dismiss();
        const text = description.dataset.fullDescription;
        if (!text?.trim()) return;
        active = description;
        preview.textContent = text;
        preview.scrollTop = 0;
        description.setAttribute('aria-describedby', preview.id);
        preview.showPopover();
        position();
    }

    function scheduleDismiss() {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(dismiss, 160);
    }

    grid.addEventListener('pointerover', event => {
        if (event.pointerType === 'touch') return;
        const description = event.target.closest('.card-description');
        if (description) show(description);
    });
    grid.addEventListener('pointerout', event => {
        if (active?.contains(event.target) && !active.contains(event.relatedTarget) && !preview.contains(event.relatedTarget)) scheduleDismiss();
    });
    grid.addEventListener('focusin', event => {
        const description = event.target.closest('.card-description');
        if (description) show(description);
    });
    grid.addEventListener('focusout', event => {
        if (active?.contains(event.target) && !preview.contains(event.relatedTarget)) scheduleDismiss();
    });
    preview.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    preview.addEventListener('pointerleave', event => {
        if (!active?.contains(event.relatedTarget)) scheduleDismiss();
    });
    preview.addEventListener('focusin', () => clearTimeout(closeTimer));
    preview.addEventListener('focusout', scheduleDismiss);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') dismiss();
    });
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', () => {
        if (active && (document.activeElement === active || preview.contains(document.activeElement))) position();
        else dismiss();
    });
    return dismiss;
}
