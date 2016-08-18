This applet is a replacement for the popular but, sadly, abandonded [System Tray Collapsible](cinnamon-spices.linuxmint.com/applets/view/154) Cinnamon applet. As such, this applet's main purpose is to integrate tray icons seamlessly into your desktop and allowing you to hide icons you rarely need.


# Settings documentation

* **Behavior**
  * **Animation duration** – The duration of the expand/collapse animation. You can disable animationy by setting this value to 0.
  * **Expand on hover** – If checked, the tray will automatically expand if you move the mouse pointer over the applet
  * **Expand on hover delay** — The delay before the tray expands on hover
  * **Collapse on un-hover** – If checked, the tray will automatically collapse if you move the mouse pointer away from the applet
  * **Collapse on un-hover delay** — The delay before the tray collapses on un-hover
  * **Startup collapse delay** — The tray collapses automatically when it is loaded. You can define a delay here during which all icons are visible.
* **Appearance**
  * **Disable hover effect for tray icons** — If you have problems with the hover effect or it simply doesn't look good, you should enable this setting
  * **Avoid moving active icons on expand/collapse** — If enabled, icons are grouped in such a way that expanding/collapsing the tray will not move the visible icons
  * **Expand icon** — The icon used for the expand/collapse button if the tray is collapsed
  * **Collapse icon** — The icon used for the expand/collapse button if the tray is expanded
  * **Horizontal padding of tray icons** — Depending on the theme used the spacing between applets is different from the default tray icon spacing. You can adjust the tray icon spacing here.


# Installation

To install the applet, execute the `install.sh` script. If the applet doesn't appear in the applet list, you should restart Cinnamon by pressing Alt+F2, typing 'r' (without ') and hitting enter.
To remove the applet, just run `install.sh -r`.
