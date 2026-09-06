import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

// Applied outside the native blur, to the sampled background only. Text and
// controls are separate siblings and never pass through either effect.
const RoundedMask = GObject.registerClass(class TahoeRoundedMask extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT,
            'uniform vec2 size; uniform float corner;',
            `vec2 p = cogl_tex_coord_in[0].xy * size - size * 0.5;
             vec2 q = abs(p) - (size * 0.5 - vec2(corner));
             float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - corner;
             cogl_color_out *= 1.0 - smoothstep(-0.8, 0.8, d);`, false);
    }

    resize(width, height, radius) {
        this.set_uniform_float(this.get_uniform_location('size'), 2, [Math.max(width, 1), Math.max(height, 1)]);
        this.set_uniform_float(this.get_uniform_location('corner'), 1, [radius]);
    }
});

export const GlassSurface = GObject.registerClass(class TahoeGlassSurface extends St.Widget {
    _init(content, radius = 28) {
        // Do not clip the whole surface: doing so cuts the rounded box-shadow
        // against the actor's rectangular allocation and leaves visible square
        // tiles around every glass chip. Only the content viewport is clipped.
        super._init({layout_manager: new Clutter.BinLayout(), style_class: 'tahoe-glass'});
        this._content = content;
        content.x_expand = true;
        content.y_expand = true;
        content.x_align = Clutter.ActorAlign.FILL;
        content.y_align = Clutter.ActorAlign.FILL;
        this._radius = radius;
        // BlurEffect expands its offscreen paint volume beyond the actor.  A
        // clip on that same actor is applied too early in the paint chain and
        // can therefore leave a blurred halo outside the Spotlight window.
        // Keep a separate, effect-free parent as the final hard boundary.
        this._blurClip = new St.Widget({layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true, x_expand: true, y_expand: true});
        this._maskBox = new St.Widget({layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true, x_expand: true, y_expand: true});
        this._sample = new St.Widget({layout_manager: new Clutter.FixedLayout(), clip_to_allocation: true,
            x_expand: true, y_expand: true});
        this._sample.set_no_layout(true);
        this._sample.connect('notify::allocation', () => this.sync());
        // Meta.WindowGroup has a 0x0 allocation in Shell 50: cloning the group
        // itself produces invalid allocations. Mirror its sized leaf actors.
        this._sourceSignals = [];
        this._sceneSignals = [];
        this._clones = [];
        const track = (object, signal, callback) => this._sceneSignals.push([object, object.connect(signal, callback)]);
        track(global.window_group, 'child-added', () => this._rebuildSample());
        track(global.window_group, 'child-removed', () => this._rebuildSample());
        this._rebuildSample();
        this._blurRadius = 48;
        this._blur = this._createBlurEffect();
        this._blurRefreshes = 0;
        this._sample.add_effect_with_name('tahoe-native-blur', this._blur);
        this._maskBox.add_child(this._sample);
        this._mask = new RoundedMask();
        this._maskBox.add_effect_with_name('tahoe-rounded-mask', this._mask);
        this._blurClip.add_child(this._maskBox);
        this.add_child(this._blurClip);
        this._tint = new St.Widget({style_class: 'tahoe-glass-tint', x_expand: true, y_expand: true});
        this.add_child(this._tint);
        // A separate optical layer lets interaction energize the material
        // without tinting or blurring the text and icons above it.
        this._highlight = new St.Widget({style_class: 'tahoe-glass-highlight',
            x_expand: true, y_expand: true, opacity: 64});
        this.add_child(this._highlight);
        this._contentBox = new St.Widget({layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true, x_expand: true, y_expand: true});
        this._contentBox.add_child(content);
        this.add_child(this._contentBox);
        this.set_pivot_point(0.5, 0.5);
        this.connect('notify::allocation', () => this.sync());
        this.connect('notify::mapped', () => this.sync());
        this.connect('destroy', () => {
            for (const [object, id] of [...this._sourceSignals, ...this._sceneSignals]) object.disconnect(id);
            this._sourceSignals = [];
            this._sceneSignals = [];
        });
        this.configure(radius, 48);
    }

    vfunc_get_preferred_width(forHeight) {
        const node = this.get_theme_node();
        const [min, natural] = this._content.get_preferred_width(node.adjust_for_height(forHeight));
        return node.adjust_preferred_width(min, natural);
    }

    vfunc_get_preferred_height(forWidth) {
        const node = this.get_theme_node();
        const [min, natural] = this._content.get_preferred_height(node.adjust_for_width(forWidth));
        return node.adjust_preferred_height(min, natural);
    }

    naturalHeight(forWidth) {
        // Once an explicit animated height is assigned, Actor's public
        // get_preferred_height() reports that fixed value. Querying the content
        // directly keeps the next expanded/collapsed target measurable.
        const node = this.get_theme_node();
        const [, natural] = this._content.get_preferred_height(node.adjust_for_width(forWidth));
        return node.adjust_preferred_height(natural, natural)[1];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
        const childBox = new Clutter.ActorBox();
        childBox.set_origin(0, 0);
        childBox.set_size(box.get_width(), box.get_height());
        this._blurClip.allocate(childBox);
        this._tint.allocate(childBox);
        this._highlight.allocate(childBox);
        this._contentBox.allocate(childBox);
        this.sync();
    }

    _rebuildSample() {
        for (const [object, id] of this._sourceSignals) object.disconnect(id);
        this._sourceSignals = [];
        this._sample.destroy_all_children();
        this._clones = [];
        const sources = [];
        const watch = (object, signal, callback) => this._sourceSignals.push([object, object.connect(signal, callback)]);
        for (const actor of global.window_group.get_children()) {
            if (actor instanceof Meta.BackgroundGroup) {
                sources.push(...actor.get_children());
                watch(actor, 'child-added', () => this._rebuildSample());
                watch(actor, 'child-removed', () => this._rebuildSample());
            } else sources.push(actor);
        }
        for (const source of sources) {
            const clone = new Clutter.Clone({source, reactive: false});
            this._sample.add_child(clone);
            this._clones.push({source, clone});
            watch(source, 'notify::allocation', () => this.sync());
            watch(source, 'notify::visible', () => this.sync());
        }
        if (this._mask) this.sync();
    }

    configure(radius, blurRadius) {
        this._radius = radius;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this._blurRadius = blurRadius * scale;
        this._blur.radius = this._blurRadius;
        this._tint.set_style(`border-radius: ${radius}px;`);
        this._highlight.set_style(`border-radius: ${radius}px;`);
        this.sync();
    }

    refreshBlur() {
        if (!this._blur || !this.mapped)
            return;
        // Shell.BlurEffect owns cached actor and blurred FBOs. Some Mutter/GPU
        // combinations retain the old full-width paint volume even after a
        // radius change. Replacing the effect releases both FBOs and guarantees
        // that the next paint allocates them from the current compact bounds.
        this._sample.remove_effect(this._blur);
        this._blur = this._createBlurEffect();
        this._sample.add_effect_with_name('tahoe-native-blur', this._blur);
        this._blurRefreshes++;
        this._sample.queue_redraw();
    }

    _createBlurEffect() {
        return new Shell.BlurEffect({
            mode: Shell.BlurMode.ACTOR,
            radius: this._blurRadius,
            brightness: 1,
        });
    }

    materialize(duration = 180, delay = 0) {
        this._sample.remove_all_transitions();
        this._tint.remove_all_transitions();
        this._highlight.remove_all_transitions();
        if (!duration) {
            this._sample.opacity = 255;
            this._tint.opacity = 255;
            this._highlight.opacity = 64;
            return;
        }
        this._sample.opacity = 32;
        this._tint.opacity = 72;
        this._highlight.opacity = 210;
        this._sample.ease({opacity: 255, duration, delay,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._tint.ease({opacity: 255, duration: Math.round(duration * 0.82), delay,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._highlight.ease({opacity: 64, duration: Math.round(duration * 1.15), delay,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    dematerialize(duration = 130) {
        for (const actor of [this._sample, this._tint, this._highlight])
            actor.remove_all_transitions();
        if (!duration) {
            this._sample.opacity = 0;
            this._tint.opacity = 0;
            this._highlight.opacity = 0;
            return;
        }
        this._sample.ease({opacity: 0, duration,
            mode: Clutter.AnimationMode.EASE_IN_QUAD});
        this._tint.ease({opacity: 0, duration: Math.round(duration * 0.85),
            mode: Clutter.AnimationMode.EASE_IN_QUAD});
        this._highlight.ease({opacity: 0, duration: Math.round(duration * 0.7),
            mode: Clutter.AnimationMode.EASE_IN_QUAD});
    }

    pulse(duration = 220) {
        this._highlight.remove_all_transitions();
        if (!duration) {
            this._highlight.opacity = 64;
            return;
        }
        this._highlight.opacity = 178;
        this._highlight.ease({opacity: 64, duration,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    settle() {
        for (const actor of [this._sample, this._tint, this._highlight])
            actor.remove_all_transitions();
        this._sample.opacity = 255;
        this._tint.opacity = 255;
        this._highlight.opacity = 64;
        this.scale_x = 1;
        this.scale_y = 1;
    }

    sync() {
        if (!this.mapped)
            return;
        const [x, y] = this.get_transformed_position();
        for (const {source, clone} of this._clones) {
            const [sourceX, sourceY] = source.get_transformed_position();
            if (![sourceX, sourceY, x, y].every(Number.isFinite)) { clone.hide(); continue; }
            clone.set_position(sourceX - x, sourceY - y);
            clone.visible = source.visible && source.width > 0 && source.height > 0;
            if (clone.visible) {
                const box = new Clutter.ActorBox();
                box.set_origin(sourceX - x, sourceY - y);
                box.set_size(source.width, source.height);
                clone.allocate(box);
            }
        }
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        // Explicit clips complement clip_to_allocation and keep the final
        // effect paint volume bounded during animated width/height changes.
        this._blurClip.set_clip(0, 0, this.width, this.height);
        this._maskBox.set_clip(0, 0, this.width, this.height);
        this._sample.set_clip(0, 0, this.width, this.height);
        this._mask.resize(this.width, this.height, Math.min(this._radius * scale, this.height / 2));
    }
});
