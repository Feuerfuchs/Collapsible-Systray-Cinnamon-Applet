const uuid              = imports.applet.uuid;

const Util              = imports.misc.util;
const Lang              = imports.lang;
const Clutter           = imports.gi.Clutter;
const St                = imports.gi.St;
const Mainloop          = imports.mainloop;
const SignalManager     = imports.misc.signalManager;

const Applet            = imports.ui.applet;
const PopupMenu         = imports.ui.popupMenu;

const AppletDir         = imports.ui.appletManager.applets[uuid];
const CinnamonSystray   = AppletDir.CinnamonSystray;

const ICON_SCALE_FACTOR = CinnamonSystray.ICON_SCALE_FACTOR;
const DEFAULT_ICON_SIZE = CinnamonSystray.DEFAULT_ICON_SIZE;

function CollapsibleSystrayApplet(orientation, panel_height, instance_id) {
    this._init(orientation, panel_height, instance_id);
}

CollapsibleSystrayApplet.prototype = {
    __proto__: CinnamonSystray.MyApplet.prototype,

    _init: function(orientation, panel_height, instance_id) {
        CinnamonSystray.MyApplet.prototype._init.call(this, orientation, panel_height, instance_id);

        this.actor.add_style_class_name("ff-collapsible-systray");

        this.manager_container.destroy();

        // Root container
        this.mainLayout = new St.BoxLayout({
            vertical: false
        });
        this.actor.add_actor(this.mainLayout);

        // Status icon container
        this.manager_container = new St.BoxLayout({
            vertical: false
        });
        this.mainLayout.add(this.manager_container);

        // Indicator container
        this.indicatorContainer = new St.BoxLayout({
            vertical: false
        });
        this.mainLayout.add(this.indicatorContainer);

        // Expand/collapse button
        this.collapseBtn = new St.


        this.registeredItems = {};
    },

    _registerItem(name, actor) {
        this.registeredItems[name] = actor;
    },

    _unregisterItem(name) {
        delete this.registeredItems[name];
    },

    //
    // Overrides
    // ---------------------------------------------------------------------------------

    _onTrayIconRemoved: function(o, icon) {
        this._unregisterItem(icon.role);

        icon.wrapper.destroy();

        CinnamonSystray.MyApplet.prototype._onTrayIconRemoved.call(this, o, icon);
    },

    _insertStatusItem: function(role, icon, position) {
        if (icon.obsolete == true) {
            return;
        }

        let iconWrap        = new St.BoxLayout({ style_class: 'applet-box', reactive: true, track_hover: true });
        let iconWrapContent = new St.Bin();
        iconWrap.add_style_class_name('ff-collapsible-systray__status-icon');
        iconWrap.add(iconWrapContent, { a_align: St.Align.MIDDLE, y_fill: false });
        iconWrapContent.set_child(icon);
        icon.wrapper = iconWrap;
        icon.role    = role;

        let children = this.manager_container.get_children();
        let i;

        for (i = children.length - 1; i >= 0; i--) {
            let rolePosition = children[i]._rolePosition;
            if (position > rolePosition) {
                this.manager_container.insert_child_at_index(iconWrap, i + 1);
                break;
            }
        }
        if (i == -1) {
            this.manager_container.insert_child_at_index(iconWrap, 0);
        }

        iconWrap._rolePosition = position;

        if (this._scaleMode) {
            let timerId = Mainloop.timeout_add(500, Lang.bind(this, function() {
                this._resizeStatusItem(role, icon);
                Mainloop.source_remove(timerId);
            }));
        } else {
            icon.set_pivot_point(0.5, 0.5);
            icon.set_scale((DEFAULT_ICON_SIZE * global.ui_scale) / icon.width,
                           (DEFAULT_ICON_SIZE * global.ui_scale) / icon.height);
        }

        this._registerItem(role, iconWrap);
    },

    _onIndicatorAdded: function(manager, appIndicator) {
        CinnamonSystray.MyApplet.prototype._onIndicatorAdded.call(this, manager, appIndicator);

        let iconActor = this._shellIndicators[appIndicator.id];
        if (iconActor !== undefined) {
            this.actor.remove_actor(iconActor.actor);
            this.indicatorContainer.add(iconActor.actor);

            this._registerItem(appIndicator.id, iconActor);
        }
    },

    _onIndicatorRemoved: function(manager, appIndicator) {
        CinnamonSystray.MyApplet.prototype._onIndicatorRemoved.call(this, manager, appIndicator);

        this._unregisterItem(appIndicator.id);
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new CollapsibleSystrayApplet(orientation, panel_height, instance_id);
}
