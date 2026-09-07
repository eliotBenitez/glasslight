import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Cairo from 'gi://cairo';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {GlassSurface} from './glass.js';
import {FILE_TYPES, localImageFiles, selectionBytes, localImageBytes} from './clipboardFiles.js';
import {CATEGORIES, categoryIds, catalogue} from './appCatalog.js';
import {MODES, SKIP, IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_CLIPBOARD_BYTES, SCROLL_INDICATOR_HIDE_DELAY,
    APP_GRID_MAX_COLUMNS, APP_GRID_MIN_CELL_WIDTH, APP_GRID_ICON_SIZE, APP_GRID_GAP,
    APP_GRID_HORIZONTAL_INSET, MOTION} from './constants.js';
import {fold, score} from './search.js';
import {evaluateExpression, formatCalcResult} from './calculator.js';
import {label, icon} from './widgets.js';
import {buildActions, quickAction} from './actions.js';
import {_, ngettext, format} from './i18n.js';

// Text preview reads only a bounded head of the file and clamps what it shows,
// so a huge log or unbounded stream can never balloon the launcher.
const MAX_PREVIEW_TEXT_BYTES = 128 * 1024;
const MAX_PREVIEW_TEXT_LINES = 24;
const MAX_PREVIEW_TEXT_CHARS = 1600;
const TEXT_PREVIEW_EXTENSIONS = ['.txt', '.md', '.markdown', '.text', '.log', '.csv',
    '.tsv', '.json', '.xml', '.yml', '.yaml', '.ini', '.conf', '.cfg', '.rst'];

