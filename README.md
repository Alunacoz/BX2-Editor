# BounceX Editor

A standalone path editor for [BounceX-Viewer](https://github.com/Alunacoz/BounceX-Viewer). Sync video playback with marker placement and export `.bx` or `.bx2` path files. No install required — open `editor.html` in a modern browser.

---

## Getting Started

1. Open `editor.html` in Chrome, Edge, or another Chromium-based browser
2. Click **Load Video** (or drag a video file onto the window)
3. Click **Open path…** to load an existing `.bx` or `.bx2` file (optional)
4. Use the timeline and controls to place and edit markers
5. Click **Export .bx** or **Export .bx2** to save (format is chosen automatically — see below)

---

## Keyboard Shortcuts

| Key                       | Action                             |
| ------------------------- | ---------------------------------- |
| `Space`                   | Play / Pause                       |
| `M`                       | Add marker at current frame        |
| `Delete` / `Backspace`    | Delete selected markers or effect  |
| `←` / `→`                 | Step 1 frame                       |
| `Shift+←` / `Shift+→`     | Step 10 frames                     |
| `[`                       | Jump to previous marker            |
| `]`                       | Jump to next marker                |
| `R`                       | Toggle record mode                 |
| `Ctrl+A`                  | Select all markers                 |
| `Ctrl+Z`                  | Undo                               |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo                               |
| `Escape`                  | Exit record mode / clear selection |

---

## Timeline Controls

### Marker Timeline

- **Click** empty space → seek to that frame
- **Click** a marker → select it and seek to it
- **Drag** a marker → move it (snaps to playhead when within 10px)
- **Shift+Click** → range-select from last click
- **Ctrl+Click** → toggle individual markers
- **Scroll wheel** → scroll the timeline
- **Ctrl+Scroll** → zoom in/out
- Drag the resize handle above the timeline toolbar to change its height

### Effects Timeline

- **Double-click** empty row → open effect search popup
- **Drag** an effect block → move it (drag vertically to change layer)
- **Drag** an edge → resize the effect duration
- **Click** an effect → select it, opens properties in the right panel
- **Del** → delete selected effect

---

## Record Mode

Press `R` to enter record mode. The video auto-plays. While playing:

| Key | Depth stamped    |
| --- | ---------------- |
| `←` | 0.0 (no stroke)  |
| `↑` | 0.5 (half depth) |
| `→` | 1.0 (full depth) |

All markers are placed using the current default Transition and Ease settings. Press `R` or `Escape` to exit.

---

## Effects

The Effects timeline is hidden by default. Click **▸ EFFECTS** in the timeline toolbar to show it.

### Text Overlay

Displays fading text on the path preview canvas.

| Property           | Description                                                              |
| ------------------ | ------------------------------------------------------------------------ |
| Text               | Content (supports multiple lines)                                        |
| Font               | Choose from built-in fonts or upload a custom `.ttf`/`.otf`/`.woff` file |
| Size               | Font size in pixels (drag to scrub, double-click to type)                |
| Color              | Text colour                                                              |
| Opacity            | 0–1                                                                      |
| Position X / Y     | Percentage of canvas width / height                                      |
| Fade In / Fade Out | Duration in frames                                                       |

### Path Color

Smoothly transitions the path waveform and ball colour over a time range.

| Property           | Description                                    |
| ------------------ | ---------------------------------------------- |
| Path               | Target path colour                             |
| Ball               | Target ball colour                             |
| Fade In / Fade Out | Frames to blend from / to the original colours |

---

## Export Format

The export format is chosen automatically based on whether effects are present:

| Condition   | Format                                                           | Extension |
| ----------- | ---------------------------------------------------------------- | --------- |
| No effects  | `.bx` — original format, fully compatible with all BounceX tools | `.bx`     |
| Has effects | `.bx2` — extended format with effects data                       | `.bx2`    |

Both formats can always be re-imported with **Open path…**.

---

## File Format Reference

### `.bx` — Original BounceX Format

A plain JSON object. Keys are frame numbers (as strings); values are 4-element arrays.

```json
{
  "0": [0.0, 1, 2, 0],
  "120": [1.0, 1, 2, 0],
  "360": [0.0, 4, 1, 0]
}
```

#### Marker array: `[depth, trans, ease, aux]`

| Index | Field   | Type          | Description                                                                    |
| ----- | ------- | ------------- | ------------------------------------------------------------------------------ |
| 0     | `depth` | float 0.0–1.0 | Stroke depth. `0.0` = no stroke, `1.0` = maximum depth.                        |
| 1     | `trans` | int 0–11      | Godot 4 `TransitionType`. Easing curve shape between this marker and the next. |
| 2     | `ease`  | int 0–3       | Godot 4 `EaseType`. Direction of the transition.                               |
| 3     | `aux`   | float         | Reserved / unused. Always `0` in current tools.                                |

#### Transition types (`trans`)

| Value | Name    | Description                          |
| ----- | ------- | ------------------------------------ |
| 0     | Linear  | Constant rate of change              |
| 1     | Sine    | Sinusoidal curve                     |
| 2     | Quint   | 5th-power polynomial                 |
| 3     | Quart   | 4th-power polynomial                 |
| 4     | Quad    | Quadratic (2nd-power)                |
| 5     | Expo    | Exponential                          |
| 6     | Elastic | Overshooting spring with oscillation |
| 7     | Cubic   | 3rd-power polynomial                 |
| 8     | Circ    | Circular arc                         |
| 9     | Bounce  | Bouncing ball simulation             |
| 10    | Back    | Slight overshoot and return          |
| 11    | Spring  | Damped spring                        |

#### Ease types (`ease`)

| Value | Name   | Description                     |
| ----- | ------ | ------------------------------- |
| 0     | In     | Slow start, fast end            |
| 1     | Out    | Fast start, slow end            |
| 2     | In-Out | Slow start and end, fast middle |
| 3     | Out-In | Fast start and end, slow middle |

#### Interpolation

Between adjacent markers A (at frame `fA`) and B (at frame `fB`), depth at frame `f` is:

```
t      = (f - fA) / (fB - fA)
depth  = A.depth + (B.depth - A.depth) * godotEase(t, B.trans, B.ease)
```

The easing parameters come from **marker B** (the destination). After the final marker, depth is held constant at its value.

---

### `.bx2` — Extended BounceX Format

A versioned JSON object with a `version` field, the same `markers` structure as `.bx`, and an `effects` array.

```json
{
  "version": 2,
  "markers": {
    "0": [0.0, 1, 2, 0],
    "120": [1.0, 1, 2, 0]
  },
  "effects": [
    {
      "id": "e1",
      "type": "text",
      "layer": 0,
      "startFrame": 60,
      "endFrame": 300,
      "fadeIn": 30,
      "fadeOut": 30,
      "text": "Hello World",
      "font": "Rajdhani",
      "fontSize": 52,
      "color": "#ffffff",
      "opacity": 1.0,
      "posX": 50,
      "posY": 80
    },
    {
      "id": "e2",
      "type": "pathColor",
      "layer": 0,
      "startFrame": 120,
      "endFrame": 240,
      "fadeIn": 60,
      "fadeOut": 60,
      "pathColor": "#e05050",
      "ballColor": "#ffffff"
    }
  ]
}
```

#### Top-level fields

| Field     | Type   | Description                                          |
| --------- | ------ | ---------------------------------------------------- |
| `version` | int    | Always `2` for `.bx2`.                               |
| `markers` | object | Same structure as `.bx`.                             |
| `effects` | array  | Zero or more effect objects. May be absent or empty. |

#### Common effect fields (all effect types)

| Field        | Type   | Description                                                                   |
| ------------ | ------ | ----------------------------------------------------------------------------- |
| `id`         | string | Unique identifier within the file (e.g. `"e1"`).                              |
| `type`       | string | Effect type: `"text"` or `"pathColor"`.                                       |
| `layer`      | int    | Track layer (0 = bottom). Effects on the same layer must not overlap in time. |
| `startFrame` | int    | First frame the effect is active (inclusive).                                 |
| `endFrame`   | int    | Last frame the effect is active (inclusive).                                  |
| `fadeIn`     | int    | Frames to ramp from 0 → full intensity at the start.                          |
| `fadeOut`    | int    | Frames to ramp from full intensity → 0 at the end.                            |

#### Fade alpha formula

```
duration = endFrame - startFrame
elapsed  = frame - startFrame
alpha    = 1.0
if fadeIn  > 0 and elapsed < fadeIn:
    alpha = min(alpha, elapsed / fadeIn)
if fadeOut > 0 and elapsed > (duration - fadeOut):
    alpha = min(alpha, (duration - elapsed) / fadeOut)
alpha = clamp(alpha, 0.0, 1.0)
```

#### `type: "text"` — additional fields

| Field      | Type   | Description                                                                 |
| ---------- | ------ | --------------------------------------------------------------------------- |
| `text`     | string | Display text. `\n` produces a line break.                                   |
| `font`     | string | CSS font-family name.                                                       |
| `fontSize` | int    | Font size in pixels.                                                        |
| `color`    | string | CSS hex colour (e.g. `"#ffffff"`).                                          |
| `opacity`  | float  | Base opacity 0–1, multiplied by fade alpha for final opacity.               |
| `posX`     | float  | Horizontal position as % of canvas width (0 = left edge, 100 = right edge). |
| `posY`     | float  | Vertical position as % of canvas height (0 = top, 100 = bottom).            |

#### `type: "pathColor"` — additional fields

| Field       | Type   | Description                            |
| ----------- | ------ | -------------------------------------- |
| `pathColor` | string | Target path waveform colour (CSS hex). |
| `ballColor` | string | Target ball colour (CSS hex).          |

Colour is blended using linear RGB interpolation:

```
effective_channel = default_channel + (target_channel - default_channel) * alpha
```

Where `alpha` is computed from the fade formula above.

---

## Configuration

To adjust default layout sizes, edit the constants near the top of `editor.js`:

```js
const TL_H_DEFAULT = 220 // marker timeline default height (px)
const PROPS_W_DEFAULT = 272 // right panel default width (px)
```

Layout is also saved automatically to `localStorage` so your last-used sizes are restored on next open.

---

## Browser Requirements

- Chrome 86+ or Edge 86+ recommended (`showSaveFilePicker` gives a native OS save dialog)
- Firefox works but uses a fallback download link instead
- Open via a local web server or directly as `file://`
- No backend, no install — just three static files (`editor.html`, `editor.css`, `editor.js`)
