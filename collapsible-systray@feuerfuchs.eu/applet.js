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

        this.manager_container.destroy();

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
        this.mainLayout = new St.BoxLayout({
            vertical: false
        });
        this.mainLayout.add(this.collapseBtn.actor);
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

        //
        // Context menu items

        this.cmitemActiveItems   = new PopupMenu.PopupSubMenuMenuItem(_("Active applications"));
        this.cmitemInactiveItems = new PopupMenu.PopupSubMenuMenuItem(_("Inactive applications"));

        this._populateMenus();

        //
        // Settings

        this.settings = new Settings.AppletSettings(this, uuid, instance_id);
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "icon-visibility-list",    "savedIconVisibilityList", this._loadAppIconVisibilityList, null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "init-delay",              "initDelay",               this._onSettingsUpdated,         null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "animation-duration",      "animationDuration",       this._onSettingsUpdated,         null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "expand-icon-name",        "expandIconName",          this._onVisualSettingsUpdated,   null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "collapse-icon-name",      "collapseIconName",        this._onVisualSettingsUpdated,   null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "tray-icon-hpadding",      "trayIconHPadding",        this._onVisualSettingsUpdated,   null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "expand-on-hover",         "expandOnHover",           this._onSettingsUpdated,         null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "expand-on-hover-delay",   "expandOnHoverDelay",      this._onSettingsUpdated,         null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "collapse-on-leave",       "collapseOnLeave",         this._onSettingsUpdated,         null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "collapse-on-leave-delay", "collapseOnLeaveDelay",    this._onSettingsUpdated,         null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "dont-move-visible-icons", "dontMoveVisibleIcons",    this._onVisualSettingsUpdated,   null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "no-hover-for-tray-icons", "noHoverForTrayIcons",     this._onVisualSettingsUpdated,   null);
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

        if (instanceArray.indexOf(actor) != -1) {
            return;
        }

        global.log("[" + uuid + "] Register instance of " + id);

        actor.origWidth = actor.get_width();

        instanceArray.push(actor);

        if (!this.iconVisibilityList.hasOwnProperty(id)) {
            this.iconVisibilityList[id] = true;
        } else {
            if (this.iconsAreHidden && !this.iconVisibilityList[id]) {
                this._hideAppIcon(id, false);
            }
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
    _addApplicationMenuItem: function(id, activeMenu) {
        let curMenuItems   = activeMenu == this.Menu.ACTIVE_APPLICATIONS ? this.activeMenuItems        : this.inactiveMenuItems;
        let curMenu        = activeMenu == this.Menu.ACTIVE_APPLICATIONS ? this.cmitemActiveItems.menu : this.cmitemInactiveItems.menu;
        let otherMenuItems = activeMenu == this.Menu.ACTIVE_APPLICATIONS ? this.inactiveMenuItems      : this.activeMenuItems;
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

        global.log("[" + uuid + "] Insert menu item for " + id + " in " + (activeMenu == this.Menu.ACTIVE_APPLICATIONS ? "active" : "inactive") + " applications");

        switch (activeMenu) {
            case this.Menu.ACTIVE_APPLICATIONS:
                menuItem = new PopupMenu.PopupSwitchMenuItem(id, this.iconVisibilityList[id]);
                menuItem.appID = id;
                menuItem.connect('toggled', Lang.bind(this, function(o, state) {
                    this._updateAppIconVisibility(id, state);

                    if (this.dontMoveVisibleIcons) {
                        this._onVisualSettingsUpdated();
                    }
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
        for (; index < items.length; index++) {
            if (items[index].appID.localeCompare(id) >= 1) {
                break;
            }
        }

        curMenu.addMenuItem(menuItem, index);
        curMenuItems[id] = menuItem;
    },

    /*
     * Hide the specified icon, either with animation or without
     */
    _hideAppIcon: function(id, animate) {
        let instances = this.registeredAppIcons[id];

        global.log("[" + uuid + "] Hiding icon " + id + " - instances: " + instances.length);

        for (let i = instances.length - 1; i >= 0; --i) {
            let actor = instances[i];

            if (actor.hasOwnProperty('tweenParams')) {
                Tweener.removeTweens(actor);
                actor.tweenParams.onComplete.call(actor.tweenParams.onCompleteScope);
            }

            if (animate) {
                actor.tweenParams = {
                    width:           0.1,
                    opacity:         0,
                    time:            this.animationDuration / 1000,
                    transition:      'easeInOutQuart',
                    onCompleteScope: actor,
                    onComplete: function () {
                        delete this.tweenParams;
                        this.csDisable();
                    }
                };
                Tweener.addTween(actor, actor.tweenParams);
            } else {
                actor.set_width(0.1);
                actor.set_opacity(0);
                actor.csDisable();
            }
        }
    },

    /*
     * Hide all icons that are marked as hidden
     */
    _hideAppIcons: function(animate) {
        if (this.animating) {
            return;
        }

        for (let id in this.registeredAppIcons) {
            if (this.registeredAppIcons.hasOwnProperty(id) && !this.iconVisibilityList[id]) {
                this._hideAppIcon(id, animate);
            }
        }

        if (animate) {
            this.animating = true;

            Mainloop.timeout_add(this.animationDuration, Lang.bind(this, function() {
                this.animating      = false;
                this.iconsAreHidden = true;
                this.collapseBtn.setIsExpanded(false);
            }));
        } else {
            this.iconsAreHidden = true;
            this.collapseBtn.setIsExpanded(false);
        }
    },

    /*
     * Unhide the specified icon, either with animation or without
     */
    _showAppIcon: function(id, animate) {
        let instances = this.registeredAppIcons[id];

        global.log("[" + uuid + "] Showing icon " + id + " - instances: " + instances.length);

        for (let i = instances.length - 1; i >= 0; --i) {
            let actor = instances[i];

            if (actor.hasOwnProperty('tweenParams')) {
                Tweener.removeTweens(actor);
                actor.tweenParams.onComplete.call(actor.tweenParams.onCompleteScope);
            }

            if (animate) {
                actor.csEnable();
                actor.tweenParams = {
                    width:           actor.origWidth,
                    opacity:         255,
                    time:            this.animationDuration / 1000,
                    transition:      'easeInOutQuart',
                    onCompleteScope: actor,
                    onComplete: function () {
                        delete this.tweenParams;
                        actor.csEnableAfter();
                    }
                };
                Tweener.addTween(actor, actor.tweenParams);
            } else {
                actor.csEnable();
                actor.set_width(-1);
                actor.set_opacity(255);
            }
        }
    },

    /*
     * Unhide all icons that are marked as hidden
     */
    _showAppIcons: function(animate) {
        if (this.animating) {
            return;
        }

        for (let id in this.registeredAppIcons) {
            if (this.registeredAppIcons.hasOwnProperty(id)) {
                this._showAppIcon(id, animate);
            }
        }

        if (animate) {
            this.animating = true;

            Mainloop.timeout_add(this.animationDuration, Lang.bind(this, function() {
                this.animating      = false;
                this.iconsAreHidden = false;
                this.collapseBtn.setIsExpanded(true);
            }));
        } else {
            this.iconsAreHidden = false;
            this.collapseBtn.setIsExpanded(true);
        }
    },

    /*
     * Update the specified icon's visibility state and (un)hide it if necessary
     */
    _updateAppIconVisibility: function(id, state) {
        this.iconVisibilityList[id] = state;

        // Application is active, show/hide the icon if necessary
        if (this.registeredAppIcons.hasOwnProperty(id)) {
            if (state) {
                if (this.iconsAreHidden) {
                    this._showAppIcon(id, true);
                }
            } else {
                if (this.iconsAreHidden) {
                    this._hideAppIcon(id, true);
                }
            }
        }

        this._saveAppIconVisibilityList();
    },

    /*
     * Rearrange icons if the 'Avoid moving active icons on expand/collapse' setting is active
     */
    _updateIconOrder: function() {
        if (this.dontMoveVisibleIcons) {
            let trayIcons_ = this.manager_container.get_children();
            let trayIcons  = [];

            for (let i = trayIcons_.length - 1; i >= 0; --i) {
                trayIcons.push(trayIcons_[i]);
            }
            for (let i = trayIcons.length - 1; i >= 0; --i) {
                let icon = trayIcons[i];
                if (!this.iconVisibilityList[icon.role]) {
                    this.manager_container.set_child_at_index(icon, 0);
                }
            }

            let indicators_ = this.indicatorContainer.get_children();
            let indicators  = [];

            for (let i = indicators_.length - 1; i >= 0; --i) {
                indicators.push(indicators_[i]);
            }
            for (let i = indicators.length - 1; i >= 0; --i) {
                let icon = indicators[i];
                if (!this.iconVisibilityList[icon.appID]) {
                    this.manager_container.set_child_at_index(icon, 0);
                }
            }
        }
    },

    /*
     * Update the tray icons' padding
     */
    _updateTrayIconPadding: function() {
        let trayIcons = this.manager_container.get_children();
        for (let i = trayIcons.length - 1; i >= 0; --i) {
            let icon = trayIcons[i];

            icon.set_style('padding-left: ' + this.trayIconHPadding + 'px; padding-right: ' + this.trayIconHPadding + 'px;');
            let padDiff = this.trayIconHPadding - icon.origPadding;
            icon.origWidth  += padDiff * 2;
            icon.origPadding = this.trayIconHPadding;

            if (!this.iconsAreHidden || this.iconVisibilityList[icon.role]) {
                icon.set_width(icon.origWidth);
            }
        }
        this.manager_container.queue_relayout();
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
     * A  applet setting with visual impact has been changed; reload
     * collapse/expand button's icons and reload all tray icons
     */
    _onVisualSettingsUpdated: function() {
        this.collapseBtn.setIsExpanded(!this.iconsAreHidden);
        this._updateIconOrder();
        this._updateTrayIconPadding();
    },

    /*
     * An applet setting has been changed
     */
    _onSettingsUpdated: function() {

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

        let children = this.manager_container.get_children();
        for (var i = 0; i < children.length; i++) {
            this._unregisterAppIcon(children[i].role, children[i]);
        }

        CinnamonSystray.MyApplet.prototype._onBeforeRedisplay.call(this);
    },

    /*
     * A tray icon has been removed; unregister it and destroay the wrapper
     */
    _onTrayIconRemoved: function(o, icon) {
        global.log("[" + uuid + "] Event: _onTrayIconRemoved - " + icon.role);

        this._unregisterAppIcon(icon.role, icon.wrapper);

        icon.wrapper.destroy();

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

        let index = 0;
        if (!this.dontMoveVisibleIcons) {
            index = this.manager_container.get_children().indexOf(icon);

            this.manager_container.remove_child(icon);
        } else {
            this.manager_container.remove_child(icon);

            if (!this.iconVisibilityList.hasOwnProperty(role) || this.iconVisibilityList[role]) {
                // Icon is always visible; put it on the right end
                index = this.manager_container.get_children().length;
            }
        }

        let iconWrap        = new St.BoxLayout({ style_class: 'applet-box', reactive: true, track_hover: !this.noHoverForTrayIcons });
        let iconWrapContent = new St.Bin({ child: icon });
        iconWrap.add_style_class_name('ff-collapsible-systray__status-icon');
        iconWrap.set_style('padding-left: ' + this.trayIconHPadding + 'px; padding-right: ' + this.trayIconHPadding + 'px;');
        iconWrap.add_actor(iconWrapContent, { a_align: St.Align.MIDDLE, y_fill: false });
        iconWrap.origPadding   = this.trayIconHPadding;
        iconWrap.role          = role;
        iconWrap._rolePosition = icon._rolePosition;
        icon.wrapper           = iconWrap;
        icon.role              = role;

        //
        // Icon deactivation/reactivation methods

        // 1: Remove/add icon actor from wrapper (recommended for non-updating icons)
        if (["chromium", "livestreamer-twitch-gui", "swt"].indexOf(role) != -1) {
            iconWrap.csDisable = function() {
                iconWrapContent.set_child(null);
            }
            iconWrap.csEnable = function() {
                iconWrapContent.set_child(icon);
            }
            iconWrap.csEnableAfter = function() { }
        }
        // 2: Hide the associated CinnamonEmbeddedWindow on collapse and un-hide it once the expand animation is finished
        else if (["pidgin"].indexOf(role) != -1) {
            iconWrap.csDisable = function() {
                icon.window.hide();
            }
            iconWrap.csEnable = function() { }
            iconWrap.csEnableAfter = function() {
                icon.window.show_all();
            }
        }
        // 3: Hide/un-hide the associated CinnamonEmbeddedWindow on collapse/expand
        else {
            iconWrap.csDisable = function() {
                icon.window.hide();
            }
            iconWrap.csEnable = function() {
                icon.window.show_all();
            }
            iconWrap.csEnableAfter = function() { }
        }

        this.manager_container.insert_child_at_index(iconWrap, index);

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

            if (!this.dontMoveVisibleIcons) {
                this.indicatorContainer.add(iconActor.actor);
            } else {
                let index = 0;

                if (!this.iconVisibilityList.hasOwnProperty(appIndicator.id) || this.iconVisibilityList[appIndicator.id]) {
                    // Icon is always visible; put it on the right end
                    index = this.indicatorContainer.get_children().length;
                }

                this.indicatorContainer.insert_child_at_index(iconActor.actor, index);
            }

            iconActor.actor.appID = appIndicator.id;
            iconActor.actor.csDisable = function() {
                iconActor.actor.set_reactive(false);
            }
            iconActor.actor.csEnable = function() {
                iconActor.actor.set_reactive(true);
            }
            iconActor.actor.csEnableAfter = function() {

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
