# BounceX Editor

A standalone path editor for [BounceX-Viewer](https://github.com/Alunacoz/BounceX-Viewer). Sync video playback with marker placement and export `.bx` path files. This tool and summary (right now) have been written with generative AI so it may not be perfectly accurate. This is currently in a PROTOTYPE stage. It is NOT recommended to actually attempt to use this now, but I figured that it might as well be public if anyone wants to use it right away despite the drawbacks.

---

## Getting Started

1. Run `./StartWebsite.sh` and open the link in any browser.
2. Click **Load Video** (or drag a video file onto the window)
3. Click **Open path…** to load an existing `.bx` file (optional — supports both plain `.bx` and versioned `.bx` with effects)
4. Use the timeline and controls to place and edit markers
5. Click **Export .bx** to save

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `M` | Add marker at current frame |
| `Delete` / `Backspace` | Delete selected markers or selected effect |
| `←` | Step 1 frame back (or set selected marker depth to 0.0) |
| `→` | Step 1 frame forward (or set selected marker depth to 1.0) |
| `↑` | Set selected marker depth to 0.5 |
| `Shift+←` / `Shift+→` | Step 10 frames |
| `[` | Jump to previous marker |
| `]` | Jump to next marker |
| `R` | Toggle record mode (only active when video is playing) |
| `Ctrl+A` | Select all markers |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+C` | Copy selected markers or selected effect |
| `Ctrl+X` | Cut selected markers or selected effect |
| `Ctrl+V` | Paste at playhead position |
| `Escape` | Exit record mode / clear selection |

---

## Timeline Controls

### Marker Timeline

- **Click** empty space → seek to that frame and clear selection
- **Click** a marker → select it; seek to it on release (not during drag)
- **Drag** a selected marker left/right → move it; snaps to playhead within 10px — the playhead does **not** move while dragging so you can pre-position it as a snap target
- **Shift+Click** → range-select from last click
- **Ctrl+Click** → toggle individual markers
- **Scroll wheel** → scroll
- **Ctrl+Scroll** → zoom in/out
- Drag the **resize handle** above the toolbar to change timeline height

Marker diamonds are drawn at their depth position on the waveform (depth 0 = top, depth 1 = bottom), white with an accent or teal outline when selected or nearest.

### Effects Timeline

- **Double-click** empty row → open effect type picker
- **Drag** an effect block → move it; drag vertically to change layer
- **Drag** left/right edge → resize duration
- **Click** → select it and open its properties in the right panel
- **Del** → delete selected effect

---

## Record Mode

Press `R` to enter record mode (only available while the video is playing — the button is disabled when paused). The video auto-plays on entry. While playing:

| Key | Depth stamped |
|-----|---------------|
| `←` | 0.0 (no stroke) |
| `↑` | 0.5 (half depth) |
| `→` | 1.0 (full depth) |

Record mode exits automatically if the video pauses or ends. Press `R` or `Escape` to exit manually.

---

## Effects

The Effects timeline is hidden by default. Click **▸ EFFECTS** in the timeline toolbar to reveal it. Effects are stored in the exported `.bx` file and rendered by BounceX-Viewer at playback time.

When you create a new effect, the editor remembers your last-used settings for that effect type and pre-fills them.

### Text Overlay

Displays fading text on the path preview canvas. Position and size are expressed as a percentage of the **path area height**, so the text scales consistently regardless of canvas size, viewer mode (normal, overlay, theater, fullscreen), or zoom level.

| Property | Description |
|----------|-------------|
| Text | Content; `\n` for line breaks |
| Font | Built-in list or upload a custom `.ttf`/`.otf`/`.woff` |
| Size | % of path area height (default 50%) |
| Color | Text colour |
| Opacity | 0–1, multiplied with fade alpha |
| Position X / Y | % of path area width / height (0,0 = top-left of path area) |
| Fade In / Fade Out | Duration in frames |

### Path Color

Smoothly transitions the path waveform colour and ball colour using linear RGB interpolation blended by the fade alpha.

| Property | Description |
|----------|-------------|
| Path | Target waveform colour |
| Ball | Target ball colour |
| Fade In / Fade Out | Frames to blend in / out |

### Path Speed

Changes how fast the path waveform scrolls horizontally. Affects both the editor preview and the viewer. The transition is smooth — the waveform stretches frame-by-frame using per-frame speed integration, so only the zone inside the effect gets stretched. Frames outside the effect remain at normal spacing.

| Property | Description |
|----------|-------------|
| Speed | Target playback speed: 0.5×, 0.75×, 1×, 1.25×, 1.5×, 1.75×, 2×, 2.5×, 3×, 3.5×, 4× |
| Fade In / Fade Out | Frames over which speed ramps up / down (smoothed via lerp) |

---

## Export Format

All files are exported as `.bx`. The internal structure depends on whether effects are present:

| Condition | Internal structure |
|-----------|--------------------|
| No effects | Plain `{"frame": [depth, trans, ease, aux], ...}` — identical to original `.bx`, fully compatible with all BounceX tools |
| Has effects | `{"version": 2, "markers": {...}, "effects": [...]}` — versioned structure inside a `.bx` file |

**Open path…** accepts both structures automatically. `.bx2` files (an older extension) are also accepted.

---

## Copy / Paste

`Ctrl+C` copies the current selection — either selected markers or the selected effect. `Ctrl+V` pastes at the current playhead:

- **Markers** — pasted with an offset so the first copied marker lands at the playhead. Frames already occupied by an existing marker are skipped.
- **Effects** — pasted starting at the playhead with the same duration, auto-assigned to an available layer.

`Ctrl+X` copies and immediately deletes. A brief flash message in the toolbar confirms each operation.

---

## Undo / Redo

Every mutation is undoable: adding/deleting/moving markers, changing depth/transition/ease, adding/deleting effects. The history stack holds up to 100 snapshots. Use `Ctrl+Z` / `Ctrl+Y` or the toolbar buttons.

---

## Layout Persistence

Panel widths, timeline heights, and effects panel visibility are saved to `localStorage` and restored on next open. To change the default sizes for a fresh session, edit the constants near the top of `editor.js`:

```js
const TL_H_DEFAULT    = 220   // marker timeline default height (px)
const PROPS_W_DEFAULT = 272   // right panel default width (px)
```

Both panels are also user-resizable by dragging their edges.

---

## File Format Reference

### `.bx` — Original BounceX Format

A plain JSON object. Keys are frame numbers (as strings); values are 4-element arrays.

```json
{
  "0":   [0.0, 1, 2, 0],
  "120": [1.0, 1, 2, 0],
  "360": [0.0, 4, 1, 0]
}
```

#### Marker array: `[depth, trans, ease, aux]`

| Index | Field | Type | Description |
|-------|-------|------|-------------|
| 0 | `depth` | float 0.0–1.0 | Stroke depth. `0.0` = no stroke, `1.0` = maximum depth. |
| 1 | `trans` | int 0–11 | Godot 4 `TransitionType`. Easing curve shape from this marker to the next. |
| 2 | `ease` | int 0–3 | Godot 4 `EaseType`. Direction of the transition. |
| 3 | `aux` | float | Reserved / unused. Always `0`. |

#### Transition types (`trans`)

| Value | Name | Description |
|-------|------|-------------|
| 0 | Linear | Constant rate |
| 1 | Sine | Sinusoidal |
| 2 | Quint | 5th-power polynomial |
| 3 | Quart | 4th-power polynomial |
| 4 | Quad | Quadratic |
| 5 | Expo | Exponential |
| 6 | Elastic | Overshooting spring with oscillation |
| 7 | Cubic | 3rd-power polynomial |
| 8 | Circ | Circular arc |
| 9 | Bounce | Bouncing ball simulation |
| 10 | Back | Slight overshoot and return |
| 11 | Spring | Damped spring |

#### Ease types (`ease`)

| Value | Name | Description |
|-------|------|-------------|
| 0 | In | Slow start, fast end |
| 1 | Out | Fast start, slow end |
| 2 | In-Out | Slow start and end, fast middle |
| 3 | Out-In | Fast start and end, slow middle |

#### Interpolation

Between adjacent markers A (frame `fA`) and B (frame `fB`):

```
t     = (f - fA) / (fB - fA)
depth = A.depth + (B.depth - A.depth) * godotEase(t, B.trans, B.ease)
```

Easing parameters come from **marker B** (the destination). After the final marker, depth holds at that value.

---

### Versioned structure (effects embedded in `.bx`)

When effects are present the file uses a versioned wrapper. The extension is still `.bx`.

```json
{
  "version": 2,
  "markers": {
    "0":   [0.0, 1, 2, 0],
    "120": [1.0, 1, 2, 0]
  },
  "effects": [
    {
      "id":         "e1",
      "type":       "text",
      "layer":      0,
      "startFrame": 60,
      "endFrame":   300,
      "fadeIn":     30,
      "fadeOut":    30,
      "text":       "Hello World",
      "font":       "Rajdhani",
      "fontSize":   50,
      "color":      "#ffffff",
      "opacity":    1.0,
      "posX":       50,
      "posY":       50
    },
    {
      "id":         "e2",
      "type":       "pathColor",
      "layer":      1,
      "startFrame": 120,
      "endFrame":   240,
      "fadeIn":     60,
      "fadeOut":    60,
      "pathColor":  "#e05050",
      "ballColor":  "#1a5fb4"
    },
    {
      "id":         "e3",
      "type":       "pathSpeed",
      "layer":      2,
      "startFrame": 300,
      "endFrame":   600,
      "fadeIn":     60,
      "fadeOut":    60,
      "speed":      2.0
    }
  ]
}
```

#### Parsing `.bx` files

```js
const parsed     = JSON.parse(fileContents)
const isBx2      = parsed.version === 2
const markerData = isBx2 ? parsed.markers : parsed
const effects    = isBx2 && Array.isArray(parsed.effects) ? parsed.effects : []
```

If you only care about markers, just use `markerData` and ignore `effects`.

#### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | int | Always `2` when effects are present. Absent in plain `.bx`. |
| `markers` | object | Same structure as plain `.bx`. |
| `effects` | array | Zero or more effect objects. |

#### Common effect fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier within the file. |
| `type` | string | `"text"`, `"pathColor"`, or `"pathSpeed"`. |
| `layer` | int | Track layer (0 = bottom). Effects on the same layer must not overlap. |
| `startFrame` | int | First frame the effect is active (inclusive). |
| `endFrame` | int | Last frame the effect is active (inclusive). |
| `fadeIn` | int | Frames to ramp from 0 → full intensity. |
| `fadeOut` | int | Frames to ramp from full intensity → 0. |

#### Fade alpha formula

```
duration = endFrame - startFrame
elapsed  = frame - startFrame          // may be fractional for sub-frame accuracy
alpha    = 1.0
if fadeIn  > 0 and elapsed < fadeIn:
    alpha = min(alpha, elapsed / fadeIn)
if fadeOut > 0 and elapsed > (duration - fadeOut):
    alpha = min(alpha, (duration - elapsed) / fadeOut)
alpha = clamp(alpha, 0.0, 1.0)
```

#### `type: "text"` fields

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | Display text. `\n` = line break. |
| `font` | string | CSS font-family name. |
| `fontSize` | float | Font size as **% of path area height** (default 50). |
| `color` | string | CSS hex colour. |
| `opacity` | float | Base opacity 0–1, multiplied by fade alpha. |
| `posX` | float | Horizontal position as % of path area width. |
| `posY` | float | Vertical position as % of path area height (0 = top, 100 = bottom). |

#### `type: "pathColor"` fields

| Field | Type | Description |
|-------|------|-------------|
| `pathColor` | string | Target waveform colour (CSS hex). |
| `ballColor` | string | Target ball colour (CSS hex). |

Linear RGB interpolation: `effective = lerp(defaultColor, targetColor, alpha)`

#### `type: "pathSpeed"` fields

| Field | Type | Description |
|-------|------|-------------|
| `speed` | float | Target speed multiplier. Range 0.5–4.0 in 0.25 increments. |

The effective speed at any frame is `lerp(1.0, speed, alpha)`. The waveform x-positions are computed by integrating per-frame speed outward from the playhead, so only frames inside the effect zone are stretched — frames outside remain at their normal spacing.

---

## Browser Requirements

- Chrome 86+ or Edge 86+ recommended (`showSaveFilePicker` gives a native OS save dialog)
- Firefox works but uses a fallback `<a download>` link instead
- Open via a local web server or directly as `file://`
- No backend, no install — three static files: `editor.html`, `editor.css`, `editor.js`
