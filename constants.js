// The `name`/`hint` strings are English source text translated at their render
// sites in extension.js via `_()`. They are deliberately not wrapped here: this
// module is evaluated at import time, before the extension binds its gettext
// domain, so a top-level `_()` would capture the untranslated string forever.
export const MODES = [
    {id: 'apps', icon: 'view-app-grid-symbolic', name: 'Applications', hint: 'Search apps'},
    {id: 'files', icon: 'folder-symbolic', name: 'Files', hint: 'Search files'},
    {id: 'actions', icon: 'view-list-symbolic', name: 'Actions', hint: 'Search actions'},
    {id: 'clipboard', icon: 'edit-copy-symbolic', name: 'Clipboard', hint: 'Search clipboard'},
];
export const SKIP = new Set(['node_modules', 'target', 'vendor', '__pycache__']);
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp'];
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const MAX_CLIPBOARD_BYTES = 32 * 1024 * 1024;
export const SCROLL_INDICATOR_HIDE_DELAY = 850;
// Apple's 642 px-wide Tahoe Apps reference uses seven columns, roughly 48 px
// icons and an 11 px label.  The launcher surface is 708 px wide, so keep the
// same proportions after scaling instead of stretching a six-column grid.
export const APP_GRID_MAX_COLUMNS = 7;
export const APP_GRID_MIN_CELL_WIDTH = 92;
export const APP_GRID_ICON_SIZE = 54;
export const APP_GRID_GAP = 4;
export const APP_GRID_HORIZONTAL_INSET = 32;
export const MOTION = Object.freeze({
    open: 180,
    close: 135,
    morph: 250,
    modes: 165,
    content: 155,
    press: 85,
    release: 165,
});
