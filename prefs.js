import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {SEARCH_ENGINES, isSearchTemplate} from './src/search/searchEngines.js';

export default class GlasslightPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.glasslight');
        const page = new Adw.PreferencesPage({title: 'Glasslight', icon_name: 'system-search-symbolic'});
        const appearance = new Adw.PreferencesGroup({title: _('Appearance')});
        const themes = ['system', 'light', 'dark'];
        const theme = new Adw.ComboRow({title: _('Theme'), subtitle: _('The system theme follows GNOME'),
            model: Gtk.StringList.new([_('Match the system'), _('Light'), _('Dark')]), selected: themes.indexOf(settings.get_string('appearance'))});
        theme.connect('notify::selected', () => settings.set_string('appearance', themes[theme.selected]));
        appearance.add(theme);
        const blur = new Adw.SpinRow({title: _('Background blur'), subtitle: _('Native GNOME Shell blur'),
            adjustment: new Gtk.Adjustment({lower: 16, upper: 96, step_increment: 4, page_increment: 8})});
        settings.bind('blur-radius', blur, 'value', Gio.SettingsBindFlags.DEFAULT);
        appearance.add(blur);
        page.add(appearance);
        const behaviour = new Adw.PreferencesGroup({title: _('Behaviour')});
        const clipboard = new Adw.SwitchRow({title: _('Clipboard history'), subtitle: _('Text and images: up to 20 entries / 32 MiB, memory only')});
        settings.bind('remember-clipboard', clipboard, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviour.add(clipboard);
        const appGrid = new Adw.SwitchRow({title: _('Replace the GNOME app grid'),
            subtitle: _('Super+A, the Show Apps button and a second Super press open Glasslight')});
        settings.bind('replace-app-grid', appGrid, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviour.add(appGrid);
        const shortcut = new Adw.EntryRow({title: _('Hotkey (for example, <Alt>space)'), use_markup: false, text: settings.get_strv('toggle-glasslight')[0] ?? ''});
        shortcut.show_apply_button = true;
        shortcut.connect('apply', () => {
            // accelerator_parse() reports success even for an empty string
            // (returning key 0), which would store an untriggerable binding
            // and silently drop the launcher hotkey. Require a real key.
            const [valid, key] = Gtk.accelerator_parse(shortcut.text);
            if (valid && key !== 0) settings.set_strv('toggle-glasslight', [shortcut.text]);
            else shortcut.text = settings.get_strv('toggle-glasslight')[0] ?? '';
        });
        behaviour.add(shortcut);
        page.add(behaviour);
        const web = new Adw.PreferencesGroup({title: _('Web search'),
            description: _('The query opens in the default browser only when you pick the web result')});
        const engineIds = [...SEARCH_ENGINES.map(engine => engine.id), 'custom'];
        const engine = new Adw.ComboRow({title: _('Search engine'),
            model: Gtk.StringList.new([...SEARCH_ENGINES.map(item => item.name), _('Custom')]),
            selected: Math.max(0, engineIds.indexOf(settings.get_string('search-engine')))});
        const customUrl = new Adw.EntryRow({title: _('Search URL (%s is replaced by the query)'), use_markup: false,
            text: settings.get_string('custom-search-url'), show_apply_button: true});
        const syncCustomUrl = () => { customUrl.visible = engineIds[engine.selected] === 'custom'; };
        engine.connect('notify::selected', () => {
            settings.set_string('search-engine', engineIds[engine.selected]);
            syncCustomUrl();
        });
        customUrl.connect('apply', () => {
            // Keep the last valid template; the shell falls back to DuckDuckGo
            // while no valid custom template is stored.
            const template = customUrl.text.trim();
            if (isSearchTemplate(template)) settings.set_string('custom-search-url', template);
            else customUrl.text = settings.get_string('custom-search-url');
        });
        syncCustomUrl();
        web.add(engine);
        web.add(customUrl);
        page.add(web);
        window.add(page);
    }
}
