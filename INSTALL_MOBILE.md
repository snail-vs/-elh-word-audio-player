# Mobile install

This plugin supports Obsidian mobile because `manifest.json` sets:

```json
"isDesktopOnly": false
```

## Recommended mobile path

Publish this repository to GitHub, then install it on mobile with BRAT.

1. Install the BRAT community plugin on desktop and mobile.
2. Add this repository in BRAT.
3. Let BRAT download the latest release assets.
4. Enable `ELH Word Audio Player` in Obsidian mobile.

Required release assets:

- `main.js`
- `manifest.json`
- `styles.css`

## Manual install path

Copy the release assets into the mobile vault:

```text
.obsidian/plugins/elh-word-audio-player/main.js
.obsidian/plugins/elh-word-audio-player/manifest.json
.obsidian/plugins/elh-word-audio-player/styles.css
```

Then restart Obsidian mobile and enable the plugin.

