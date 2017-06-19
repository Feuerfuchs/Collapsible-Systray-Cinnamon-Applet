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

    Direction: {
        HORIZONTAL: 0,
        VERTICAL:   1
    },

    _init: function(orientation, panel_height, instance_id) {
        this._orientation = orientation;
        
        //
        // Expand/collapse button

        this.collapseBtn = new CSCollapseBtn.CSCollapseBtn(this);
        this.collapseBtn.actor.connect('clicked', Lang.bind(this, function(o, event) {
            if (this._hoverTimerID) {
                Mainloop.source_remove(this._hoverTimerID);
                this._hoverTimerID = null;
            }
            if (this._initialCollapseTimerID) {
                Mainloop.source_remove(this._initialCollapseTimerID);
                this._initialCollapseTimerID = null;
            }

            switch (this.collapseBtn.state) {
                case this.collapseBtn.State.EXPANDED:
                    this._hideAppIcons(true);
                    break;

                case this.collapseBtn.State.COLLAPSED:
                    this._showAppIcons(true);
                    break;

                case this.collapseBtn.State.UNAVAILABLE:
                    this._applet_context_menu.toggle();
                    break;
            }
        }));

        //
        // Initialize Cinnamon applet

        CinnamonSystray.MyApplet.prototype._init.call(this, orientation, panel_height, instance_id);

        this.actor.add_style_class_name("ff-collapsible-systray");

        this.actor.remove_actor(this.manager_container);

        //
        // Variables

        this._direction          = (orientation == St.Side.TOP || orientation == St.Side.BOTTOM) ? this.Direction.HORIZONTAL : this.Direction.VERTICAL;
        this._signalManager      = new SignalManager.SignalManager(this);
        this._hovering           = false;
        this._hoverTimerID       = null;
        this._registeredAppIcons = {};
        this._activeMenuItems    = {};
        this._inactiveMenuItems  = {};
        this._animating          = false;
        this._iconsAreHidden     = false;

        //
        // Root container

        this.mainLayout = new St.BoxLayout({ vertical: this._direction == this.Direction.VERTICAL });

        //
        // Container for hidden icons

        this.hiddenIconsContainer = new St.BoxLayout({ vertical: this._direction == this.Direction.VERTICAL });

        // Add horizontal scrolling and scroll to the end on each redraw so that it looks like the
        // collapse button "eats" the icons on collapse
        this.hiddenIconsContainer.hadjustment = new St.Adjustment();
        this.hiddenIconsContainer.vadjustment = new St.Adjustment();
        this.hiddenIconsContainer.connect('queue-redraw', Lang.bind(this, function() {
            if (this._direction == this.Direction.HORIZONTAL) {
                this.hiddenIconsContainer.hadjustment.set_value(this.hiddenIconsContainer.hadjustment.upper);
            } else {
                this.hiddenIconsContainer.vadjustment.set_value(this.hiddenIconsContainer.vadjustment.upper);
            }
        }));

        //
        // Container for shown icons

        this.shownIconsContainer = new St.BoxLayout({ vertical: this._direction == this.Direction.VERTICAL });

        //
        // Assemble layout

        this.mainLayout.add_actor(this.collapseBtn.actor);
        this.mainLayout.add_actor(this.hiddenIconsContainer);
        this.mainLayout.add_actor(this.shownIconsContainer);
        this.mainLayout.set_child_above_sibling(this.shownIconsContainer, this.hiddenIconsContainer);
        this.actor.add_actor(this.mainLayout);

        //
        // Context menu items

        this.cmitemActiveItems   = new PopupMenu.PopupSubMenuMenuItem(_("Active applications"));
        this.cmitemInactiveItems = new PopupMenu.PopupSubMenuMenuItem(_("Inactive applications"));

        this._populateMenus();

        //
        // Settings

        this._settings = new Settings.AppletSettings(this, uuid, instance_id);
        this._settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "icon-visibility-list",          "savedIconVisibilityList",    this._loadAppIconVisibilityList, null);
        this._settings.bindProperty(Settings.BindingDirection.IN,            "init-delay",                    "initDelay",                  this._onSettingsUpdated,         "initDelay");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "animation-duration",            "animationDuration",          this._onSettingsUpdated,         "animationDuration");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "horizontal-expand-icon-name",   "horizontalExpandIconName",   this._onSettingsUpdated,         "horizontalExpandIconName");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "horizontal-collapse-icon-name", "horizontalCollapseIconName", this._onSettingsUpdated,         "horizontalCollapseIconName");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "vertical-expand-icon-name",     "verticalExpandIconName",     this._onSettingsUpdated,         "verticalExpandIconName");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "vertical-collapse-icon-name",   "verticalCollapseIconName",   this._onSettingsUpdated,         "verticalCollapseIconName");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "tray-icon-padding",             "trayIconPadding",            this._onSettingsUpdated,         "trayIconPadding");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "expand-on-hover",               "expandOnHover",              this._onSettingsUpdated,         "expandOnHover");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "expand-on-hover-delay",         "expandOnHoverDelay",         this._onSettingsUpdated,         "expandOnHoverDelay");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "collapse-on-leave",             "collapseOnLeave",            this._onSettingsUpdated,         "collapseOnLeave");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "collapse-on-leave-delay",       "collapseOnLeaveDelay",       this._onSettingsUpdated,         "collapseOnLeaveDelay");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "no-hover-for-tray-icons",       "noHoverForTrayIcons",        this._onSettingsUpdated,         "noHoverForTrayIcons");
        this._settings.bindProperty(Settings.BindingDirection.IN,            "sort-icons",                    "sortIcons",                  this._onSettingsUpdated,         "sortIcons");
        
        this._loadAppIconVisibilityList();
        this.collapseBtn.setVertical(this._direction == this.Direction.VERTICAL);
        this.collapseBtn.refreshReactive();
    },

    /*
     * Get the correct collapse icon according to the user settings and the applet orientation
     */
    get collapseIcon() {
        if (this._direction == this.Direction.HORIZONTAL) {
            return this.horizontalCollapseIconName;
        } else {
            return this.verticalCollapseIconName;
        }
    },

    /*
     * Get the correct expand icon according to the user settings and the applet orientation
     */
    get expandIcon() {
        if (this._direction == this.Direction.HORIZONTAL) {
            return this.horizontalExpandIconName;
        } else {
            return this.verticalExpandIconName;
        }
    },

    /*
     * Set the collapse button's state
     */
    _refreshCollapseBtnState: function() {
        let collapsible = false;
        for (let id in this.iconVisibilityList) {
            if (this.iconVisibilityList.hasOwnProperty(id) && this._registeredAppIcons.hasOwnProperty(id)) {
                if (!this.iconVisibilityList[id]) {
                    collapsible = true;
                    break;
                }
            }
        }

        if (collapsible) {
            this.collapseBtn.setState(this._iconsAreHidden ? this.collapseBtn.State.COLLAPSED : this.collapseBtn.State.EXPANDED);
        } else {    
            this.collapseBtn.setState(this.collapseBtn.State.UNAVAILABLE);
        }
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
        if (!this._registeredAppIcons.hasOwnProperty(id)) {
            this._registeredAppIcons[id] = [];
        }

        const instanceArray = this._registeredAppIcons[id];

        if (instanceArray.indexOf(actor) != -1) return;

        global.log("[" + uuid + "] Register instance of " + id);

        instanceArray.push(actor);

        if (!this.iconVisibilityList.hasOwnProperty(id)) {
            this.iconVisibilityList[id] = true;
            this._saveAppIconVisibilityList();
        }

        const container = this.iconVisibilityList[id] ? this.shownIconsContainer : this.hiddenIconsContainer;
        let   index     = 0;
        if (this.sortIcons) {
            const icons = container.get_children();
            for (let len = icons.length; index < len; ++index) {
                if (icons[index].appID.localeCompare(id) >= 1) {
                    break;
                }
            }
        }
        container.insert_actor(actor, index);

        actor.appID = id;

        if (this._iconsAreHidden && !this.iconVisibilityList[id]) {
            actor.csDisable();
        }

        this._addApplicationMenuItem(id, this.Menu.ACTIVE_APPLICATIONS);
        this._refreshCollapseBtnState();
    },

    /*
     * Remove the icon from the list and move the menu entry to the list of inactive applications
     */
    _unregisterAppIcon: function(id, actor) {
        global.log("[" + uuid + "] Unregister instance of " + id);

        const instanceArray = this._registeredAppIcons[id];
        const iconIndex     = instanceArray.indexOf(actor);
        if (iconIndex != -1) {
            instanceArray.splice(iconIndex, 1);
        }

        //actor.destroy();
        actor.get_parent().remove_actor(actor);

        if (instanceArray.length == 0) {
            global.log("[" + uuid + "] No more instances left");

            delete instanceArray;
            delete this._registeredAppIcons[id];
            this._addApplicationMenuItem(id, this.Menu.INACTIVE_APPLICATIONS);
            this._refreshCollapseBtnState();
        }
    },

    /*
     * Create a menu entry for the specified icon in the "active applications" section
     */
    _addApplicationMenuItem: function(id, menu) {
        const curMenuItems   = menu == this.Menu.ACTIVE_APPLICATIONS ? this._activeMenuItems       : this._inactiveMenuItems;
        const curMenu        = menu == this.Menu.ACTIVE_APPLICATIONS ? this.cmitemActiveItems.menu : this.cmitemInactiveItems.menu;
        const otherMenuItems = menu == this.Menu.ACTIVE_APPLICATIONS ? this._inactiveMenuItems     : this._activeMenuItems;
        let   menuItem       = null;

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

                    delete this._inactiveMenuItems[id];
                }));
                break;
        }

        // Find insertion index so all menu items are alphabetically sorted
        let   index = 0;
        const items = curMenu._getMenuItems();
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
        if (animate && this._animating) {
            return;
        }

        if (this.hiddenIconsContainer.hasOwnProperty('tweenParams')) {
            Tweener.removeTweens(this.hiddenIconsContainer);
            this.hiddenIconsContainer.tweenParams.onComplete();
        }

        this._iconsAreHidden = true;

        const onFinished = Lang.bind(this, function() {
            delete this.hiddenIconsContainer.tweenParams;

            let icons  = this.hiddenIconsContainer.get_children();
            for (let i = icons.length - 1; i >= 0; --i) {
                icons[i].csDisable();
            }

            this._animating = false;
            this._refreshCollapseBtnState();
        });

        if (animate) {
            this._animating = true;
            this.hiddenIconsContainer.tweenParams = {
                time:       this.animationDuration / 1000,
                transition: 'easeInOutQuart',
                onComplete: onFinished
            }

            if (this._direction == this.Direction.HORIZONTAL) {
                this.hiddenIconsContainer.tweenParams.width = 0;
            } else {
                this.hiddenIconsContainer.tweenParams.height = 0;
            }

            Tweener.addTween(this.hiddenIconsContainer, this.hiddenIconsContainer.tweenParams);
        } else {
            if (this._direction == this.Direction.HORIZONTAL) {
                this.hiddenIconsContainer.set_width(0);
            } else {
                this.hiddenIconsContainer.set_height(0);
            }
            onFinished();
        }
    },

    /*
     * Unhide all icons that are marked as hidden
     */
    _showAppIcons: function(animate) {
        if (animate && this._animating) {
            return;
        }

        if (this.hiddenIconsContainer.hasOwnProperty('tweenParams')) {
            Tweener.removeTweens(this.hiddenIconsContainer);
            this.hiddenIconsContainer.tweenParams.onComplete();
        }

        this._iconsAreHidden = false;

        const onFinished = Lang.bind(this, function() {
            delete this.hiddenIconsContainer.tweenParams;

            this.hiddenIconsContainer.get_children().forEach(function(icon, index) {
                icon.csEnableAfter();
            });

            if (this._direction == this.Direction.HORIZONTAL) {
                this.hiddenIconsContainer.set_width(-1);
            } else {
                this.hiddenIconsContainer.set_height(-1);
            }

            this._animating = false;
            this._refreshCollapseBtnState();
        });

        this.hiddenIconsContainer.get_children().forEach(function(icon, index) {
            icon.csEnable();
        });

        if (animate) {
            this._animating = true;

            this.hiddenIconsContainer.tweenParams = {
                time:       this.animationDuration / 1000,
                transition: 'easeInOutQuart',
                onComplete: onFinished
            };

            if (this._direction == this.Direction.HORIZONTAL) {
                let [minWidth, natWidth] = this.hiddenIconsContainer.get_preferred_width(-1);
                let prevWidth = natWidth;

                this.hiddenIconsContainer.set_width(-1);
                [minWidth, natWidth] = this.hiddenIconsContainer.get_preferred_width(-1);
                this.hiddenIconsContainer.tweenParams.width = natWidth;

                this.hiddenIconsContainer.set_width(prevWidth);
            } else {
                let [minHeight, natHeight] = this.hiddenIconsContainer.get_preferred_height(-1);
                let prevHeight = natHeight;

                this.hiddenIconsContainer.set_height(-1);
                [minHeight, natHeight] = this.hiddenIconsContainer.get_preferred_height(-1);
                this.hiddenIconsContainer.tweenParams.height = natHeight;

                this.hiddenIconsContainer.set_height(prevHeight);
            }

            Tweener.addTween(this.hiddenIconsContainer, this.hiddenIconsContainer.tweenParams);
        } else {
            if (this._direction == this.Direction.HORIZONTAL) {
                this.hiddenIconsContainer.set_width(-1);
            } else {
                this.hiddenIconsContainer.set_height(-1);
            }
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
        if (this._registeredAppIcons.hasOwnProperty(id)) {
            const instances = this._registeredAppIcons[id];

            const container = state ? this.shownIconsContainer : this.hiddenIconsContainer;
            let   index     = 0;

            if (this.sortIcons) {
                const icons = container.get_children();
                for (let len = icons.length; index < len; ++index) {
                    if (icons[index].appID.localeCompare(id) >= 1) {
                        break;
                    }
                }
            }

            instances.forEach(Lang.bind(this, function(actor, index) {
                actor.get_parent().remove_child(actor);
                container.add_child(actor);
                container.set_child_at_index(actor, index);

                if (this._iconsAreHidden) {
                    if (state) {
                        actor.csEnable();
                        actor.csEnableAfter();
                    } else {
                        actor.csDisable();
                    }
                }
            }));
        }

        this._saveAppIconVisibilityList();
        this._refreshCollapseBtnState();
    },

    /*
     * Update the tray icons' padding
     */
    _updateTrayIconPadding: function() {
        this.shownIconsContainer.get_children()
            .concat(this.hiddenIconsContainer.get_children())
            .filter(function(iconWrapper) { return iconWrapper.isIndicator != true; })
            .forEach(Lang.bind(this, function(iconWrapper, index) {
                if (this._direction == this.Direction.HORIZONTAL) {
                    iconWrapper.set_style('padding-left: ' + this.trayIconPadding + 'px; padding-right: ' + this.trayIconPadding + 'px;');
                } else {
                    iconWrapper.set_style('padding-top: ' + this.trayIconPadding + 'px; padding-bottom: ' + this.trayIconPadding + 'px;');
                }
            }));
    },

    /*
     * Load the list of hidden icons from the settings
     */
    _loadAppIconVisibilityList: function() {
        try {
            this.iconVisibilityList = JSON.parse(this.savedIconVisibilityList);

            this._refreshCollapseBtnState();

            for (let id in this.iconVisibilityList) {
                if (this.iconVisibilityList.hasOwnProperty(id) && !this._registeredAppIcons.hasOwnProperty(id)) {
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
                this._refreshCollapseBtnState();
                break;

            case 'trayIconPadding':
                this._updateTrayIconPadding();
                break;
        }
    },

    //
    // Events
    // ---------------------------------------------------------------------------------

    _onEnter: function() {
        this._hovering = true;

        if (this._hoverTimerID) {
            Mainloop.source_remove(this._hoverTimerID);
            this._hoverTimerID = null;
        }

        if (!this.expandOnHover)      return;
        if (!this._draggable.inhibit) return;

        if (this._initialCollapseTimerID) {
            Mainloop.source_remove(this._initialCollapseTimerID);
            this._initialCollapseTimerID = null;
        }

        this._hoverTimerID = Mainloop.timeout_add(this.expandOnHoverDelay, Lang.bind(this, function() {
            this._hoverTimerID = null;

            if (this._iconsAreHidden) {
                this._showAppIcons(true);
            }
        }));
    },

    _onLeave: function() {
        this._hovering = false;

        if (this._hoverTimerID) {
            Mainloop.source_remove(this._hoverTimerID);
            this._hoverTimerID = null;
        }

        if (!this.collapseOnLeave)    return;
        if (!this._draggable.inhibit) return;

        if (this._initialCollapseTimerID) {
            Mainloop.source_remove(this._initialCollapseTimerID);
            this._initialCollapseTimerID = null;
        }

        this._hoverTimerID = Mainloop.timeout_add(this.collapseOnLeaveDelay, Lang.bind(this, function() {
            this._hoverTimerID = null;

            if (!this._iconsAreHidden) {
                this._hideAppIcons(true);
            }
        }));
    },

    //
    // Overrides
    // ---------------------------------------------------------------------------------

    /*
     * Disable the collapse/expand button if the panel is in edit mode so the user can
     * perform drag and drop on that button
     */
    _setAppletReactivity: function() {
        global.log("[" + uuid + "] Event: _setAppletReactivity");

        CinnamonSystray.MyApplet.prototype._setAppletReactivity.call(this);

        this.collapseBtn.refreshReactive();

        if (this._hoverTimerID) {
            Mainloop.source_remove(this._hoverTimerID);
            this._hoverTimerID = null;
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

        this.shownIconsContainer.get_children()
            .concat(this.hiddenIconsContainer.get_children())
            .filter(function(iconWrapper) { return iconWrapper.isIndicator != true; })
            .forEach(Lang.bind(this, function(iconWrapper, index) {
                iconWrapper.icon.destroy();
            }));

        if (this._initialCollapseTimerID) {
            Mainloop.source_remove(this._initialCollapseTimerID);
            this._initialCollapseTimerID = null;
        }

        this._initialCollapseTimerID = Mainloop.timeout_add(this.initDelay * 1000, Lang.bind(this, function() {
            this._initialCollapseTimerID = null;

            if (this._draggable.inhibit) {
                this._hideAppIcons(true);
            }
        }));
    },

    /*
     * Remove icon from tray, wrap it in an applet-box and re-add it. This way,
     * tray icons are displayed like applets and thus integrate nicely in the panel.
     */
    _insertStatusItem: function(role, icon, position) {
        if (icon.obsolete == true) {
            return;
        }
        if (role.trim() == "") {
            role = "[empty name]";
        }

        global.log("[" + uuid + "] Event: _insertStatusItem - " + role);

        CinnamonSystray.MyApplet.prototype._insertStatusItem.call(this, role, icon, position);

        this.manager_container.remove_child(icon);

        const iconWrap        = new St.BoxLayout({ style_class: 'applet-box', reactive: true, track_hover: !this.noHoverForTrayIcons });
        const iconWrapContent = new St.Bin({ child: icon });

        iconWrap.add_style_class_name('ff-collapsible-systray__status-icon');
        iconWrap.add_actor(iconWrapContent);
        if (this._direction == this.Direction.HORIZONTAL) {
            iconWrap.set_style('padding-left: ' + this.trayIconPadding + 'px; padding-right: ' + this.trayIconPadding + 'px;');
        } else {
            iconWrap.set_style('padding-top: ' + this.trayIconPadding + 'px; padding-bottom: ' + this.trayIconPadding + 'px;');
        }
        iconWrap.isIndicator = false;
        iconWrap.icon        = icon;
        iconWrap.setVertical = function(vertical) {
            iconWrap.set_vertical(vertical);
            if (vertical) {
                iconWrap.add_style_class_name('vertical');
            } else {
                iconWrap.remove_style_class_name('vertical');
            }
        }
        iconWrap.setVertical(this._direction == this.Direction.VERTICAL);

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

        icon.connect('destroy', Lang.bind(this, function() {
            this._unregisterAppIcon(role, iconWrap);
        }));

        this._registerAppIcon(role, iconWrap);
    },

    /*
     * An AppIndicator has been added; prepare its actor and register the icon
     */
    _onIndicatorAdded: function(manager, appIndicator) {
        global.log("[" + uuid + "] Event: _onIndicatorAdded - " + appIndicator.id);

        CinnamonSystray.MyApplet.prototype._onIndicatorAdded.call(this, manager, appIndicator);

        if (appIndicator.id in this._shellIndicators) {
            const iconActor = this._shellIndicators[appIndicator.id];

            this.manager_container.remove_actor(iconActor.actor);

            iconActor.actor.isIndicator = true;
            iconActor.actor.csDisable = function() {
                iconActor.actor.set_reactive(false);
            }
            iconActor.actor.csEnable = function() {
                iconActor.actor.set_reactive(true);
            }
            iconActor.actor.csEnableAfter = function() { }
            iconActor.actor.connect('destroy', Lang.bind(this, function() {
                this._unregisterAppIcon(appIndicator.id, iconActor.actor);
            }));

            this._registerAppIcon(appIndicator.id, iconActor.actor);
        }
    },

    /*
     * The applet's orientation changed; adapt accordingly
     */
    on_orientation_changed: function(orientation) {
        global.log("[" + uuid + "] Event: on_orientation_changed");

        CinnamonSystray.MyApplet.prototype.on_orientation_changed.call(this, orientation);

        this._orientation = orientation;
        this._direction  = (orientation == St.Side.TOP || orientation == St.Side.BOTTOM) ? this.Direction.HORIZONTAL : this.Direction.VERTICAL;

        if (this._direction == this.Direction.VERTICAL) {
            this.mainLayout.set_vertical(true);
            this.hiddenIconsContainer.set_vertical(true);
            this.shownIconsContainer.set_vertical(true);
            this.collapseBtn.setVertical(true);

            this.hiddenIconsContainer.get_children().forEach(function(icon, index) {
                icon.setVertical(true);
            });
        } else {
            this.mainLayout.set_vertical(false);
            this.hiddenIconsContainer.set_vertical(false);
            this.shownIconsContainer.set_vertical(false);
            this.collapseBtn.setVertical(false);

            this.hiddenIconsContainer.get_children().forEach(function(icon, index) {
                icon.setVertical(false);
            });
        }

        this.hiddenIconsContainer.hadjustment.set_value(0);
        this.hiddenIconsContainer.vadjustment.set_value(0);
    },

    /*
     * The applet has been added to the panel; save settings
     */
    on_applet_added_to_panel: function() {
        global.log("[" + uuid + "] Event: on_applet_added_to_panel");

        CinnamonSystray.MyApplet.prototype.on_applet_added_to_panel.call(this);

        // Automatically collapse after X seconds
        this._initialCollapseTimerID = Mainloop.timeout_add(this.initDelay * 1000, Lang.bind(this, function() {
            this._initialCollapseTimerID = null;

            if (this._draggable.inhibit) {
                this._hideAppIcons(true);
            }
        }));

        //
        // Hover events

        this._signalManager.connect(this.actor, 'enter-event', Lang.bind(this, this._onEnter));
        this._signalManager.connect(this.actor, 'leave-event', Lang.bind(this, this._onLeave));
    },

    /*
     * The applet has been removed from the panel; save settings
     */
    on_applet_removed_from_panel: function () {
        global.log("[" + uuid + "] Event: on_applet_removed_from_panel");

        CinnamonSystray.MyApplet.prototype.on_applet_removed_from_panel.call(this);

        this._settings.finalize();
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new CollapsibleSystrayApplet(orientation, panel_height, instance_id);
}
