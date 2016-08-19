const uuid                      = imports.applet.uuid;

const Util                      = imports.misc.util;
const Lang                      = imports.lang;
const Clutter                   = imports.gi.Clutter;
const St                        = imports.gi.St;
const Main                      = imports.ui.main;
const Mainloop                  = imports.mainloop;
const SignalManager             = imports.misc.signalManager;
const Settings                  = imports.ui.settings;
const Tweener                   = imports.ui.tweener;

const Applet                    = imports.ui.applet;
const PopupMenu                 = imports.ui.popupMenu;

const AppletDir                 = imports.ui.appletManager.applets[uuid];
const CinnamonSystray           = AppletDir.CinnamonSystray;
const CSCollapseBtn             = AppletDir.CSCollapseBtn;
const CSRemovableSwitchMenuItem = AppletDir.CSRemovableSwitchMenuItem;

const _                         = imports.applet._;

const ICON_SCALE_FACTOR         = CinnamonSystray.ICON_SCALE_FACTOR;
const DEFAULT_ICON_SIZE         = CinnamonSystray.DEFAULT_ICON_SIZE;

// ------------------------------------------------------------------------------------------------------

function CollapsibleSystrayApplet(orientation, panel_height, instance_id) {
    this._init(orientation, panel_height, instance_id);
}

