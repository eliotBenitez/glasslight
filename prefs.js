import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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
        window.add(page);
    }
}
