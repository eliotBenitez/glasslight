export function buildSettingsActions(apps, {detail, keywords, launch}) {
    return apps.filter(app => /^gnome-.+-panel\.desktop$/.test(app.get_id() ?? '') &&
        (app.get_categories?.() ?? '').split(';').includes('X-GNOME-Settings-Panel') &&
        !app.get_is_hidden?.()).map(app => ({
        id: `settings:${app.get_id()}`,
        title: app.get_display_name(),
        detail,
        keywords: [keywords, app.get_name(), app.get_description() ?? '',
            ...(app.get_keywords?.() ?? []), app.get_id()].join(' '),
        gicon: app.get_icon(),
        fallback: 'preferences-system-symbolic',
        params: [],
        closeBeforeRun: true,
        run: () => { launch(app); },
    }));
}
