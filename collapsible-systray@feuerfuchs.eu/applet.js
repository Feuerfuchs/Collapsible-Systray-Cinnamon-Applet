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

            if (this.initDelayID) {
                Mainloop.source_remove(this.initDelayID);
                this.initDelayID = null;
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

        this._shellIndicators   = [];
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
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "icon-visibility-list", "savedIconVisibilityList", this._loadAppIconVisibilityList, null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "init-delay",           "initDelay",               this._onSettingsUpdated,         null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "animation-duration",   "animationDuration",       this._onSettingsUpdated,         null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "expand-icon-name",     "expandIconName",          this._onSettingsUpdated,         null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "collapse-icon-name",   "collapseIconName",        this._onSettingsUpdated,         null);
        this.settings.bindProperty(Settings.BindingDirection.IN,            "tray-icon-hpadding",   "trayIconHPadding",        this._onSettingsUpdated,         null);
        this._loadAppIconVisibilityList();
        this._onSettingsUpdated();

        //
        // Collapse after 3 seconds

        this.initDelayID = Mainloop.timeout_add(this.initDelay * 1000, Lang.bind(this, function() {
            this.initDelayID = null;
            this._hideAppIcons(true);
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
        if (this.registeredAppIcons.hasOwnProperty(id)) {
            this._unregisterAppIcon(id);
        }

        actor.origWidth = actor.get_width();

        this.registeredAppIcons[id] = actor;

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
    _unregisterAppIcon: function(id) {
        delete this.registeredAppIcons[id];

        this._addApplicationMenuItem(id, this.Menu.INACTIVE_APPLICATIONS);
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

        switch (activeMenu) {
            case this.Menu.ACTIVE_APPLICATIONS:
                menuItem = new PopupMenu.PopupSwitchMenuItem(id, this.iconVisibilityList[id]);
                menuItem.connect('toggled', Lang.bind(this, function(o, state) {
                    this._updateAppIconVisibility(id, state);
                }));
                break;

            default:
            case this.Menu.INACTIVE_APPLICATIONS:
                menuItem = new CSRemovableSwitchMenuItem.CSRemovableSwitchMenuItem(id, this.iconVisibilityList[id]);
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

        curMenu.addMenuItem(menuItem);
        curMenuItems[id] = menuItem;
    },

    /*
     * Hide the specified icon, either with animation or without
     */
    _hideAppIcon: function(id, animate) {
        let actor = this.registeredAppIcons[id];

        if (actor.hasOwnProperty('tweenParams')) {
            Tweener.removeTweens(actor);
            actor.tweenParams.onComplete.call(actor.tweenParams.onCompleteScope);
        }

        if (animate) {
            actor.tweenParams = {
                width:           0,
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
            actor.set_width(0);
            actor.set_opacity(0);
            actor.csDisable();
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
        let actor = this.registeredAppIcons[id];

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
                }
            };
            Tweener.addTween(actor, actor.tweenParams);
        } else {
            actor.csEnable();
            actor.set_width(actor.origWidth);
            actor.set_opacity(255);
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
     * An applet settings has been changed; reload collapse/expand button's icons
     * and reload all tray icons
     */
    _onSettingsUpdated: function() {
        this.collapseBtn.setIsExpanded(!this.iconsAreHidden);
        Main.statusIconDispatcher.redisplay();
    },

    //
    // Overrides
    // ---------------------------------------------------------------------------------

    /*
     * Disable the collapse/expand button if the panel is in edit mode so the user can
     * perform drag and drop on that button
     */
    _setAppletReactivity: function() {
        CinnamonSystray.MyApplet.prototype._setAppletReactivity.call(this);

        this.collapseBtn.actor.set_reactive(this._draggable.inhibit);
    },

    /*
     * The Cinnamon applet invalidates all tray icons if this event occurs, so I have to
     * unregister all tray icons when this happens
     */
    _onBeforeRedisplay: function() {
        let children = this.manager_container.get_children();
        for (var i = 0; i < children.length; i++) {
            this._unregisterAppIcon(children[i].role);
        }

        CinnamonSystray.MyApplet.prototype._onBeforeRedisplay.call(this);
    },

    /*
     * A tray icon has been removed; unregister it and destroay the wrapper
     */
    _onTrayIconRemoved: function(o, icon) {
        this._unregisterAppIcon(icon.role);

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

        CinnamonSystray.MyApplet.prototype._insertStatusItem.call(this, role, icon, position);

        let index    = 0;
        let children = this.manager_container.get_children();
        for (let i = children.length - 1; i >= 0; i--) {
            let child = children[i];
            if (child === icon) {
                index = i;
                break;
            }
        }

        this.manager_container.remove_child(icon);

        let iconWrap        = new St.BoxLayout({ style_class: 'applet-box', reactive: true, track_hover: true });
        let iconWrapContent = new St.Bin({ child: icon });
        iconWrap.add_style_class_name('ff-collapsible-systray__status-icon');
        iconWrap.set_style('padding-left: ' + this.trayIconHPadding + 'px; padding-right: ' + this.trayIconHPadding + 'px;');
        iconWrap.add(iconWrapContent, { a_align: St.Align.MIDDLE, y_fill: false });
        iconWrap.role          = role;
        iconWrap._rolePosition = icon._rolePosition;
        icon.wrapper           = iconWrap;
        icon.role              = role;
        iconWrap.csDisable = function() {
            iconWrapContent.set_child(null);
        }
        iconWrap.csEnable = function() {
            iconWrapContent.set_child(icon);
        }

        this.manager_container.insert_child_at_index(iconWrap, index);

        this._registerAppIcon(role, iconWrap);
    },

    /*
     * An AppIndicator has been added; prepare its actor and register the icon
     */
    _onIndicatorAdded: function(manager, appIndicator) {
        if (!(appIndicator.id in this._shellIndicators)) {
            CinnamonSystray.MyApplet.prototype._onIndicatorAdded.call(this, manager, appIndicator);

            let iconActor = this._shellIndicators[appIndicator.id];
            if (iconActor !== undefined) {
                this.actor.remove_actor(iconActor.actor);
                this.indicatorContainer.add(iconActor.actor);

                iconActor.actor.csDisable = function() {
                    iconActor.actor.set_reactive(false);
                }
                iconActor.actor.csEnable = function() {
                    iconActor.actor.set_reactive(true);
                }

                this._registerAppIcon(appIndicator.id, iconActor.actor);
            }
        }
    },

    /*
     * An AppIndicator has been removed; unregister it
     */
    _onIndicatorRemoved: function(manager, appIndicator) {
        let id = appIndicator.id;

        CinnamonSystray.MyApplet.prototype._onIndicatorRemoved.call(this, manager, appIndicator);

        this._unregisterAppIcon(id);
    },

    /*
     * The applet has been removed from the panel; save settings
     */
    on_applet_removed_from_panel: function () {
        CinnamonSystray.MyApplet.prototype.on_applet_removed_from_panel.call(this);

        this.settings.finalize();
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new CollapsibleSystrayApplet(orientation, panel_height, instance_id);
}
