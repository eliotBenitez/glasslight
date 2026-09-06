import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

export function label(text, style) {
    const widget = new St.Label({text: text ?? '', style_class: style, x_expand: true,
        x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.CENTER});
    widget.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return widget;
}

export function icon(gicon, fallback = 'application-x-executable-symbolic') {
    return new St.Icon({gicon: gicon ?? new Gio.ThemedIcon({name: fallback}), icon_size: 28,
        y_align: Clutter.ActorAlign.CENTER, style_class: 'tahoe-result-icon'});
}