export default class GlasslightExtension extends Extension {
    enable() {
        this._alive = true;
        this._generation = (this._generation ?? 0) + 1;
        this._settings = this.getSettings('org.gnome.shell.extensions.glasslight');
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._signals = [];
        this._surfaces = [];
        this._modeButtons = new Map();
        this._rows = [];
        this._files = [];
        this._clips = [];
        this._clipboardReadId = 0;
        this._clipboardCancel = null;
        this._clipboardMessage = '';
        this._clipboardCleared = false;
        this._previewReadId = 0;
        this._previewCancel = null;
        this._previewItem = null;
        this._previewOpen = false;
        this._mode = 'all';
        this._appCategory = 'all';
        this._appNavigating = false;
        this._appView = this._settings.get_string('apps-view');
        this._categoryKey = null;
        this._catalogWidth = null;
        this._searchTimer = 0;
        this._scrollIndicatorTimer = 0;
        this._tooltipTimer = 0;
        this._tooltipActive = false;
        this._actionSession = null;
        this._scheduledActions = new Map();
        this._scheduledActionId = 0;
        this._layoutLater = 0;
        this._animateNextLayout = false;
        this._renderedExpanded = null;
        this._renderedMode = null;
        this._animationSerial = 0;
        this._closing = false;
        this._grab = null;
        this._cancellable = new Gio.Cancellable();
        this._notifications = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._refreshApps();
        this._build();
        this._connect(this._interface, 'changed::color-scheme', () => this._applyTheme());
        this._connect(this._interface, 'changed::enable-animations', () => {
            if (!this._motionEnabled()) this._finishMotion();
        });
        this._connect(this._settings, 'changed::appearance', () => this._applyTheme());
        this._connect(this._settings, 'changed::blur-radius', () => this._applyTheme());
        this._connect(this._settings, 'changed::apps-view', () => {
            this._appView = this._settings.get_string('apps-view');
            this._queueSearch();
        });
        this._connect(AppFavorites.getAppFavorites(), 'changed', () => this._queueSearch());
        this._connect(this._settings, 'changed::remember-clipboard', () => {
            this._cancelClipboardRead();
            this._clips = [];
            if (this._overlay.visible && this._mode === 'clipboard') this._readClipboard();
        });
        this._connect(Main.layoutManager, 'monitors-changed', () => { if (this._overlay.visible) this._position(); });
        this._connect(St.ThemeContext.get_for_stage(global.stage), 'notify::scale-factor', () => {
            this._applyTheme();
            if (this._overlay.visible) this._position();
        });
        this._connect(Gio.AppInfoMonitor.get(), 'changed', () => {
            this._refreshApps();
            this._queueSearch();
        });
        this._connect(global.display.get_selection(), 'owner-changed', (_selection, type) => {
            if (type !== Meta.SelectionType.SELECTION_CLIPBOARD) return;
            // A new copy (even of identical content) may enter history again.
            this._clipboardCleared = false;
            this._cancelClipboardRead();
            if (!this._settings.get_boolean('remember-clipboard')) this._clips = [];
            if (this._settings.get_boolean('remember-clipboard') || (this._overlay.visible && this._mode === 'clipboard'))
                this._readClipboard();
        });
        this._applyTheme();
        if (this._settings.get_boolean('remember-clipboard')) this._readClipboard();
        this._startIndex();
        Main.wm.addKeybinding('toggle-glasslight', this._settings, Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this._overlay.visible && !this._closing ? this._hide() : this._show());
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    disable() {
        this._alive = false;
        this._generation++;
        this._previewCancel?.cancel();
        this._previewCancel = null;
        this._previewOpen = false;
        this._cancelClipboardRead();
        this._cancelActionSession();
        for (const source of this._scheduledActions?.values() ?? []) GLib.source_remove(source);
        this._scheduledActions?.clear();
        Main.wm.removeKeybinding('toggle-glasslight');
        this._cancellable?.cancel();
        if (this._tooltipTimer) GLib.source_remove(this._tooltipTimer);
        this._tooltipTimer = 0;
        this._hide(true);
        if (this._layoutLater) global.compositor.get_laters().remove(this._layoutLater);
        this._layoutLater = 0;
        this._hideScrollIndicator();
        for (const [object, id] of this._signals ?? []) object.disconnect(id);
        this._signals = [];
        this._overlay?.destroy();
        this._overlay = null;
        this._searchIcon = null;
        this._searchShortcut = null;
        this._surfaces = [];
        this._clips = [];
        this._files = [];
        this._apps = [];
        this._catalog = [];
        this._rows = [];
        this._modeButtons?.clear();
        this._categoryButtons?.clear();
        this._viewButtons?.clear();
        this._settings = null;
        this._interface = null;
        this._notifications = null;
    }

    _surface(content, radius) {
        const surface = new GlassSurface(content, radius);
        this._surfaces.push(surface);
        return surface;
    }

    _build() {
        // uiGroup has no layout. Use an explicit fixed container, not a BinLayout
        // that competes with manually assigned x/y coordinates.
        this._overlay = new St.Widget({name: 'glasslight', visible: false, reactive: true,
            layout_manager: new Clutter.FixedLayout(), style_class: 'glasslight-root'});
        // Both states occupy the same 708px stage. The main glass can therefore
        // grow beneath the mode bubbles while they dematerialize, instead of
        // making the entire launcher jump sideways during the morph.
        this._group = new St.Widget({style_class: 'glasslight-launcher',
            layout_manager: new Clutter.FixedLayout(), y_align: Clutter.ActorAlign.START});
        this._group.set_pivot_point(0.5, 0.0);
        const column = new St.BoxLayout({vertical: true, style_class: 'glasslight-column'});
        this._searchRow = new St.BoxLayout({style_class: 'glasslight-search-row'});
        this._backButton = this._toolButton('go-previous-symbolic', _('Back to Glasslight'), () => {
            if (this._actionSession) {
                this._cancelActionSession();
                return;
            }
            this._entry.set_text('');
            this._setMode('all');
        });
        this._searchRow.add_child(this._backButton);
        this._searchIcon = new St.Icon({icon_name: 'system-search-symbolic', icon_size: 24,
            y_align: Clutter.ActorAlign.CENTER, style_class: 'glasslight-search-icon'});
        this._searchRow.add_child(this._searchIcon);
        this._entry = new St.Entry({hint_text: _('Glasslight Search'), style_class: 'glasslight-entry',
            can_focus: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._searchRow.add_child(this._entry);
        // Right-aligned keyboard hint that appears while a mode chip is hovered.
        this._searchShortcut = new St.Label({style_class: 'glasslight-search-shortcut', visible: false,
            y_align: Clutter.ActorAlign.CENTER});
        this._searchRow.add_child(this._searchShortcut);
        column.add_child(this._searchRow);
        this._details = new St.BoxLayout({vertical: true, style_class: 'glasslight-details', visible: false});
        const heading = new St.BoxLayout({style_class: 'glasslight-heading'});
        this._normalHeading = heading;
        this._heading = label('', 'glasslight-section');
        heading.add_child(this._heading);
        this._clearButton = new St.Button({label: _('Clear'), style_class: 'glasslight-clear', can_focus: true});
        this._clearButton.connect('clicked', () => {
            this._cancelClipboardRead();
            // Keep the system clipboard intact, but do not re-import its
            // unchanged contents when the panel is opened again.
            this._clipboardCleared = true;
            this._clips = [];
            this._clipboardMessage = '';
            this._render();
        });
        heading.add_child(this._clearButton);
        this._details.add_child(heading);
        this._buildAppControls();
        this._list = new St.BoxLayout({vertical: true, style_class: 'glasslight-list'});
        this._scroll = new St.ScrollView({style_class: 'glasslight-scroll', overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
        this._scroll.set_child(this._list);
        this._connect(this._scroll.vadjustment, 'notify::value', () => this._showScrollIndicator());
        this._connect(this._scroll, 'scroll-event', () => {
            this._showScrollIndicator();
            return Clutter.EVENT_PROPAGATE;
        });
        this._details.add_child(this._scroll);
        this._status = label('', 'glasslight-status');
        this._details.add_child(this._status);
        column.add_child(this._details);
        this._mainSurface = this._surface(column, 30);
        this._mainSurface.y_align = Clutter.ActorAlign.START;
        this._group.add_child(this._mainSurface);
        this._modeBar = new St.BoxLayout({style_class: 'glasslight-modes', y_align: Clutter.ActorAlign.START});
        for (const [i, mode] of MODES.entries()) {
            const shortcut = `Ctrl+${i + 1}`;
            const button = new St.Button({style_class: 'glasslight-mode', can_focus: true, reactive: true,
                track_hover: true, accessible_name: `${_(mode.name)} (${shortcut})`});
            button.set_child(new St.Icon({icon_name: mode.icon, icon_size: 24}));
            button.connect('clicked', () => {
                this._hideModeTooltip();
                this._setMode(this._mode === mode.id ? 'all' : mode.id);
            });
            const surface = this._surface(button, 28);
            surface.y_align = Clutter.ActorAlign.START;
            button.connect('button-press-event', () => {
                this._animateModeButton(surface, true);
                return Clutter.EVENT_PROPAGATE;
            });
            button.connect('button-release-event', () => {
                this._animateModeButton(surface, false);
                return Clutter.EVENT_PROPAGATE;
            });
            // Hover reveals the macOS-style hint (icon, name, shortcut) inside
            // the search bar. Keyboard focus surfaces it too so the hint is
            // reachable without a pointer.
            button.connect('notify::hover', () =>
                button.hover ? this._queueModeTooltip(mode, shortcut) : this._hideModeTooltip());
            button.connect('key-focus-in', () => this._showModeTooltip(mode, shortcut));
            button.connect('key-focus-out', () => this._hideModeTooltip());
            this._modeBar.add_child(surface);
            this._modeButtons.set(mode.id, button);
        }
        this._group.add_child(this._modeBar);
        this._overlay.add_child(this._group);
        // Quick Look-style preview: a dimmed layer over the active monitor with a
        // centered card. Sits above the launcher so it captures pointer and can be
        // dismissed by clicking outside the card.
        this._preview = new St.Widget({style_class: 'glasslight-preview-layer', visible: false,
            reactive: true, layout_manager: new Clutter.BinLayout()});
        this._previewCard = new St.BoxLayout({vertical: true, style_class: 'glasslight-preview-card',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this._preview.add_child(this._previewCard);
        this._preview.connect('button-press-event', () => {
            this._closePreview();
            return Clutter.EVENT_STOP;
        });
        this._overlay.add_child(this._preview);
        Main.layoutManager.addTopChrome(this._overlay);
        this._entry.clutter_text.connect('text-changed', () => {
            this._appNavigating = false;
            this._queueSearch();
        });
        this._entry.connect('button-press-event', () => {
            this._appNavigating = false;
            return Clutter.EVENT_PROPAGATE;
        });
        // Handle navigation before ClutterText consumes Enter/arrow keys.
        this._overlay.connect('captured-event', (_actor, event) =>
            event.type() === Clutter.EventType.KEY_PRESS ? this._key(event) : Clutter.EVENT_PROPAGATE);
        this._overlay.connect('button-press-event', (_actor, event) => {
            const [x, y] = event.get_coords();
            const [gx, gy] = this._group.get_transformed_position();
            if (x < gx || x >= gx + this._group.width || y < gy || y >= gy + this._group.height) {
                this._hide();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _refreshApps() {
        this._apps = Gio.AppInfo.get_all().filter(app => app.should_show());
        this._catalog = this._apps.map(app => {
            const categories = categoryIds(app.get_categories?.());
            return {id: app.get_id() ?? app.get_name(), title: app.get_display_name(),
                categories, detail: _(CATEGORIES.find(c => c.id === categories[0]).name),
                keywords: `${app.get_description() ?? ''} ${(app.get_keywords?.() ?? []).join(' ')}`,
                gicon: app.get_icon(), activate: () => app.launch([], global.create_app_launch_context(0, -1))};
        });
    }

    _toolButton(symbol, name, callback) {
        const button = new St.Button({style_class: 'glasslight-tool', can_focus: true,
            track_hover: true, accessible_name: name, y_align: Clutter.ActorAlign.CENTER});
        button.set_child(new St.Icon({icon_name: symbol, icon_size: 16}));
        button.connect('clicked', callback);
        return button;
    }

    _buildAppControls() {
        this._appToolbar = new St.BoxLayout({style_class: 'glasslight-app-toolbar', visible: false});
        this._categoryPrevious = this._toolButton('go-previous-symbolic', _('Previous category (Alt+←)'), () => this._cycleCategory(-1));
        this._categoryNext = this._toolButton('go-next-symbolic', _('Next category (Alt+→)'), () => this._cycleCategory(1));
        this._categories = new St.BoxLayout({style_class: 'glasslight-categories'});
        this._categoryScroll = new St.ScrollView({x_expand: true,
            hscrollbar_policy: St.PolicyType.EXTERNAL, vscrollbar_policy: St.PolicyType.NEVER});
        this._categoryScroll.set_child(this._categories);
        this._appToolbar.add_child(this._categoryPrevious);
        this._appToolbar.add_child(this._categoryScroll);
        this._appToolbar.add_child(this._categoryNext);
        this._viewButton = this._toolButton('view-more-symbolic', _('Catalogue view'), () => {
            this._viewOptions.visible = !this._viewOptions.visible;
            this._scheduleLayout();
        });
        this._appToolbar.add_child(this._viewButton);
        this._details.add_child(this._appToolbar);
        this._viewOptions = new St.BoxLayout({style_class: 'glasslight-view-options', visible: false});
        this._viewOptions.add_child(label(_('Catalogue view'), 'glasslight-section'));
        this._viewButtons = new Map();
        for (const [id, title, symbol] of [['grid', _('Grid'), 'view-grid-symbolic'], ['list', _('List'), 'view-list-symbolic']]) {
            const button = new St.Button({style_class: 'glasslight-view-choice', can_focus: true,
                toggle_mode: true, accessible_name: title, track_hover: true});
            const content = new St.BoxLayout({style_class: 'glasslight-view-choice-content'});
            content.add_child(new St.Icon({icon_name: symbol, icon_size: 16}));
            content.add_child(label(title, 'glasslight-section'));
            button.set_child(content);
            button.connect('clicked', () => {
                this._appView = id;
                this._settings.set_string('apps-view', id);
                this._render();
                button.grab_key_focus();
            });
            this._viewButtons.set(id, button);
            this._viewOptions.add_child(button);
        }
        this._details.add_child(this._viewOptions);
    }

    _cycleCategory(delta) {
        const categories = this._availableCategories();
        const next = (categories.findIndex(c => c.id === this._appCategory) + delta + categories.length) % categories.length;
        this._chooseCategory(categories[next].id);
    }

    _availableCategories() {
        return CATEGORIES.filter(c => c.id === 'all' || this._catalog.some(app => app.categories.includes(c.id)));
    }

    _chooseCategory(id) {
        this._appCategory = id;
        this._appNavigating = false;
        this._render();
        this._entry.clutter_text.grab_key_focus();
    }

    _renderApps(query) {
        const categories = this._availableCategories();
        if (!categories.some(c => c.id === this._appCategory)) this._appCategory = 'all';
        // Keep category buttons alive across search updates so keyboard focus
        // is not lost as the result set changes.
        const categoryKey = categories.map(c => c.id).join(',');
        if (this._categoryKey !== categoryKey) {
            this._categoryKey = categoryKey;
            this._categories.destroy_all_children();
            this._categoryButtons = new Map();
            for (const category of categories) {
                const button = new St.Button({style_class: 'glasslight-category',
                    can_focus: true, toggle_mode: true, accessible_name: _(category.name), track_hover: true});
                // Preserve intrinsic widths: the strip scrolls instead of
                // squeezing every category into an unreadable ellipsis.
                const caption = label(_(category.name), '');
                caption.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
                button.set_child(caption);
                button.connect('clicked', () => this._chooseCategory(category.id));
                button.connect('key-focus-in', () => this._revealCategory(button));
                this._categories.add_child(button);
                this._categoryButtons.set(category.id, button);
            }
        }
        for (const [id, button] of this._categoryButtons) button.checked = id === this._appCategory;
        for (const [id, button] of this._viewButtons) button.checked = id === this._appView;
        const width = this._catalogWidth ?? 708;
        this._appColumns = this._appView === 'grid'
            ? Math.max(2, Math.min(APP_GRID_MAX_COLUMNS,
                Math.floor((width - APP_GRID_HORIZONTAL_INSET) / APP_GRID_MIN_CELL_WIDTH)))
            : 1;
        const favorites = AppFavorites.getAppFavorites().getFavorites().map(app => app.get_id());
        const used = Shell.AppUsage.get_default().get_most_used().map(app => app.get_id());
        const {suggestions, items, total} = catalogue(this._catalog, this._appCategory, query, [...favorites, ...used], this._appColumns === 1 ? 6 : this._appColumns);
        this._appVisualRow = 0;
        if (suggestions.length) this._appendAppSection(_('Suggested'), suggestions);
        const title = query ? format(_('Results · %d'), total)
            : this._appCategory === 'all' ? _('All applications') : _(categories.find(c => c.id === this._appCategory).name);
        if (items.length) this._appendAppSection(title, items);
        if (!total) this._list.add_child(label(query ? _('No applications found in this category') : _('No applications available'), 'glasslight-empty'));
        const count = format(ngettext('%d app', '%d apps', total), total);
        this._status.text = format(_('%s  ·  ↑ ↓ ← → select  ·  ↵ open  ·  Alt+←/→ categories'), count);
    }

    _appendAppSection(title, items) {
        this._list.add_child(label(title, 'glasslight-app-section glasslight-section'));
        const grid = this._appView === 'grid';
        const columns = this._appColumns;
        const cellWidth = Math.floor(((this._catalogWidth ?? 708) - APP_GRID_HORIZONTAL_INSET
            - (columns - 1) * APP_GRID_GAP) / columns);
        let line;
        items.forEach((item, offset) => {
            if (offset % columns === 0) {
                line = new St.BoxLayout({style_class: 'glasslight-app-line', x_expand: true});
                this._list.add_child(line);
                this._appVisualRow++;
            }
            const button = new St.Button({style_class: grid ? 'glasslight-result glasslight-app-tile' : 'glasslight-result',
                style: grid ? `width: ${cellWidth}px;` : '', x_expand: !grid, can_focus: true,
                track_hover: true, accessible_name: `${item.title}, ${item.detail}`,
                x_align: Clutter.ActorAlign.FILL});
            const content = new St.BoxLayout({vertical: grid, style_class: grid ? 'glasslight-app-tile-content' : 'glasslight-result-row',
                x_expand: true, x_align: Clutter.ActorAlign.FILL});
            const appIcon = icon(item.gicon);
            appIcon.icon_size = grid ? APP_GRID_ICON_SIZE : 28;
            appIcon.x_align = grid ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.START;
            content.add_child(appIcon);
            const texts = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            const name = label(item.title, grid ? 'glasslight-app-name' : 'glasslight-title');
            if (grid) {
                name.x_align = Clutter.ActorAlign.CENTER;
                name.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
            }
            texts.add_child(name);
            if (!grid) texts.add_child(label(item.detail, 'glasslight-subtitle'));
            content.add_child(texts);
            button.set_child(content);
            const index = this._rows.length;
            button.connect('clicked', () => this._activate(item.activate));
            button.connect('notify::hover', () => {if (button.hover) this._select(index, false);});
            button.connect('key-focus-in', () => this._select(index));
            button.connect('notify::allocation', () => {
                if (global.stage.get_key_focus() === button && this._rows[index]?.button === button)
                    this._select(index);
            });
            line.add_child(button);
            this._rows.push({button, item, appIcon, name,
                visualRow: this._appVisualRow, column: offset % columns});
        });
    }

    _revealCategory(button) {
        if (!button?.get_stage()) return;
        const adj = this._categoryScroll.hadjustment;
        const box = button.get_allocation_box();
        if (box.x1 < adj.value) adj.value = box.x1;
        else if (box.x2 > adj.value + adj.page_size) adj.value = box.x2 - adj.page_size;
    }

    _appKey(key, state) {
        const focus = global.stage.get_key_focus();
        const entry = focus === this._entry.clutter_text;
        const focusedRow = this._rows.findIndex(row => row.button === focus);
        if ((state & Clutter.ModifierType.MOD1_MASK) && (key === Clutter.KEY_Left || key === Clutter.KEY_Right)) {
            this._cycleCategory(key === Clutter.KEY_Left ? -1 : 1);
            return true;
        }
        if (key === Clutter.KEY_Tab || key === Clutter.KEY_ISO_Left_Tab) {
            // One roving result tab stop, not hundreds of app icons.
            const stops = [this._entry.clutter_text, this._backButton, this._categoryPrevious,
                ...this._categoryButtons.values(), this._categoryNext, this._viewButton,
                ...(this._viewOptions.visible ? [...this._viewButtons.values()] : []),
                this._rows[this._selected]?.button].filter(Boolean);
            const delta = key === Clutter.KEY_ISO_Left_Tab || (state & Clutter.ModifierType.SHIFT_MASK) ? -1 : 1;
            stops[(stops.indexOf(focus) + delta + stops.length) % stops.length].grab_key_focus();
            return true;
        }
        const vertical = key === Clutter.KEY_Up || key === Clutter.KEY_Down;
        const horizontal = key === Clutter.KEY_Left || key === Clutter.KEY_Right;
        if ((entry || focusedRow >= 0) && (vertical || (horizontal && (this._appNavigating || focusedRow >= 0)))) {
            if (!this._rows.length) return true;
            let next = this._selected;
            if (entry && !this._appNavigating) next = 0;
            else if (horizontal) next = Math.max(0, Math.min(this._rows.length - 1, next + (key === Clutter.KEY_Left ? -1 : 1)));
            else {
                const current = this._rows[next];
                const target = current.visualRow + (key === Clutter.KEY_Up ? -1 : 1);
                const candidates = this._rows.map((r, index) => ({...r, index})).filter(r => r.visualRow === target);
                if (candidates.length) next = candidates.reduce((a, b) => Math.abs(a.column - current.column) <= Math.abs(b.column - current.column) ? a : b).index;
            }
            this._appNavigating = true;
            this._select(next);
            if (focusedRow >= 0) this._rows[this._selected].button.grab_key_focus();
            return true;
        }
        return false;
    }

    _applyTheme() {
        const choice = this._settings.get_string('appearance');
        const dark = choice === 'dark' || (choice === 'system' && this._interface.get_string('color-scheme') === 'prefer-dark');
        this._overlay.set_style_class_name(`glasslight-root ${dark ? 'glasslight-dark' : 'glasslight-light'}`);
        const radius = this._settings.get_int('blur-radius');
        // Match _render's corner radii so changing theme/scale while idle does
        // not shift the main surface (expanded 22, idle 30; mode chips 28).
        for (const surface of this._surfaces)
            surface.configure(surface === this._mainSurface ? (this._details.visible ? 22 : 30) : 28, radius);
        this._scheduleLayout(false);
    }

    _motionEnabled() {
        return this._interface?.get_boolean('enable-animations') ?? true;
    }

    _scrollable() {
        const adjustment = this._scroll?.vadjustment;
        return adjustment && adjustment.upper > adjustment.page_size + 0.5;
    }

    _showScrollIndicator() {
        if (!this._scrollable()) {
            this._hideScrollIndicator();
            return;
        }
        if (this._scrollIndicatorTimer) GLib.source_remove(this._scrollIndicatorTimer);
        this._scrollIndicatorTimer = 0;
        this._scroll.add_style_class_name('scrolling');
        this._scrollIndicatorTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            SCROLL_INDICATOR_HIDE_DELAY, () => {
                this._scrollIndicatorTimer = 0;
                this._scroll?.remove_style_class_name('scrolling');
                return GLib.SOURCE_REMOVE;
            });
    }

    _hideScrollIndicator() {
        if (this._scrollIndicatorTimer) GLib.source_remove(this._scrollIndicatorTimer);
        this._scrollIndicatorTimer = 0;
        this._scroll?.remove_style_class_name('scrolling');
    }

    _queueModeTooltip(mode, shortcut) {
        if (this._tooltipTimer) GLib.source_remove(this._tooltipTimer);
        this._tooltipTimer = 0;
        // Once the hint is showing, gliding to a neighbouring chip swaps it
        // instantly; otherwise a small delay avoids flickering the bar during a
        // quick sweep across the chips.
        if (this._tooltipActive) {
            this._showModeTooltip(mode, shortcut);
            return;
        }
        this._tooltipTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            this._tooltipTimer = 0;
            this._showModeTooltip(mode, shortcut);
            return GLib.SOURCE_REMOVE;
        });
    }

    _showModeTooltip(mode, shortcut) {
        if (this._tooltipTimer) GLib.source_remove(this._tooltipTimer);
        this._tooltipTimer = 0;
        // The hint only makes sense in the compact idle bar, where the entry is
        // empty and its placeholder is free to borrow.
        if (!this._searchIcon || !this._modeBar.visible) return;
        this._tooltipActive = true;
        this._searchIcon.icon_name = mode.icon;
        this._searchIcon.add_style_class_name('glasslight-search-icon-hint');
        this._entry.hint_text = _(mode.name);
        this._searchShortcut.text = shortcut;
        this._searchShortcut.show();
    }

    _hideModeTooltip() {
        if (this._tooltipTimer) GLib.source_remove(this._tooltipTimer);
        this._tooltipTimer = 0;
        if (!this._tooltipActive || !this._searchIcon) return;
        this._tooltipActive = false;
        this._searchIcon.icon_name = 'system-search-symbolic';
        this._searchIcon.remove_style_class_name('glasslight-search-icon-hint');
        this._entry.hint_text = this._modeHint();
        this._searchShortcut.hide();
    }

    // Localized placeholder for a mode's search entry. Falls back to the generic
    // Glasslight hint for the "all" mode, which has no MODES entry.
    _modeHint(mode = this._mode) {
        const hint = MODES.find(m => m.id === mode)?.hint;
        return hint ? _(hint) : _('Glasslight Search');
    }

    _duration(value) {
        return this._motionEnabled() ? value : 0;
    }

    _scheduleLayout(animate = false) {
        if (!this._alive || !this._overlay.visible) return;
        this._animateNextLayout ||= animate;
        if (this._layoutLater) return;
        this._layoutLater = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._layoutLater = 0;
            const shouldAnimate = this._animateNextLayout;
            this._animateNextLayout = false;
            this._position(shouldAnimate);
            return GLib.SOURCE_REMOVE;
        });
    }

    _position(animate = false) {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const monitor = Main.layoutManager.monitors[this._monitorIndex] ?? Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        this._overlay.set_size(global.stage.width, global.stage.height);
        if (this._previewOpen) {
            this._preview.set_position(monitor.x, monitor.y);
            this._preview.set_size(monitor.width, monitor.height);
        }
        const expandedWidth = Math.max(300, Math.min(708, monitor.width / scale - 48));
        const modeWidth = 4 * 56 + 3 * 10;
        const compactWidth = Math.max(260, Math.min(440, expandedWidth - modeWidth - 14));
        const targetWidth = this._renderedExpanded ? expandedWidth : compactWidth;
        if (this._mode === 'apps' && this._catalogWidth !== expandedWidth) {
            this._catalogWidth = expandedWidth;
            this._render();
            return;
        }
        this._scroll.set_style(`max-height: ${Math.max(160, Math.min(390, monitor.height / scale - 220))}px;`);
        const targetHeight = this._mainSurface.naturalHeight(targetWidth);
        const groupHeight = Math.max(62, targetHeight);
        this._group.set_size(expandedWidth, groupHeight);
        this._group.set_position(Math.round(monitor.x + (monitor.width - expandedWidth) / 2),
            Math.round(monitor.y + Math.max(24 * scale, Math.min(monitor.height * 0.26, monitor.height - groupHeight - 32 * scale))));
        this._mainSurface.set_position(0, 0);
        this._modeBar.set_position(compactWidth + 14, 0);
        const duration = animate ? this._duration(MOTION.morph) : 0;
        const sizeChanged = Math.abs(this._mainSurface.width - targetWidth) > 0.5 ||
            Math.abs(this._mainSurface.height - targetHeight) > 0.5;
        const finishResize = () => {
            this._mainSurface.refreshBlur();
            this._mainSurface.sync();
        };
        this._mainSurface.remove_transition('width');
        this._mainSurface.remove_transition('height');
        if (duration && this._mainSurface.width > 0 && this._mainSurface.height > 0) {
            this._mainSurface.ease({width: targetWidth, height: targetHeight, duration,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC, onComplete: finishResize});
        } else {
            this._mainSurface.set_size(targetWidth, targetHeight);
            if (sizeChanged) finishResize();
        }
        if (this._mode === 'apps') this._revealCategory(this._categoryButtons?.get(this._appCategory));
        for (const surface of this._surfaces) surface.sync();
    }

    _show() {
        if (!this._alive || (this._overlay.visible && !this._closing)) return;
        Main.overview.hide();
        const serial = ++this._animationSerial;
        this._closing = false;
        const [x, y] = global.get_pointer();
        this._monitorIndex = Main.layoutManager.monitors.findIndex(m => x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height);
        this._overlay.reactive = true;
        this._overlay.show();
        if (!this._grab) this._grab = Main.pushModal(this._overlay, {actionMode: Shell.ActionMode.POPUP});
        this._renderedExpanded = null;
        this._renderedMode = null;
        this._mode = 'all';
        this._actionSession = null;
        this._entry.set_text('');
        this._setMode('all');
        this._entry.clutter_text.grab_key_focus();
        this._position(false);
        this._group.remove_all_transitions();
        const duration = this._duration(MOTION.open);
        if (!duration) {
            this._finishMotion();
            return;
        }
        this._group.opacity = 0;
        this._group.scale_x = 0.965;
        this._group.scale_y = 0.965;
        this._group.translation_y = -6;
        for (const [index, surface] of this._surfaces.entries())
            surface.materialize(duration, Math.min(index * 12, 48));
        this._group.ease({opacity: 255, scale_x: 1, scale_y: 1, translation_y: 0,
            duration, mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {if (serial === this._animationSerial && !this._closing) this._finishMotion();}});
    }

    _hide(immediate = false) {
        this._closePreview();
        if (this._searchTimer) GLib.source_remove(this._searchTimer);
        this._searchTimer = 0;
        this._hideScrollIndicator();
        this._hideModeTooltip();
        if (this._grab) {Main.popModal(this._grab); this._grab = null;}
        if (!this._overlay?.visible) return;
        const serial = ++this._animationSerial;
        this._closing = true;
        this._overlay.reactive = false;
        this._group.remove_all_transitions();
        const duration = immediate ? 0 : this._duration(MOTION.close);
        if (!duration) {
            this._overlay.hide();
            this._closing = false;
            return;
        }
        for (const surface of this._surfaces) surface.dematerialize(duration);
        this._group.ease({opacity: 0, scale_x: 0.972, scale_y: 0.972, translation_y: -4,
            duration, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (serial !== this._animationSerial) return;
                this._overlay.hide();
                this._closing = false;
                this._finishMotion();
            }});
    }

    _finishMotion() {
        this._group?.remove_all_transitions();
        if (this._group) {
            this._group.opacity = 255;
            this._group.scale_x = 1;
            this._group.scale_y = 1;
            this._group.translation_y = 0;
        }
        for (const surface of this._surfaces ?? []) surface.settle();
    }

    _animateModeButton(surface, pressed) {
        surface.remove_transition('scale-x');
        surface.remove_transition('scale-y');
        const duration = this._duration(pressed ? MOTION.press : MOTION.release);
        const scale = pressed ? 0.955 : 1;
        if (pressed) surface.pulse(this._duration(190));
        if (!duration) {
            surface.scale_x = scale;
            surface.scale_y = scale;
            return;
        }
        surface.ease({scale_x: scale, scale_y: scale, duration,
            mode: pressed ? Clutter.AnimationMode.EASE_OUT_QUAD : Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    _animateState(previousExpanded, expanded, modeChanged) {
        const duration = this._duration(MOTION.modes);
        if (previousExpanded === null) {
            this._modeBar.visible = !expanded;
            this._modeBar.opacity = 255;
            for (const surface of this._modeBar.get_children()) {
                surface.scale_x = 1;
                surface.scale_y = 1;
                surface.translation_x = 0;
            }
            this._details.opacity = 255;
            this._details.translation_y = 0;
            return;
        }
        if (expanded !== previousExpanded) {
            this._mainSurface.pulse(this._duration(MOTION.morph));
            this._modeBar.remove_all_transitions();
            this._modeBar.show();
            if (expanded) {
                this._hideModeTooltip();
                this._details.opacity = 0;
                this._details.translation_y = -8;
                this._details.ease({opacity: 255, translation_y: 0,
                    duration: this._duration(MOTION.content), delay: this._duration(65),
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                this._modeBar.ease({opacity: 0, duration,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {if (this._renderedExpanded) this._modeBar.hide();}});
                for (const [index, surface] of this._modeBar.get_children().entries()) {
                    surface.ease({scale_x: 0.78, scale_y: 0.78,
                        translation_x: -8 - index * 3, duration,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD});
                }
            } else {
                this._modeBar.opacity = 0;
                for (const surface of this._modeBar.get_children()) {
                    surface.scale_x = 0.78;
                    surface.scale_y = 0.78;
                    surface.translation_x = -8;
                }
                this._modeBar.ease({opacity: 255, duration, delay: this._duration(55),
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                for (const [index, surface] of this._modeBar.get_children().entries()) {
                    surface.ease({scale_x: 1, scale_y: 1, translation_x: 0,
                        duration: this._duration(MOTION.morph), delay: this._duration(20 + index * 10),
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                }
            }
        } else if (expanded && modeChanged) {
            this._list.remove_all_transitions();
            this._list.opacity = 0;
            this._list.translation_y = 5;
            this._list.ease({opacity: 255, translation_y: 0,
                duration: this._duration(MOTION.content), mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            this._mainSurface.pulse(this._duration(190));
        }
    }

    _setMode(mode) {
        if (this._actionSession) this._actionSession = null;
        if (mode !== this._mode) this._appCategory = 'all';
        this._mode = mode;
        this._appNavigating = false;
        this._viewOptions.hide();
        for (const [id, button] of this._modeButtons) {
            if (id === mode) button.add_style_pseudo_class('selected');
            else button.remove_style_pseudo_class('selected');
        }
        this._entry.hint_text = this._modeHint(mode);
        if (mode === 'clipboard') this._readClipboard();
        this._render();
        this._entry.clutter_text.grab_key_focus();
    }

    _queueSearch() {
        if (!this._alive || !this._overlay.visible) return;
        if (this._searchTimer) GLib.source_remove(this._searchTimer);
        this._searchTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 35, () => {
            this._searchTimer = 0;
            if (this._alive && this._overlay.visible) this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    _key(event) {
        const key = event.get_key_symbol();
        const state = event.get_state();
        // While a preview is open, keys drive the preview, not the search entry.
        if (this._previewOpen) {
            if (key === Clutter.KEY_Escape || key === Clutter.KEY_space || key === Clutter.KEY_KP_Space) {
                this._closePreview();
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_Down || key === Clutter.KEY_Up) {
                this._select(this._selected + (key === Clutter.KEY_Up ? -1 : 1));
                this._openPreview(this._rows[this._selected]?.item);
                return Clutter.EVENT_STOP;
            }
            if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) {
                const button = this._rows[this._selected]?.button;
                this._closePreview();
                button?.emit('clicked', 1);
                return Clutter.EVENT_STOP;
            }
            this._closePreview();
            return Clutter.EVENT_STOP;
        }
        if ((key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) && this._searchTimer &&
            global.stage.get_key_focus() === this._entry.clutter_text) {
            GLib.source_remove(this._searchTimer);
            this._searchTimer = 0;
            this._render();
        }
        if ((state & Clutter.ModifierType.CONTROL_MASK) && key >= Clutter.KEY_0 && key <= Clutter.KEY_4) {
            this._setMode(key === Clutter.KEY_0 ? 'all' : MODES[key - Clutter.KEY_1].id);
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_Escape) {
            if (this._actionSession) this._cancelActionSession();
            else this._hide();
            return Clutter.EVENT_STOP;
        }
        if ((key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) && this._actionSession &&
            global.stage.get_key_focus() === this._entry.clutter_text) {
            const selected = this._rows[this._selected]?.item;
            if (selected?.actionChoice) this._runItem(selected);
            else this._advanceAction();
            return Clutter.EVENT_STOP;
        }
        if (this._mode === 'apps') {
            const handled = this._appKey(key, state);
            if (handled) return Clutter.EVENT_STOP;
            // Native buttons must receive their own arrows/Enter/Space.
            if (global.stage.get_key_focus() !== this._entry.clutter_text)
                return Clutter.EVENT_PROPAGATE;
        }
        if (key === Clutter.KEY_Down || key === Clutter.KEY_Up || key === Clutter.KEY_Tab || key === Clutter.KEY_ISO_Left_Tab) {
            const delta = key === Clutter.KEY_Up || key === Clutter.KEY_ISO_Left_Tab || (state & Clutter.ModifierType.SHIFT_MASK) ? -1 : 1;
            if (!this._rows.length && (key === Clutter.KEY_Tab || key === Clutter.KEY_ISO_Left_Tab)) {
                const ids = ['all', ...MODES.map(m => m.id)];
                this._setMode(ids[(ids.indexOf(this._mode) + delta + ids.length) % ids.length]);
            } else this._select(this._selected + delta);
            return Clutter.EVENT_STOP;
        }
        // Space previews the highlighted file or image (Quick Look). Only when the
        // entry is focused, so typing a space still works everywhere it should and
        // native buttons in the app grid keep their own Space activation.
        if ((key === Clutter.KEY_space || key === Clutter.KEY_KP_Space) &&
            global.stage.get_key_focus() === this._entry.clutter_text) {
            const item = this._rows[this._selected]?.item;
            if (item && (item.previewUri || item.previewBytes)) {
                this._openPreview(item);
                return Clutter.EVENT_STOP;
            }
        }
        // Let a focused button handle Enter itself. Otherwise launch the selected row.
        if ((key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) && global.stage.get_key_focus() === this._entry.clutter_text) {
            this._rows[this._selected]?.button.emit('clicked', 1);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _activate(callback) {
        this._hide();
        try { callback(); } catch (error) {
            console.error(`[Glasslight] ${error.stack ?? error}`);
            Main.notifyError('Glasslight', error.message);
        }
    }

    _runItem(item) {
        if (item.beginAction) {
            this._beginAction(item.beginAction, item.quickArgs ?? []);
            return;
        }
        if (item.actionChoice) {
            this._chooseActionValue(item.actionChoice);
            return;
        }
        if (item.actionAdvance) {
            this._advanceAction();
            return;
        }
        this._activate(item.activate);
    }

    _uri(uri) {Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));}

    _items(query) {
        const all = this._mode === 'all';
        if (this._actionSession) return this._actionItems();
        const result = [];
        if (all || this._mode === 'actions') {
            const calc = evaluateExpression(this._entry.get_text());
            const formatted = calc && formatCalcResult(calc.value);
            if (formatted) result.push({rank: 6000, title: `= ${formatted.display}`,
                detail: format(_('%s · Enter — copy'), this._entry.get_text().trim()),
                fallback: 'accessories-calculator-symbolic',
                styleClass: 'glasslight-action-result glasslight-calc-result',
                activate: () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, formatted.plain)});
        }
        if (all && !query) return result;
        if (all || this._mode === 'apps') for (const app of this._apps) {
            const rank = Math.max(score(query, app.get_display_name()), score(query, app.get_id()) * 0.8, score(query, app.get_description()) * 0.5);
            if (rank) result.push({rank: rank + 30, title: app.get_display_name(), detail: _('Application'), gicon: app.get_icon(),
                activate: () => app.launch([], global.create_app_launch_context(0, -1))});
        }
        if (all || this._mode === 'files') for (const file of this._files) {
            const rank = Math.max(score(query, file.name), score(query, file.directory) * 0.3);
            if (rank) result.push({rank, modified: file.modified, title: file.name, detail: file.directory,
                gicon: file.gicon, previewUri: file.uri, previewGicon: file.gicon,
                activate: () => this._uri(file.uri)});
        }
        const actions = this._actions();
        const quick = quickAction(this._entry.get_text(), actions);
        if (quick && (all || this._mode === 'actions'))
            result.push({...quick.action, beginAction: quick.action, quickArgs: quick.args,
                detail: format(_('Quick Key · %s'), quick.action.detail), rank: 5000});
        if (all || this._mode === 'actions') for (const action of actions) {
            const rank = Math.max(score(query, action.title), score(query, action.keywords));
            if (rank && action.id !== quick?.action.id)
                result.push({...action, beginAction: action, rank: rank + 10});
        }
        if (this._mode === 'clipboard') for (const clip of this._clips) {
            const rank = score(query, clip.kind === 'image' ? `${_('image picture screenshot')} ${clip.mime} ${clip.filename ?? ''}` : clip.text);
            if (rank) result.push(clip.kind === 'image'
                ? {rank, title: clip.filename ?? _('Image'), detail: format(_('%s · %d KB · %s'), clip.mime.slice(6).toUpperCase(), Math.ceil(clip.size / 1024), clip.clipboardMime ? _('Enter — copy file list') : _('Enter — copy')),
                    thumbnail: clip.thumbnail, thumbnailWidth: clip.thumbnailWidth, thumbnailHeight: clip.thumbnailHeight,
                    fallback: 'image-x-generic-symbolic', previewBytes: clip.bytes, previewMime: clip.mime,
                    activate: () => St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD,
                        clip.clipboardMime ?? clip.mime, clip.clipboardBytes ?? clip.bytes)}
                : {rank, title: clip.text.replace(/\s+/g, ' ').slice(0, 200), detail: _('Enter — copy'),
                    fallback: 'edit-copy-symbolic', activate: () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, clip.text)});
        }
        result.sort((a, b) => b.rank - a.rank || ((b.modified ?? 0) - (a.modified ?? 0)));
        const items = result.slice(0, all ? 10 : 40);
        if (query && all) items.push({title: format(_('Search the web for «%s»'), this._entry.get_text().trim()), detail: _('DuckDuckGo · default browser'),
            fallback: 'web-browser-symbolic', activate: () => this._uri(`https://duckduckgo.com/?q=${encodeURIComponent(this._entry.get_text().trim())}`)});
        return items;
    }

    _actions() {
        return buildActions({
            notifications: this._notifications,
            scheduleNotification: (seconds, title, body) => this._scheduleNotification(seconds, title, body),
            cancelClipboardRead: () => this._cancelClipboardRead(),
            clearClipboard: () => { this._clips = []; this._clipboardCleared = true; },
        });
    }

    _actionItems() {
        const session = this._actionSession;
        if (session.result) return [{title: session.result.value, detail: session.result.detail,
            fallback: 'edit-copy-symbolic', styleClass: 'glasslight-action-result',
            activate: () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, session.result.value)}];
        const param = session.action.params[session.index];
        const text = this._entry.get_text();
        if (param.choices) {
            const query = fold(text.trim());
            return param.choices.filter(choice => !query || score(query, `${choice.title} ${choice.detail}`))
                .map(choice => ({title: choice.title, detail: choice.detail, fallback: session.action.fallback,
                    actionChoice: choice.value}));
        }
        return [{title: text.length ? format(_('Continue with «%s»'), text.replace(/\s+/g, ' ').slice(0, 160)) : param.label,
            detail: session.error || param.hint, fallback: session.action.fallback, actionAdvance: true}];
    }

    _beginAction(action, quickArgs = []) {
        this._mode = 'actions';
        this._appNavigating = false;
        for (const [id, button] of this._modeButtons) {
            if (id === 'actions') button.add_style_pseudo_class('selected');
            else button.remove_style_pseudo_class('selected');
        }
        const session = {action, values: {}, index: 0, result: null, error: ''};
        this._actionSession = session;
        const supplied = action.quickValues?.(quickArgs) ?? {};
        let initial = '';
        while (session.index < action.params.length) {
            const param = action.params[session.index];
            const raw = supplied[param.id];
            if (raw === undefined || raw === '') {
                initial = raw ?? '';
                break;
            }
            try {
                session.values[param.id] = param.parse(String(raw), session.values);
                session.index++;
            } catch (_) {
                initial = String(raw);
                break;
            }
        }
        if (session.index >= action.params.length) {
            this._entry.set_text('');
            this._executeAction(action, session.values);
            return;
        }
        this._prepareActionParameter(initial);
    }

    _prepareActionParameter(initial = '') {
        const session = this._actionSession;
        if (!session || session.result) return;
        const param = session.action.params[session.index];
        session.error = '';
        this._entry.hint_text = param.hint;
        this._entry.set_text(initial);
        this._render();
        this._entry.clutter_text.grab_key_focus();
        if (param.prefillClipboard && !initial) {
            const expected = session;
            St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => {
                if (this._alive && this._actionSession === expected && !this._entry.get_text() && text) {
                    this._entry.set_text(text);
                    this._entry.clutter_text.set_selection(0, 0);
                }
            });
        }
    }

    _chooseActionValue(value) {
        const session = this._actionSession;
        if (!session || session.result) return;
        const param = session.action.params[session.index];
        try {
            session.values[param.id] = param.parse(String(value), session.values);
            session.index++;
            if (session.index >= session.action.params.length)
                this._executeAction(session.action, session.values);
            else this._prepareActionParameter();
        } catch (error) {
            session.error = error.message;
            this._render();
        }
    }

    _advanceAction() {
        const session = this._actionSession;
        if (!session) return;
        if (session.result) {
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, session.result.value);
            this._hide();
            return;
        }
        const param = session.action.params[session.index];
        try {
            session.values[param.id] = param.parse(this._entry.get_text(), session.values);
            session.index++;
            if (session.index >= session.action.params.length)
                this._executeAction(session.action, session.values);
            else this._prepareActionParameter();
        } catch (error) {
            session.error = error.message;
            this._render();
        }
    }

    _cancelActionSession() {
        if (!this._actionSession) return;
        this._actionSession = null;
        this._entry.set_text('');
        this._entry.hint_text = this._modeHint();
        if (this._alive && this._overlay?.visible) {
            this._render();
            this._entry.clutter_text.grab_key_focus();
        }
    }

    async _executeAction(action, values) {
        try {
            if (action.closeBeforeRun) this._hide();
            const result = await action.run(values);
            if (!this._alive) return;
            if (action.closeBeforeRun) {
                if (result?.notification) Main.notify('Glasslight', result.notification);
                return;
            }
            if (result?.value !== undefined) {
                this._actionSession = {action, values, index: action.params.length,
                    result: {value: String(result.value), detail: result.detail ?? _('Enter — copy')}, error: ''};
                this._entry.hint_text = _('Result');
                this._entry.set_text('');
                this._render();
                this._entry.clutter_text.grab_key_focus();
            } else {
                this._actionSession = null;
                this._hide();
                if (result?.notification) Main.notify('Glasslight', result.notification);
            }
        } catch (error) {
            console.warn(`[Glasslight] Action ${action.id}: ${error.stack ?? error}`);
            if (action.closeBeforeRun || !this._overlay?.visible) Main.notifyError('Glasslight', error.message);
            else {
                this._actionSession = null;
                if (this._overlay?.visible) {
                    this._entry.set_text('');
                    this._entry.hint_text = this._modeHint();
                    this._render();
                }
                Main.notifyError('Glasslight', error.message);
            }
        }
    }

    _scheduleNotification(seconds, title, body) {
        const id = ++this._scheduledActionId;
        const source = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._scheduledActions.delete(id);
            if (this._alive) Main.notify(title, body);
            return GLib.SOURCE_REMOVE;
        });
        this._scheduledActions.set(id, source);
    }

    _render() {
        if (!this._alive) return;
        const focusedApp = this._mode === 'apps'
            ? this._rows.find(row => row.button === global.stage.get_key_focus())?.item.id : null;
        const query = fold(this._entry.get_text().trim());
        const typing = this._entry.get_text().length > 0;
        const expanded = this._mode !== 'all' || typing;
        const previousExpanded = this._renderedExpanded;
        const modeChanged = this._renderedMode !== null && this._renderedMode !== this._mode;
        this._renderedExpanded = expanded;
        this._renderedMode = this._mode;
        this._list.destroy_all_children();
        this._rows = [];
        this._selected = -1;
        this._details.visible = expanded;
        const apps = this._mode === 'apps';
        this._backButton.visible = apps || !!this._actionSession;
        this._appToolbar.visible = apps;
        this._normalHeading.visible = !apps;
        if (!apps) this._viewOptions.hide();
        this._clearButton.visible = this._mode === 'clipboard' && this._clips.length > 0;
        const modeName = MODES.find(m => m.id === this._mode)?.name;
        this._heading.text = this._actionSession?.action.title ?? (modeName ? _(modeName) : _('Best matches'));
        if (apps) this._renderApps(query);
        else if (expanded) {
            const items = this._items(query);
            for (const item of items) {
                const button = new St.Button({style_class: `glasslight-result${item.styleClass ? ` ${item.styleClass}` : ''}`,
                    x_expand: true, can_focus: true,
                    track_hover: true, x_align: Clutter.ActorAlign.FILL});
                // St.Button is a Bin: explicitly fill its child so text cannot
                // collapse into a centred block (the previous wide-list bug).
                const row = new St.BoxLayout({style_class: 'glasslight-result-row', x_expand: true, x_align: Clutter.ActorAlign.FILL});
                if (item.thumbnail) {
                    const preview = new St.Bin({style_class: 'glasslight-clipboard-preview', y_align: Clutter.ActorAlign.CENTER});
                    preview.set_child(new St.Widget({content: item.thumbnail,
                        x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
                        style: `width: ${item.thumbnailWidth}px; height: ${item.thumbnailHeight}px;`}));
                    row.add_child(preview);
                } else row.add_child(icon(item.gicon, item.fallback));
                const texts = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
                texts.add_child(label(item.title, 'glasslight-title'));
                texts.add_child(label(item.detail, 'glasslight-subtitle'));
                row.add_child(texts);
                button.set_child(row);
                const index = this._rows.length;
                button.connect('clicked', () => this._runItem(item));
                button.connect('notify::hover', () => {if (button.hover) this._select(index, false);});
                this._list.add_child(button);
                this._rows.push({button, item});
            }
            if (!items.length) this._list.add_child(label(this._mode === 'clipboard' && !query ? _('No supported text or image in the clipboard') : _('No matches found'), 'glasslight-empty'));
            this._status.text = this._actionSession
                ? (this._actionSession.result ? _('↵  copy     esc  back to actions')
                    : format(_('%d of %d     ↵  continue     esc  cancel'), this._actionSession.index + 1, this._actionSession.action.params.length))
                : this._mode === 'clipboard'
                ? (this._clipboardMessage || (this._settings.get_boolean('remember-clipboard') ? _('History in memory only · up to 20 entries / 32 MiB') : _('Text and images · enable history in preferences')))
                : this._mode === 'files' ? format(ngettext('%d file', '%d files', this._files.length), this._files.length) + (this._indexing ? _(' · indexing…') : '') : _('↑ ↓  select     space  preview     ↵  open     esc  close');
        }
        this._mainSurface.configure(expanded ? 22 : 30, this._settings.get_int('blur-radius'));
        this._select(0, false);
        this._scroll.vadjustment.value = 0;
        // Rendering is not user scrolling; keep the overlay indicator
        // hidden until the wheel, touchpad, or keyboard actually moves it.
        this._hideScrollIndicator();
        if (focusedApp) {
            const index = this._rows.findIndex(row => row.item.id === focusedApp);
            if (index >= 0) {
                this._select(index, false);
                this._rows[index].button.grab_key_focus();
            } else this._entry.clutter_text.grab_key_focus();
        }
        this._animateState(previousExpanded, expanded, modeChanged);
        this._scheduleLayout(previousExpanded !== null && previousExpanded !== expanded);
    }

    _select(index, scroll = true) {
        if (!this._rows.length) return;
        this._selected = (index + this._rows.length) % this._rows.length;
        this._rows.forEach(({button}, i) => i === this._selected ? button.add_style_pseudo_class('selected') : button.remove_style_pseudo_class('selected'));
        if (!scroll) return;
        const actor = this._rows[this._selected].button;
        const adjustment = this._scroll.vadjustment;
        // Grid cells have nested parents; allocation_box is parent-relative.
        const y = actor.get_transformed_position()[1] - this._list.get_transformed_position()[1];
        const height = actor.get_transformed_size()[1];
        if (y < adjustment.value) adjustment.value = y;
        else if (y + height > adjustment.value + adjustment.page_size) adjustment.value = y + height - adjustment.page_size;
    }

    _cancelClipboardRead() {
        this._clipboardReadId++;
        this._clipboardCancel?.cancel();
        this._clipboardCancel = null;
    }

    // Upload decoded pixels into a GPU-backed St.ImageContent. Shared by the
    // clipboard thumbnails and the full-size preview panel.
    _imageContent(pixbuf) {
        const content = new St.ImageContent({preferred_width: pixbuf.width, preferred_height: pixbuf.height});
        content.set_data(global.stage.context.get_backend().get_cogl_context(),
            pixbuf.get_pixels(), pixbuf.has_alpha ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
            pixbuf.width, pixbuf.height, pixbuf.rowstride);
        return content;
    }

    // Largest preview image, in logical pixels, that fits the active monitor.
    _previewBounds() {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const monitor = Main.layoutManager.monitors[this._monitorIndex] ?? Main.layoutManager.primaryMonitor;
        const width = monitor ? Math.min(760, Math.round((monitor.width / scale) * 0.6)) : 760;
        const height = monitor ? Math.min(560, Math.round((monitor.height / scale) * 0.6)) : 560;
        return [Math.max(1, width), Math.max(1, height)];
    }

    _decodeBytes(bytes, cancel) {
        if (bytes.get_size() > MAX_IMAGE_BYTES)
            return Promise.reject(new Error(_('Image larger than 16 MiB — preview not loaded')));
        const [width, height] = this._previewBounds();
        const input = Gio.MemoryInputStream.new_from_bytes(bytes);
        return new Promise((resolve, reject) => GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
            input, width, height, true, cancel, (_source, result) => {
                try { resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result)); }
                catch (error) { reject(error); }
                finally { input.close(null); }
            }));
    }

    _decodeFile(file, cancel) {
        const [width, height] = this._previewBounds();
        return new Promise((resolve, reject) => file.read_async(GLib.PRIORITY_DEFAULT, cancel, (_source, result) => {
            let input;
            try { input = file.read_finish(result); } catch (error) { reject(error); return; }
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(input, width, height, true, cancel, (_s, res) => {
                try { resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(res)); }
                catch (error) { reject(error); }
                finally { input.close(null); }
            });
        }));
    }

    _formatBytes(size) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let value = size;
        let unit = 0;
        while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
        return `${unit ? value.toFixed(1) : value} ${units[unit]}`;
    }

    _isTextFile(type, name) {
        if (type.startsWith('text/')) return true;
        if (['application/json', 'application/xml', 'application/javascript', 'application/x-sh',
            'application/x-shellscript', 'application/x-yaml', 'application/toml',
            'application/x-desktop'].includes(type)) return true;
        const lower = name.toLowerCase();
        return TEXT_PREVIEW_EXTENSIONS.some(ext => lower.endsWith(ext));
    }

    // Read only the leading bytes of a text file, then clamp to a preview-sized
    // block of lines and characters. Never loads the whole file.
    _readTextHead(file, max, cancel) {
        return new Promise((resolve, reject) => file.read_async(GLib.PRIORITY_DEFAULT, cancel, (_source, result) => {
            let stream;
            try { stream = file.read_finish(result); } catch (error) { reject(error); return; }
            stream.read_bytes_async(max, GLib.PRIORITY_DEFAULT, cancel, (_s, res) => {
                let bytes;
                try { bytes = stream.read_bytes_finish(res); }
                catch (error) { stream.close_async(GLib.PRIORITY_DEFAULT, null, () => {}); reject(error); return; }
                stream.close_async(GLib.PRIORITY_DEFAULT, null, () => {});
                const raw = new TextDecoder('utf-8', {fatal: false}).decode(bytes.toArray());
                const lines = raw.split('\n');
                let text = lines.slice(0, MAX_PREVIEW_TEXT_LINES).join('\n');
                const truncated = lines.length > MAX_PREVIEW_TEXT_LINES || text.length > MAX_PREVIEW_TEXT_CHARS;
                text = text.slice(0, MAX_PREVIEW_TEXT_CHARS).replace(/\s+$/, '');
                resolve(truncated ? `${text}\n…` : text);
            });
        }));
    }

    // Render the first PDF page and return it as a GdkPixbuf. Poppler is imported
    // lazily so a system without the typelib simply falls back to the icon preview.
    // GJS cairo cannot hand back raw surface pixels, so the rendered page is
    // round-tripped through a short-lived temporary PNG.
    async _renderPdf(file, cancel) {
        const Poppler = (await import('gi://Poppler')).default;
        if (cancel.is_cancelled()) return null;
        const doc = Poppler.Document.new_from_gfile(file, null, cancel);
        const page = doc.get_page(0);
        if (!page) throw new Error(_('The document has no pages'));
        const [pageWidth, pageHeight] = page.get_size();
        const [maxWidth, maxHeight] = this._previewBounds();
        const scale = Math.max(0.1, Math.min(maxWidth / pageWidth, maxHeight / pageHeight));
        const width = Math.max(1, Math.round(pageWidth * scale));
        const height = Math.max(1, Math.round(pageHeight * scale));
        const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
        const context = new Cairo.Context(surface);
        context.scale(scale, scale);
        context.setSourceRGBA(1, 1, 1, 1);
        context.paint();
        page.render(context);
        surface.flush();
        const [tmp, stream] = Gio.File.new_tmp('glasslight-preview-XXXXXX.png');
        stream.close(null);
        try {
            surface.writeToPNG(tmp.get_path());
            if (cancel.is_cancelled()) return null;
            return await this._decodeFile(tmp, cancel);
        } finally {
            tmp.delete_async(GLib.PRIORITY_DEFAULT, null, () => {});
        }
    }

    // Quick Look-style preview for the highlighted file or clipboard image.
    // Clipboard images decode from their in-memory bytes; files are inspected and
    // decoded straight from disk when they are a not-too-large image, otherwise
    // shown as their themed icon with type and size metadata.
    _openPreview(item) {
        if (!item || !(item.previewUri || item.previewBytes)) { this._closePreview(); return; }
        this._previewCancel?.cancel();
        const cancel = new Gio.Cancellable();
        this._previewCancel = cancel;
        const request = ++this._previewReadId;
        const generation = this._generation;
        const current = () => this._alive && generation === this._generation &&
            request === this._previewReadId && !cancel.is_cancelled();
        this._previewItem = item;
        this._previewOpen = true;
        this._previewCard.destroy_all_children();
        const media = new St.Bin({style_class: 'glasslight-preview-media',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this._previewCard.add_child(media);
        const title = label(item.title ?? '', 'glasslight-preview-title');
        title.x_align = Clutter.ActorAlign.CENTER;
        title.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        this._previewCard.add_child(title);
        const caption = label(item.detail ?? '', 'glasslight-preview-caption');
        caption.x_align = Clutter.ActorAlign.CENTER;
        caption.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        this._previewCard.add_child(caption);
        const hint = label(_('Space or Esc to close'), 'glasslight-preview-hint');
        hint.x_align = Clutter.ActorAlign.CENTER;
        this._previewCard.add_child(hint);
        this._preview.show();
        this._position();
        const showIcon = gicon => media.set_child(new St.Icon({icon_size: 128, style_class: 'glasslight-preview-icon',
            gicon: gicon ?? new Gio.ThemedIcon({name: item.fallback ?? 'text-x-generic-symbolic'})}));
        const showImage = pixbuf => {
            media.set_child(new St.Widget({content: this._imageContent(pixbuf),
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
                style: `width: ${pixbuf.width}px; height: ${pixbuf.height}px;`}));
            this._position();
        };
        const showText = text => {
            const body = new St.Label({text: text || _('Empty file'), style_class: 'glasslight-preview-text-body'});
            // CSV/JSON rows have few spaces, so word wrap alone can't break them and
            // the line overflows the card. WORD_CHAR falls back to breaking mid-token.
            body.clutter_text.line_wrap = true;
            body.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            body.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            media.set_child(new St.Bin({style_class: 'glasslight-preview-text', child: body}));
            this._position();
        };
        showIcon(item.previewGicon);
        if (item.previewBytes) {
            this._decodeBytes(item.previewBytes, cancel)
                .then(pixbuf => { if (current()) showImage(pixbuf); })
                .catch(error => { if (current()) caption.text = format(_('Preview unavailable: %s'), error.message); });
            return;
        }
        const file = Gio.File.new_for_uri(item.previewUri);
        file.query_info_async('standard::content-type,standard::size,standard::icon',
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancel, (_source, result) => {
                let info;
                try { info = file.query_info_finish(result); }
                catch (error) { if (current()) caption.text = format(_('Preview unavailable: %s'), error.message); return; }
                if (!current()) return;
                const type = info.get_content_type() ?? '';
                const name = item.title ?? '';
                const size = info.get_size();
                caption.text = [item.detail, type, this._formatBytes(size)].filter(Boolean).join(' · ');
                showIcon(info.get_icon() ?? item.previewGicon);
                // The icon stays as the fallback; each renderer replaces it on success
                // and quietly leaves it in place on any failure.
                if (type.startsWith('image/') && size > 0 && size <= MAX_IMAGE_BYTES) {
                    this._decodeFile(file, cancel)
                        .then(pixbuf => { if (current()) showImage(pixbuf); })
                        .catch(() => {});
                } else if (type === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
                    this._renderPdf(file, cancel)
                        .then(pixbuf => { if (current() && pixbuf) showImage(pixbuf); })
                        .catch(() => {});
                } else if (this._isTextFile(type, name)) {
                    this._readTextHead(file, MAX_PREVIEW_TEXT_BYTES, cancel)
                        .then(text => { if (current()) showText(text); })
                        .catch(() => {});
                }
            });
    }

    _closePreview() {
        this._previewReadId++;
        this._previewCancel?.cancel();
        this._previewCancel = null;
        this._previewItem = null;
        if (!this._previewOpen) return;
        this._previewOpen = false;
        this._preview?.hide();
        this._previewCard?.destroy_all_children();
        if (this._overlay?.visible) this._entry.clutter_text.grab_key_focus();
    }

    async _imageClip(bytes, mime, cancel) {
        if (!bytes.get_size()) throw new Error(_('The clipboard returned an empty image'));
        if (bytes.get_size() > MAX_IMAGE_BYTES) throw new Error(_('Image larger than 16 MiB — preview not loaded'));
        const input = Gio.MemoryInputStream.new_from_bytes(bytes);
        try {
            const pixbuf = await new Promise((resolve, reject) => GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                input, 128, 128, true, cancel, (_source, result) => {
                    try {resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result));} catch (e) {reject(e);}
                }));
            if (cancel.is_cancelled()) throw new Error(_('Read cancelled'));
            const thumbnail = this._imageContent(pixbuf);
            return {kind: 'image', mime, bytes, size: bytes.get_size(),
                id: `${mime}:${GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, bytes)}`,
                thumbnailWidth: Math.max(1, Math.round(pixbuf.width / 2)),
                thumbnailHeight: Math.max(1, Math.round(pixbuf.height / 2)), thumbnail};
        } finally { input.close(null); }
    }

    async _readClipboard() {
        if (this._clipboardCleared) return;
        this._cancelClipboardRead();
        const request = this._clipboardReadId;
        const generation = this._generation;
        const cancel = new Gio.Cancellable();
        this._clipboardCancel = cancel;
        const current = () => this._alive && generation === this._generation && request === this._clipboardReadId;
        // One-shot watchdog: cancel a stuck transfer once, then stop. Returning
        // SOURCE_CONTINUE would re-arm the timer every 6s if the await never
        // settled (e.g. a transfer that ignores the cancellable). The callback
        // clears its own id so the finally block never double-removes a source.
        let timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 6000, () => {timeout = 0; cancel.cancel(); return GLib.SOURCE_REMOVE;});
        this._clipboardMessage = '';
        if (!this._settings.get_boolean('remember-clipboard')) this._clips = [];
        let output;
        try {
            const clipboard = St.Clipboard.get_default();
            const types = clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD) ?? [];
            const mime = IMAGE_TYPES.find(type => types.includes(type));
            const fileType = FILE_TYPES.find(type => types.includes(type));
            let clip;
            let clips = [];
            let fileWarning = '';
            if (mime) {
                this._clipboardMessage = _('Loading thumbnail…');
                this._queueSearch();
                // Bound the transfer itself, not just the decoded thumbnail.
                output = Gio.MemoryOutputStream.new_resizable();
                await new Promise((resolve, reject) => global.display.get_selection().transfer_async(
                    Meta.SelectionType.SELECTION_CLIPBOARD, mime, MAX_IMAGE_BYTES + 1, output, cancel,
                    (selection, result) => {try {selection.transfer_finish(result); resolve();} catch (e) {reject(e);}}));
                output.close(null);
                if (!current() || cancel.is_cancelled()) return;
                const bytes = output.steal_as_bytes();
                clip = await this._imageClip(bytes, mime, cancel);
            } else if (fileType) {
                this._clipboardMessage = _('Loading file thumbnails…');
                this._queueSearch();
                const payload = await selectionBytes(fileType, 256 * 1024, cancel);
                if (!current() || cancel.is_cancelled()) return;
                let text = new TextDecoder().decode(payload.toArray());
                // Restoring history must never repeat an old cut/move operation.
                if (fileType === 'x-special/gnome-copied-files') text = text.replace(/^cut\r?\n/, 'copy\n');
                const restoreBytes = new GLib.Bytes(new TextEncoder().encode(text));
                const files = localImageFiles(text, fileType);
                let batchSize = 0;
                for (const file of files) {
                    try {
                        const data = await localImageBytes(file, MAX_IMAGE_BYTES, cancel);
                        if (!current() || cancel.is_cancelled()) return;
                        if (batchSize + data.bytes.get_size() + restoreBytes.get_size() > MAX_CLIPBOARD_BYTES) {
                            fileWarning = _('Some thumbnails skipped: 32 MiB limit');
                            break;
                        }
                        const entry = await this._imageClip(data.bytes, data.mime, cancel);
                        if (!current() || cancel.is_cancelled()) return;
                        entry.id = `file:${file.get_uri()}`;
                        entry.filename = data.name;
                        entry.clipboardMime = fileType;
                        entry.clipboardBytes = restoreBytes;
                        entry.size += restoreBytes.get_size();
                        batchSize += entry.size;
                        clips.push(entry);
                    } catch (error) {
                        if (!current() || cancel.is_cancelled()) return;
                        fileWarning = format(_('Some files are unavailable: %s'), error.message);
                    }
                }
                if (!files.length) fileWarning = _('No supported local images in the list');
            } else {
                const textType = ['text/plain;charset=utf-8', 'UTF8_STRING', 'text/plain'].find(type => types.includes(type));
                if (!textType) return;
                output = Gio.MemoryOutputStream.new_resizable();
                await new Promise((resolve, reject) => global.display.get_selection().transfer_async(
                    Meta.SelectionType.SELECTION_CLIPBOARD, textType, 32768 * 4 + 1, output, cancel,
                    (selection, result) => {try {selection.transfer_finish(result); resolve();} catch (e) {reject(e);}}));
                output.close(null);
                if (!current() || cancel.is_cancelled()) return;
                const text = new TextDecoder().decode(output.steal_as_bytes().toArray());
                if (typeof text === 'string' && text.length && text.length <= 32768)
                    clip = {kind: 'text', text, id: `text:${text}`, size: text.length * 4};
            }
            if (!current() || cancel.is_cancelled()) return;
            if (clip) clips = [clip];
            if (clips.length) {
                const ids = new Set(clips.map(item => item.id));
                const candidates = [...clips, ...this._clips.filter(item => !ids.has(item.id))].slice(0, 20);
                let size = 0;
                this._clips = [];
                for (const item of candidates) {
                    if (size + item.size > MAX_CLIPBOARD_BYTES) break;
                    this._clips.push(item);
                    size += item.size;
                }
            }
            this._clipboardMessage = fileWarning;
        } catch (error) {
            if (current()) this._clipboardMessage = cancel.is_cancelled() ? _('Could not read the clipboard in time') : format(_('Preview unavailable: %s'), error.message);
        } finally {
            if (timeout) GLib.source_remove(timeout);
            if (output && !output.is_closed()) output.close(null);
            if (current()) {
                this._clipboardCancel = null;
                if (cancel.is_cancelled()) this._clipboardMessage = _('Could not read the clipboard in time');
                if (this._overlay.visible && this._mode === 'clipboard') this._queueSearch();
            }
        }
    }

    _startIndex() {
        this._indexing = true;
        const cancel = this._cancellable;
        const roots = new Set();
        for (const type of [GLib.UserDirectory.DIRECTORY_DOCUMENTS, GLib.UserDirectory.DIRECTORY_DOWNLOAD,
            GLib.UserDirectory.DIRECTORY_DESKTOP, GLib.UserDirectory.DIRECTORY_PICTURES,
            GLib.UserDirectory.DIRECTORY_MUSIC, GLib.UserDirectory.DIRECTORY_VIDEOS]) {
            const path = GLib.get_user_special_dir(type);
            if (path) roots.add(path);
        }
        roots.add(GLib.get_home_dir());
        const queue = [...roots].map(path => ({file: Gio.File.new_for_path(path), depth: 0}));
        const seen = new Set();
        const run = async () => {
            while (queue.length && !cancel.is_cancelled() && this._files.length < 20000) {
                const {file, depth} = queue.shift();
                if (seen.has(file.get_uri())) continue;
                seen.add(file.get_uri());
                let enumerator;
                try {
                    enumerator = await new Promise((resolve, reject) => file.enumerate_children_async(
                        'standard::name,standard::display-name,standard::type,standard::icon,time::modified',
                        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_LOW, cancel,
                        (source, result) => {try {resolve(source.enumerate_children_finish(result));} catch (e) {reject(e);}}));
                    while (!cancel.is_cancelled() && this._files.length < 20000) {
                        const infos = await new Promise((resolve, reject) => enumerator.next_files_async(64,
                            GLib.PRIORITY_LOW, cancel, (source, result) => {try {resolve(source.next_files_finish(result));} catch (e) {reject(e);}}));
                        if (!infos.length || cancel.is_cancelled()) break;
                        for (const info of infos) {
                            const name = info.get_name();
                            if (name.startsWith('.')) continue;
                            const child = file.get_child(name);
                            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                                if (depth < 6 && !SKIP.has(name)) queue.push({file: child, depth: depth + 1});
                            } else if (info.get_file_type() === Gio.FileType.REGULAR) {
                                this._files.push({name: info.get_display_name(), directory: file.get_path().replace(GLib.get_home_dir(), '~'),
                                    uri: child.get_uri(), modified: info.get_attribute_uint64('time::modified'), gicon: info.get_icon()});
                            }
                            if (this._files.length >= 20000) break;
                        }
                    }
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) && !e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.PERMISSION_DENIED))
                        console.debug(`[Glasslight] Index: ${e.message}`);
                } finally {
                    if (enumerator) enumerator.close_async(GLib.PRIORITY_LOW, null, (source, result) => {try {source.close_finish(result);} catch (_) { /* Removed directory. */ }});
                }
            }
            if (!cancel.is_cancelled()) {this._indexing = false; this._queueSearch();}
        };
        run().catch(error => console.error(`[Glasslight] Index: ${error}`));
    }
}