CollapsibleSystrayApplet.prototype = {
    __proto__: CinnamonSystray.MyApplet.prototype,

    Menu: {
        ACTIVE_APPLICATIONS:   true,
        INACTIVE_APPLICATIONS: false
    },

    _init: function(orientation, panel_height, instance_id) {
        //
        // Expand/collapse button

        this.collapseBtn = new CSCollapseBtn.CSCollapseBtn(this);
        this.collapseBtn.actor.connect('clicked', Lang.bind(this, function(o, event) {
            if (this.animating) {
                return;
            }

            if (this.hoverTimerID) {
                Mainloop.source_remove(this.hoverTimerID);
                this.hoverTimerID = null;
            }
            if (this.initialCollapseTimerID) {
                Mainloop.source_remove(this.initialCollapseTimerID);
                this.initialCollapseTimerID = null;
            }

            if (this.iconsAreHidden) {
                this._showAppIcons(true);
            } else {
                this._hideAppIcons(true);
            }
        }));

        //
        // Initialize Cinnamon applet

        CinnamonSystray.MyApplet.prototype._init.call(this, orientation, panel_height, instance_id);

        this.actor.add_style_class_name("ff-collapsible-systray");

        this.actor.remove_actor(this.manager_container);

        //
        // Variables

        this.signalManager      = new SignalManager.SignalManager(this);
        this.hovering           = false;
        this.hoverTimerID       = null;
        this.registeredAppIcons = {};
        this.activeMenuItems    = {};
        this.inactiveMenuItems  = {};
        this.animating          = false;
        this.iconsAreHidden     = false;

        //
        // Applet layout

        // Root container
        this.mainLayout = new St.BoxLayout({ vertical: false });

        // Containers for shown/hidden icons
        this.hiddenIconsContainer = new St.BoxLayout({ vertical: false });
        this.hiddenIconsContainer.set_clip_to_allocation(true);
        this.shownIconsContainer = new St.BoxLayout({ vertical: false });

        this.mainLayout.add_actor(this.collapseBtn.actor);
        this.mainLayout.add_actor(this.hiddenIconsContainer);
        this.mainLayout.add_actor(this.shownIconsContainer);
        this.actor.add_actor(this.mainLayout);

        //
        // Context menu items

        this.cmitemActiveItems   = new PopupMenu.PopupSubMenuMenuItem(_("Active applications"));
        this.cmitemInactiveItems = new PopupMenu.PopupSubMenuMenuItem(_("Inactive applications"));

        this._populateMenus();

        //
        // Settings

        this.settings = new Settings.AppletSettings(this, uuid, instance_id);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "icon-visibility-list",    "savedIconVisibilityList", this._loadAppIconVisibilityList, null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "init-delay",              "initDelay",               this._onSettingsUpdated,         "initDelay");
        this.settings.bindProperty(Settings.BindingDirection.IN,            "animation-duration",      "animationDuration",       this._onSettingsUpdated,         "animationDuration");
        this.settings.bindProperty(Settings.BindingDirection.IN,            "expand-icon-name",        "expandIconName",          this._onSettingsUpdated,         "expandIconName");
        this.settings.bindProperty(Settings.BindingDirection.IN,            "collapse-icon-name",      "collapseIconName",        this._onSettingsUpdated,         "collapseIconName");
        this.settings.bindProperty(Settings.BindingDirection.IN,            "tray-icon-hpadding",      "trayIconHPadding",        this._updateTrayIconPadding,     null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "expand-on-hover",         "expandOnHover",           this._onSettingsUpdated,         "expandOnHover");
        this.settings.bindProperty(Settings.BindingDirection.IN,            "expand-on-hover-delay",   "expandOnHoverDelay",      this._onSettingsUpdated,         "expandOnHoverDelay");
        this.settings.bindProperty(Settings.BindingDirection.IN,            "collapse-on-leave",       "collapseOnLeave",         this._onSettingsUpdated,         "collapseOnLeave");
        this.settings.bindProperty(Settings.BindingDirection.IN,            "collapse-on-leave-delay", "collapseOnLeaveDelay",    this._onSettingsUpdated,         "collapseOnLeaveDelay");
        this.settings.bindProperty(Settings.BindingDirection.IN,            "no-hover-for-tray-icons", "noHoverForTrayIcons",     this._onSettingsUpdated,         "noHoverForTrayIcons");
        this._loadAppIconVisibilityList();
        this._onSettingsUpdated();
        this.collapseBtn.setIsExpanded(!this.iconsAreHidden);

        //
        // Hover events

        this.signalManager.connect(this.actor, 'enter-event', Lang.bind(this, this._onEnter));
        this.signalManager.connect(this.actor, 'leave-event', Lang.bind(this, this._onLeave));

        //
        // Automatically collapse after X seconds

        this.initialCollapseTimerID = Mainloop.timeout_add(this.initDelay * 1000, Lang.bind(this, function() {
            this.initialCollapseTimerID = null;

            if (this._draggable.inhibit) {
                this._hideAppIcons(true);
            }
        }));
    },

    /*
     * Add all necessary menu items to the context menu
     */
    _populateMenus: function() {
        let i = -1;
        this._applet_context_menu.addMenuItem(this.cmitemActiveItems, ++i);
        this._applet_context_menu.addMenuItem(this.cmitemInactiveItems, ++i);
        this._applet_context_menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(), ++i);
    },

    /*
     * Add the specified icon to the item list and create a menu entry
     */
    _registerAppIcon: function(id, actor) {
        if (!this.registeredAppIcons.hasOwnProperty(id)) {
            this.registeredAppIcons[id] = [];
        }

        let instanceArray = this.registeredAppIcons[id];

        if (instanceArray.indexOf(actor) != -1) return;

        global.log("[" + uuid + "] Register instance of " + id);

        instanceArray.push(actor);

        if (!this.iconVisibilityList.hasOwnProperty(id)) {
            this.iconVisibilityList[id] = true;
        }

        if (this.iconVisibilityList[id]) {
            this.shownIconsContainer.add_actor(actor);
        } else {
            this.hiddenIconsContainer.add_actor(actor);
        }

        let [minWidth, natWidth] = actor.get_preferred_width(-1);

        actor.iconID    = id;
        actor.origWidth = natWidth;

        if (this.iconsAreHidden && !this.iconVisibilityList[id]) {
            actor.csDisable();
        }

        this._addApplicationMenuItem(id, this.Menu.ACTIVE_APPLICATIONS);
    },

    /*
     * Remove the icon from the list and move the menu entry to the list of inactive applications
     */
    _unregisterAppIcon: function(id, actor) {
        global.log("[" + uuid + "] Unregister instance of " + id);

        let instanceArray = this.registeredAppIcons[id];
        let iconIndex     = instanceArray.indexOf(actor);
        if (iconIndex != -1) {
            instanceArray.splice(iconIndex, 1);
        }

        actor.destroy();

        if (instanceArray.length == 0) {
            global.log("[" + uuid + "] No more instances left");

            delete instanceArray;
            delete this.registeredAppIcons[id];
            this._addApplicationMenuItem(id, this.Menu.INACTIVE_APPLICATIONS);
        }
    },

    /*
     * Create a menu entry for the specified icon in the "active applications" section
     */
    _addApplicationMenuItem: function(id, menu) {
        let curMenuItems   = menu == this.Menu.ACTIVE_APPLICATIONS ? this.activeMenuItems        : this.inactiveMenuItems;
        let curMenu        = menu == this.Menu.ACTIVE_APPLICATIONS ? this.cmitemActiveItems.menu : this.cmitemInactiveItems.menu;
        let otherMenuItems = menu == this.Menu.ACTIVE_APPLICATIONS ? this.inactiveMenuItems      : this.activeMenuItems;
        let menuItem       = null;

        // If there's a menu item in the other menu, delete it
        if (otherMenuItems.hasOwnProperty(id)) {
            otherMenuItems[id].actor.destroy();
            delete otherMenuItems[id];
        }

        // If there's already a menu item in the current menu, do nothing
        if (curMenuItems.hasOwnProperty(id)) {
            return;
        }

        global.log("[" + uuid + "] Insert menu item for " + id + " in " + (menu == this.Menu.ACTIVE_APPLICATIONS ? "active" : "inactive") + " applications");

        switch (menu) {
            case this.Menu.ACTIVE_APPLICATIONS:
                menuItem = new PopupMenu.PopupSwitchMenuItem(id, this.iconVisibilityList[id]);
                menuItem.appID = id;
                menuItem.connect('toggled', Lang.bind(this, function(o, state) {
                    this._updateAppIconVisibility(id, state);
                }));
                break;

            default:
            case this.Menu.INACTIVE_APPLICATIONS:
                menuItem = new CSRemovableSwitchMenuItem.CSRemovableSwitchMenuItem(id, this.iconVisibilityList[id]);
                menuItem.appID = id;
                menuItem.connect('toggled', Lang.bind(this, function(o, state) {
                    this._updateAppIconVisibility(id, state);
                }));
                menuItem.connect('remove', Lang.bind(this, function(o, state) {
                    delete this.iconVisibilityList[id];
                    this._saveAppIconVisibilityList();

                    menuItem.actor.destroy();
                    delete this.inactiveMenuItems[id];
                }));
                break;
        }

        // Find insertion index so all menu items are alphabetically sorted
        let index = 0;
        let items = curMenu._getMenuItems();
        for (let len = items.length; index < len; ++index) {
            if (items[index].appID.localeCompare(id) >= 1) {
                break;
            }
        }

        curMenu.addMenuItem(menuItem, index);
        curMenuItems[id] = menuItem;
    },

    /*
     * Hide all icons that are marked as hidden
     */
    _hideAppIcons: function(animate) {
        if (animate && this.animating) {
            return;
        }

        if (this.hiddenIconsContainer.hasOwnProperty('tweenParams')) {
            Tweener.removeTweens(this.hiddenIconsContainer);
            this.hiddenIconsContainer.tweenParams.onComplete();
        }

        this.iconsAreHidden = true;

        let onFinished = Lang.bind(this, function() {
            delete this.hiddenIconsContainer.tweenParams;

            let icons  = this.hiddenIconsContainer.get_children();
            for (let i = icons.length - 1; i >= 0; --i) {
                icons[i].csDisable();
            }

            this.animating = false;
            this.collapseBtn.setIsExpanded(false);
        });

        if (animate) {
            this.animating = true;
            this.hiddenIconsContainer.tweenParams = {
                width:      0,
                time:       this.animationDuration / 1000,
                transition: 'easeInOutQuart',
                onComplete: onFinished
            }

            Tweener.addTween(this.hiddenIconsContainer, this.hiddenIconsContainer.tweenParams);
        } else {
            this.hiddenIconsContainer.set_width(0);
            onFinished();
        }
    },

    /*
     * Unhide all icons that are marked as hidden
     */
    _showAppIcons: function(animate) {
        if (animate && this.animating) {
            return;
        }

        if (this.hiddenIconsContainer.hasOwnProperty('tweenParams')) {
            Tweener.removeTweens(this.hiddenIconsContainer);
            this.hiddenIconsContainer.tweenParams.onComplete();
        }

        this.iconsAreHidden = false;

        let onFinished = Lang.bind(this, function() {
            delete this.hiddenIconsContainer.tweenParams;

            let icons  = this.hiddenIconsContainer.get_children();
            for (let i = icons.length - 1; i >= 0; --i) {
                icons[i].csEnableAfter();
            }

            this.hiddenIconsContainer.set_width(-1);

            this.animating = false;
            this.collapseBtn.setIsExpanded(true);
        });

        let icons  = this.hiddenIconsContainer.get_children();
        for (let i = icons.length - 1; i >= 0; --i) {
            icons[i].csEnable();
        }

        if (animate) {
            this.animating = true;

            let width = 0;
            let hiddenIcons = this.hiddenIconsContainer.get_children();
            for (let i = hiddenIcons.length - 1; i >= 0; --i) {
                width += hiddenIcons[i].origWidth;
            }

            this.hiddenIconsContainer.tweenParams = {
                width:      width,
                time:       this.animationDuration / 1000,
                transition: 'easeInOutQuart',
                onComplete: onFinished
            };

            Tweener.addTween(this.hiddenIconsContainer, this.hiddenIconsContainer.tweenParams);
        } else {
            this.hiddenIconsContainer.set_width(-1);
            onFinished();
        }
    },

    /*
     * Update the specified icon's visibility state and (un)hide it if necessary
     */
    _updateAppIconVisibility: function(id, state) {
        global.log("[" + uuid + "] State of " + id + " was set to " + (state ? "shown" : "hidden"));

        this.iconVisibilityList[id] = state;

        // Application is active, show/hide the icon if necessary
        if (this.registeredAppIcons.hasOwnProperty(id)) {
            let instances = this.registeredAppIcons[id];

            for (let i = instances.length - 1; i <= 0; --i) {
                let actor = instances[i];
                if (this.iconVisibilityList[id]) {
                    actor.reparent(this.shownIconsContainer);

                    if (this.iconsAreHidden) {
                        actor.csEnable();
                        actor.csEnableAfter();
                    }
                } else {
                    if (this.iconsAreHidden) {
                        actor.csDisable();
                    }

                    actor.reparent(this.hiddenIconsContainer);
                }
            }
        }

        this._saveAppIconVisibilityList();
    },

    /*
     * Update the tray icons' padding
     */
    _updateTrayIconPadding: function() {
        let shownIcons  = this.shownIconsContainer.get_children();
        for (let i = shownIcons.length - 1; i >= 0; --i) {
            let icon = shownIcons[i];

            if (!icon.isIndicator) {
                icon.set_style('padding-left: ' + this.trayIconHPadding + 'px; padding-right: ' + this.trayIconHPadding + 'px;');
            }
        }

        let hiddenIcons = this.hiddenIconsContainer.get_children();
        for (let i = hiddenIcons.length - 1; i >= 0; --i) {
            let icon = hiddenIcons[i];

            if (!icon.isIndicator) {
                icon.set_style('padding-left: ' + this.trayIconHPadding + 'px; padding-right: ' + this.trayIconHPadding + 'px;');
            }
        }
    },

    /*
     * Load the list of hidden icons from the settings
     */
    _loadAppIconVisibilityList: function() {
        try {
            this.iconVisibilityList = JSON.parse(this.savedIconVisibilityList);

            for (let id in this.iconVisibilityList) {
                if (this.iconVisibilityList.hasOwnProperty(id) && !this.registeredAppIcons.hasOwnProperty(id)) {
                    this._addApplicationMenuItem(id, this.Menu.INACTIVE_APPLICATIONS);
                }
            }
        } catch(e) {
            this.iconVisibilityList = {};
            global.log("[" + uuid + "] Chouldn't load icon visibility list: " + e);
        }
    },

    /*
     * Save the list of hidden icons
     */
    _saveAppIconVisibilityList: function() {
        this.savedIconVisibilityList = JSON.stringify(this.iconVisibilityList);
    },

    /*
     * An applet setting with visual impact has been changed; reload
     * collapse/expand button's icons and reload all tray icons
     */
    _onSettingsUpdated: function(setting) {
        switch(setting) {
            case 'expandIconName':
            case 'collapseIconName':
                this.collapseBtn.setIsExpanded(!this.iconsAreHidden);
                break;

            case 'trayIconHPadding':
                this._updateTrayIconPadding();
                break;
        }
    },

    //
    // Events
    // ---------------------------------------------------------------------------------

    _onEnter: function() {
        this.hovering = true;

        if (this.hoverTimerID) {
            Mainloop.source_remove(this.hoverTimerID);
            this.hoverTimerID = null;
        }

        if (!this.expandOnHover)      return;
        if (!this._draggable.inhibit) return;

        if (this.initialCollapseTimerID) {
            Mainloop.source_remove(this.initialCollapseTimerID);
            this.initialCollapseTimerID = null;
        }

        this.hoverTimerID = Mainloop.timeout_add(this.expandOnHoverDelay, Lang.bind(this, function() {
            this.hoverTimerID = null;

            if (this.iconsAreHidden) {
                this._showAppIcons(true);
            }
        }));
    },

    _onLeave: function() {
        this.hovering = false;

        if (this.hoverTimerID) {
            Mainloop.source_remove(this.hoverTimerID);
            this.hoverTimerID = null;
        }

        if (!this.collapseOnLeave)    return;
        if (!this._draggable.inhibit) return;

        if (this.initialCollapseTimerID) {
            Mainloop.source_remove(this.initialCollapseTimerID);
            this.initialCollapseTimerID = null;
        }

        this.hoverTimerID = Mainloop.timeout_add(this.collapseOnLeaveDelay, Lang.bind(this, function() {
            this.hoverTimerID = null;

            if (!this.iconsAreHidden) {
                this._hideAppIcons(true);
            }
        }));
    },

    //
    // Overrides
    // ---------------------------------------------------------------------------------

    _removeIndicatorSupport: function() {
        global.log("[" + uuid + "] Event: _removeIndicatorSupport");

        this._shellIndicators.forEach(function(iconActor) {
            this._unregisterAppIcon(iconActor._indicator.id, iconActor);
        });

        CinnamonSystray.MyApplet.prototype._removeIndicatorSupport.call(this);
    },

    /*
     * Disable the collapse/expand button if the panel is in edit mode so the user can
     * perform drag and drop on that button
     */
    _setAppletReactivity: function() {
        global.log("[" + uuid + "] Event: _setAppletReactivity");

        CinnamonSystray.MyApplet.prototype._setAppletReactivity.call(this);

        this.collapseBtn.actor.set_reactive(this._draggable.inhibit);

        if (this.hoverTimerID) {
            Mainloop.source_remove(this.hoverTimerID);
            this.hoverTimerID = null;
        }
    },

    /*
     * The Cinnamon applet invalidates all tray icons if this event occurs, so I have to
     * unregister all tray icons when this happens
     */
    _onBeforeRedisplay: function() {
        global.log("[" + uuid + "] Event: _onBeforeRedisplay");

        CinnamonSystray.MyApplet.prototype._onBeforeRedisplay.call(this);

        this._showAppIcons(false);

        let shownIcons  = this.shownIconsContainer.get_children();
        for (let i = shownIcons.length - 1; i >= 0; --i) {
            let icon = shownIcons[i];

            if (!icon.isIndicator) {
                this._unregisterAppIcon(icon.iconID, icon);
                icon.destroy();
            }
        }

        let hiddenIcons = this.hiddenIconsContainer.get_children();
        for (let i = hiddenIcons.length - 1; i >= 0; --i) {
            let icon = hiddenIcons[i];

            if (!icon.isIndicator) {
                this._unregisterAppIcon(icon.iconID, icon);
                icon.destroy();
            }
        }

        this.initialCollapseTimerID = Mainloop.timeout_add(this.initDelay * 1000, Lang.bind(this, function() {
            this.initialCollapseTimerID = null;

            if (this._draggable.inhibit) {
                this._hideAppIcons(true);
            }
        }));
    },

    /*
     * A tray icon has been removed; unregister it and destroay the wrapper
     */
    _onTrayIconRemoved: function(o, icon) {
        global.log("[" + uuid + "] Event: _onTrayIconRemoved - " + icon.wrapper.iconID);

        this._unregisterAppIcon(icon.wrapper.iconID, icon.wrapper);

        CinnamonSystray.MyApplet.prototype._onTrayIconRemoved.call(this, o, icon);
    },

    /*
     * Remove icon from tray, wrap it in an applet-box and re-add it. This way,
     * tray icons are displayed like applets and thus integrate nicely in the panel.
     */
    _insertStatusItem: function(role, icon, position) {
        if (icon.obsolete == true) {
            return;
        }

        global.log("[" + uuid + "] Event: _insertStatusItem - " + role);

        CinnamonSystray.MyApplet.prototype._insertStatusItem.call(this, role, icon, position);

        this.manager_container.remove_child(icon);

        let iconWrap        = new St.BoxLayout({ style_class: 'applet-box', reactive: true, track_hover: !this.noHoverForTrayIcons });
        let iconWrapContent = new St.Bin({ child: icon });
        iconWrap.add_style_class_name('ff-collapsible-systray__status-icon');
        iconWrap.set_style('padding-left: ' + this.trayIconHPadding + 'px; padding-right: ' + this.trayIconHPadding + 'px;');
        iconWrap.add_actor(iconWrapContent, { a_align: St.Align.MIDDLE, y_fill: false });
        iconWrap.isIndicator = false;
        iconWrap.icon = icon;

        if (["livestreamer-twitch-gui", "chromium", "swt"].indexOf(role) != -1) {
            iconWrap.csDisable = function() {
                iconWrapContent.set_child(null);
            }
            iconWrap.csEnable = function() {
                iconWrapContent.set_child(icon);
            }
            iconWrap.csEnableAfter = function() { }
        } else if (["pidgin"].indexOf(role) != -1) {
            iconWrap.csDisable = function() {
                icon.window.hide();
            }
            iconWrap.csEnable = function() { }
            iconWrap.csEnableAfter = function() {
                icon.window.show();
            }
        } else {
            iconWrap.csDisable = function() {
                icon.window.hide();
            }
            iconWrap.csEnable = function() {
                icon.window.show();
            }
            iconWrap.csEnableAfter = function() { }
        }

        icon.wrapper = iconWrap;

        this._registerAppIcon(role, iconWrap);
    },

    /*
     * An AppIndicator has been added; prepare its actor and register the icon
     */
    _onIndicatorAdded: function(manager, appIndicator) {
        global.log("[" + uuid + "] Event: _onIndicatorAdded - " + appIndicator.id);

        CinnamonSystray.MyApplet.prototype._onIndicatorAdded.call(this, manager, appIndicator);

        if (appIndicator.id in this._shellIndicators) {
            let iconActor = this._shellIndicators[appIndicator.id];

            this.actor.remove_actor(iconActor.actor);

            iconActor.actor.isIndicator = true;
            iconActor.actor.csDisable = function() {
                iconActor.actor.set_reactive(false);
            }
            iconActor.actor.csEnable = function() {
                iconActor.actor.set_reactive(true);
            }

            this._registerAppIcon(appIndicator.id, iconActor.actor);
        }
    },

    /*
     * An AppIndicator has been removed; unregister it
     */
    _onIndicatorRemoved: function(manager, appIndicator) {
        global.log("[" + uuid + "] Event: _onIndicatorRemoved - " + appIndicator.id);

        this._unregisterAppIcon(appIndicator.id, this._shellIndicators[appIndicator.id]);

        CinnamonSystray.MyApplet.prototype._onIndicatorRemoved.call(this, manager, appIndicator);
    },

    /*
     * The applet has been removed from the panel; save settings
     */
    on_applet_removed_from_panel: function () {
        global.log("[" + uuid + "] Event: on_applet_removed_from_panel");

        CinnamonSystray.MyApplet.prototype.on_applet_removed_from_panel.call(this);

        this.settings.finalize();
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new CollapsibleSystrayApplet(orientation, panel_height, instance_id);
}
