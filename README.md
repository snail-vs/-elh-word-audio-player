# ELH Word Audio Player

Obsidian vocabulary audio player for notes shaped like `reading/单词记忆.md`.

## Current approach

This plugin uses a native Obsidian side view:

- parses `## word` sections from a markdown note
- reads `<audio src="...">` from each word card
- plays the current word audio with an HTML audio element
- supports finite list loops and per-word loops
- renders the current markdown card as the scrolling lyric/card area

Default source file:

```text
reading/单词记忆.md
```

Change it from plugin settings if the note path changes.

Default playback counts:

- list loop count: `2`
- word loop count: `5`

With these defaults, every word is played 5 times, then the player moves to the next word. After the full list is complete, the player starts the next list pass. Playback stops after 2 full list passes.

## Other implementation options

1. Native side view, used here.
   Best for a persistent player, controls, playlists, and rendering markdown cards with Obsidian's renderer.

2. Code block processor, for example:
   ````markdown
   ```word-player
   reading/单词记忆.md
   ```
   ````
   Best when you want the player embedded inside a note. It is less convenient as a global player because it only exists where the note is open.

3. Markdown post processor.
   Best if each `## word` card should be enhanced in-place with play buttons. It is not ideal for continuous list playback.

4. Protocol/custom command driven player.
   Best if other plugins, hotkeys, or scripts need to trigger play/pause/next actions.

## Development

```bash
npm install
npm run build
```

Built plugin files:

- `main.js`
- `manifest.json`
- `styles.css`

## Mobile install

The plugin is mobile-compatible because `manifest.json` sets `isDesktopOnly` to `false`.

Recommended install path for mobile:

1. Publish this repository to GitHub.
2. Create a GitHub release with `main.js`, `manifest.json`, and `styles.css`.
3. Install the plugin on desktop and mobile through BRAT.
4. Enable `ELH Word Audio Player` in Obsidian mobile.

See `INSTALL_MOBILE.md` for details.
