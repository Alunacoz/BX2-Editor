/**
 * BounceX Editor — editor.js
 *
 * Standalone .bx / .bx2 path editor with video sync.
 * No external dependencies. Vanilla JS.
 *
 * Vendored math from BounceX-Viewer / player-core.js:
 *   godotEase(), buildPath()
 */

'use strict'

// ── Constants ─────────────────────────────────────────────────────────────────

const FPS = 60

const TRANS_NAMES = [
  'Linear',
  'Sine',
  'Quint',
  'Quart',
  'Quad',
  'Expo',
  'Elastic',
  'Cubic',
  'Circ',
  'Bounce',
  'Back',
  'Spring',
]
const EASE_NAMES = ['In', 'Out', 'In-Out', 'Out-In']
const EASE_LABELS = ['In', 'Out', 'IO', 'OI']

// ── Godot 4 Easing (vendored from player-core.js) ────────────────────────────

function godotEase(t, trans, ease) {
  const applyTrans = (x, type) => {
    switch (type) {
      case 0:
        return x
      case 1:
        return 1 - Math.cos((x * Math.PI) / 2)
      case 2:
        return x * x * x * x * x
      case 3:
        return x * x * x * x
      case 4:
        return x * x
      case 5:
        return x === 0 ? 0 : Math.pow(2, 10 * x - 10)
      case 6: {
        if (x === 0) return 0
        if (x === 1) return 1
        return (
          -Math.pow(2, 10 * x - 10) *
          Math.sin(((x * 10 - 10.75) * (2 * Math.PI)) / 3)
        )
      }
      case 7:
        return x * x * x
      case 8:
        return 1 - Math.sqrt(1 - x * x)
      case 9: {
        const n1 = 7.5625,
          d1 = 2.75
        let xi = 1 - x
        if (xi < 1 / d1) return 1 - n1 * xi * xi
        else if (xi < 2 / d1) return 1 - (n1 * (xi -= 1.5 / d1) * xi + 0.75)
        else if (xi < 2.5 / d1)
          return 1 - (n1 * (xi -= 2.25 / d1) * xi + 0.9375)
        else return 1 - (n1 * (xi -= 2.625 / d1) * xi + 0.984375)
      }
      case 10: {
        const c1 = 1.70158,
          c3 = c1 + 1
        return c3 * x * x * x - c1 * x * x
      }
      case 11:
        return 1 - Math.cos(x * Math.PI) * Math.exp(-x * 5)
      default:
        return x
    }
  }
  switch (ease) {
    case 0:
      return applyTrans(t, trans)
    case 1:
      return 1 - applyTrans(1 - t, trans)
    case 2:
      return t < 0.5
        ? applyTrans(t * 2, trans) / 2
        : 1 - applyTrans((1 - t) * 2, trans) / 2
    case 3:
      return t < 0.5
        ? (1 - applyTrans(1 - t * 2, trans)) / 2
        : 0.5 + applyTrans(t * 2 - 1, trans) / 2
    default:
      return t
  }
}

function buildPath(markerData, totalFrames) {
  const path = new Float32Array(totalFrames).fill(-1)
  const markers = Object.entries(markerData)
    .map(([k, v]) => ({
      frame: parseInt(k),
      depth: v[0],
      trans: v[1],
      ease: v[2],
    }))
    .sort((a, b) => a.frame - b.frame)
  if (markers.length === 0) return path
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i]
    const next = markers[i + 1]
    path[cur.frame] = cur.depth
    if (!next) {
      for (let f = cur.frame + 1; f < totalFrames; f++) path[f] = cur.depth
      break
    }
    const steps = next.frame - cur.frame
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      path[cur.frame + s] =
        cur.depth +
        (next.depth - cur.depth) * godotEase(t, next.trans, next.ease)
    }
  }
  return path
}

function easeLabel(trans, ease) {
  return `${TRANS_NAMES[trans] ?? '?'}·${EASE_LABELS[ease] ?? '?'}`
}

function framesToTimecode(frames) {
  const totalSecs = frames / FPS
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = Math.floor(totalSecs % 60)
  const f = Math.floor(frames % FPS)
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`
}

function pad(n) {
  return String(n).padStart(2, '0')
}

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  hasVideo: false,
  duration: 0,
  totalFrames: 0,
  markers: [], // [{frame, depth, trans, ease}], always sorted by frame
  selection: new Set(), // indices into state.markers
  lastClickedIdx: null,
  nearestMarkerIdx: -1,
  path: null,
  timelineZoom: 1.0,
  timelineScrollX: 0,

  // Record mode
  recordMode: false,

  // Default settings for new markers
  defaultDepth: 0.0,
  defaultTrans: 1,
  defaultEase: 2,

  // Effects
  effects: [],
  selectedEffectId: null,
  fxVisible: false,

  // Path metadata (embedded in exported .bx)
  meta: {
    title: '',
    path_creator: '',
    bpm: '',
    related_media: '',
    video_url: '',
  },

  // Custom uploaded fonts: [{name, family}]
  customFonts: [],
}

let _effectIdCounter = 0
function newEffectId() {
  return 'e' + ++_effectIdCounter
}

// Handle to the currently-open .bx file (FileSystemFileHandle, or null).
// Set when the user opens a file via showOpenFilePicker; used to write back
// immediately when metadata is saved without showing a save-as dialog.
let _openFileHandle = null
let _openFileName   = null   // remembered for fallback download in Firefox

// Persistent last-used settings per effect type (saved to localStorage)
const _lastEffectSettings = {}
function saveLastEffectSettings(type, props) {
  // Only save the type-specific display properties — never structural fields
  // (id, layer, startFrame, endFrame) which must stay unique per effect instance.
  const EXCLUDE = new Set(['id', 'type', 'layer', 'startFrame', 'endFrame'])
  const filtered = Object.fromEntries(
    Object.entries(props).filter(([k]) => !EXCLUDE.has(k)),
  )
  _lastEffectSettings[type] = filtered
  try {
    localStorage.setItem('bxed_fx_last_' + type, JSON.stringify(filtered))
  } catch (_) {}
}
function loadLastEffectSettings(type) {
  const EXCLUDE = new Set(['id', 'type', 'layer', 'startFrame', 'endFrame'])
  const strip = (obj) =>
    obj
      ? Object.fromEntries(Object.entries(obj).filter(([k]) => !EXCLUDE.has(k)))
      : null
  if (_lastEffectSettings[type]) return strip(_lastEffectSettings[type])
  try {
    const raw = localStorage.getItem('bxed_fx_last_' + type)
    if (raw) {
      const parsed = JSON.parse(raw)
      const clean = strip(parsed)
      _lastEffectSettings[type] = clean
      return clean
    }
  } catch (_) {}
  return null
}

// ── Layout constants ──────────────────────────────────────────────────────────
// Change these to adjust the default sizes. The panel is also user-resizable.
const TL_H_DEFAULT = 220 // marker timeline default height (px)
const TL_H_MIN = 80
const TL_H_MAX = 500
const PROPS_W_DEFAULT = 272 // right panel default width (px); valid range 200–600

// ── Undo / Redo ───────────────────────────────────────────────────────────────

const MAX_HISTORY = 100
let _history = [] // array of serialised snapshots
let _histIdx = -1 // pointer into _history
let _undoBtn, _redoBtn

function _snapshot() {
  // Serialise only the parts that are undoable: markers + effects
  return JSON.stringify({
    markers: state.markers.map((m) => ({ ...m })),
    effects: state.effects.map((e) => ({ ...e })),
  })
}

/** Call before every mutation that should be undoable. */
function pushHistory() {
  // Truncate any forward history
  _history = _history.slice(0, _histIdx + 1)
  _history.push(_snapshot())
  if (_history.length > MAX_HISTORY) _history.shift()
  _histIdx = _history.length - 1
  _updateUndoUI()
}

function _restoreSnapshot(snap) {
  const s = JSON.parse(snap)
  state.markers = s.markers
  state.effects = s.effects
  state.selection.clear()
  state.lastClickedIdx = null
  state.selectedEffectId = null
  rebuildPath()
  renderMarkerList()
  renderMarkerProps()
  renderEffectProps()
  updateMarkerCount()
  updateExportLabel()
}

function undo() {
  if (_histIdx <= 0) return
  _histIdx--
  _restoreSnapshot(_history[_histIdx])
  _updateUndoUI()
}

function redo() {
  if (_histIdx >= _history.length - 1) return
  _histIdx++
  _restoreSnapshot(_history[_histIdx])
  _updateUndoUI()
}

function _updateUndoUI() {
  if (_undoBtn) _undoBtn.disabled = _histIdx <= 0
  if (_redoBtn) _redoBtn.disabled = _histIdx >= _history.length - 1
}

// ── localStorage persistence ──────────────────────────────────────────────────

const LS_KEYS = {
  propsW: 'bxed_props_w',
  tlH: 'bxed_tl_h',
  fxH: 'bxed_fx_h',
  fxVisible: 'bxed_fx_visible',
}

function saveLayout() {
  try {
    const panel = document.getElementById('propsPanel')
    const tl = document.getElementById('timelineSection')
    const fx = document.getElementById('fxSection')
    if (panel) localStorage.setItem(LS_KEYS.propsW, panel.offsetWidth)
    if (tl) localStorage.setItem(LS_KEYS.tlH, tl.offsetHeight)
    if (fx && state.fxVisible)
      localStorage.setItem(LS_KEYS.fxH, fx.offsetHeight)
    localStorage.setItem(LS_KEYS.fxVisible, state.fxVisible ? '1' : '0')
  } catch (_) {}
}

function loadLayout() {
  try {
    return {
      propsW: parseInt(localStorage.getItem(LS_KEYS.propsW)) || PROPS_W_DEFAULT,
      tlH: parseInt(localStorage.getItem(LS_KEYS.tlH)) || TL_H_DEFAULT,
      fxH:
        parseInt(localStorage.getItem(LS_KEYS.fxH)) ||
        Math.round(TL_H_DEFAULT / 2),
      fxVisible: localStorage.getItem(LS_KEYS.fxVisible) === '1',
    }
  } catch (_) {
    return {
      propsW: PROPS_W_DEFAULT,
      tlH: TL_H_DEFAULT,
      fxH: Math.round(TL_H_DEFAULT / 2),
      fxVisible: false,
    }
  }
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
let video
let previewCanvas, previewCtx
let timelineCanvas, timelineCtx
let fxCanvas, fxCtx

// Timeline mouse tracking
const tlMouse = {
  down: false,
  draggingPlayhead: false,
  draggingMarkerIdx: -1,
  dragStartX: 0,
  dragStartFrame: 0,
  dragMoved: false,
  origFrames: new Map(),  // index → original frame for all selected markers
}

// Effects timeline drag state
const fxDrag = {
  active: false,
  seekingPlayhead: false,
  effectId: null,
  mode: null,
  startX: 0,
  origStart: 0,
  origEnd: 0,
  passedNeighbours: new Map(), // id → 'right' | 'left' (direction we passed through)
}

// Effects timeline hover
let fxHoverEffectId = null
let fxHoverZone = null // 'body' | 'start' | 'end'

// Timeline resize tracking
const tlResize = { active: false, startY: 0, startH: 0 }

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  video = document.getElementById('mainVideo')
  previewCanvas = document.getElementById('previewCanvas')
  previewCtx = previewCanvas.getContext('2d')
  timelineCanvas = document.getElementById('timelineCanvas')
  timelineCtx = timelineCanvas.getContext('2d')

  fxCanvas = document.getElementById('fxCanvas')
  fxCtx = fxCanvas.getContext('2d')

  // Undo / redo
  _undoBtn = document.getElementById('btnUndo')
  _redoBtn = document.getElementById('btnRedo')
  _undoBtn.addEventListener('click', undo)
  _redoBtn.addEventListener('click', redo)
  _updateUndoUI()
  pushHistory() // capture the initial empty state so Ctrl+Z can't go below it

  // File buttons
  document
    .getElementById('btnLoadVideo')
    .addEventListener('click', () =>
      document.getElementById('fileInputVideo').click(),
    )
  document.getElementById('btnLoadBx').addEventListener('click', async () => {
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [
            {
              description: 'BounceX Path File',
              accept: { 'application/json': ['.bx', '.bx2', '.json'] },
            },
          ],
          multiple: false,
        })
        _openFileHandle = handle
        const file = await handle.getFile()
        _openFileName = file.name
        importBx(file)
      } catch (err) {
        if (err.name !== 'AbortError') throw err
      }
    } else {
      document.getElementById('fileInputBx').click()
    }
  })

  document.getElementById('fileInputVideo').addEventListener('change', (e) => {
    const f = e.target.files[0]
    if (f) loadVideo(f)
    e.target.value = ''
  })
  document.getElementById('fileInputBx').addEventListener('change', (e) => {
    const f = e.target.files[0]
    if (f) {
      _openFileHandle = null
      importBx(f)
    }
    e.target.value = ''
  })
  document.getElementById('btnExport').addEventListener('click', exportBx2)
  document
    .getElementById('btnRecord')
    .addEventListener('click', toggleRecordMode)
  document
    .getElementById('btnToggleFx')
    .addEventListener('click', toggleFxPanel)

  // Transport
  document.getElementById('btnPlay').addEventListener('click', togglePlay)
  document.getElementById('btnRewind').addEventListener('click', () => {
    if (state.hasVideo) video.currentTime = 0
  })

  // Zoom
  document
    .getElementById('btnZoomIn')
    .addEventListener('click', () => adjustZoom(1.5))
  document
    .getElementById('btnZoomOut')
    .addEventListener('click', () => adjustZoom(1 / 1.5))
  document.getElementById('btnZoomFit').addEventListener('click', fitZoom)

  // Video events
  video.addEventListener('loadedmetadata', onVideoMetadata)
  video.addEventListener('play', () => {
    updatePlayBtn()
    updateRecordBtn()
  })
  video.addEventListener('pause', () => {
    updatePlayBtn()
    updateRecordBtn()
  })
  video.addEventListener('ended', () => {
    updatePlayBtn()
    updateRecordBtn()
  })

  // Timeline mouse
  timelineCanvas.addEventListener('mousedown', onTlMouseDown)
  timelineCanvas.addEventListener('mousemove', onTlMouseMove)
  timelineCanvas.addEventListener('mouseleave', onTlMouseLeave)
  document.addEventListener('mouseup', onTlMouseUp)
  timelineCanvas.addEventListener('wheel', onTlWheel, { passive: false })

  // Props form — event delegation on slider/input pairing
  document.getElementById('propFrame').addEventListener('change', function () {
    onPropFrameChange(this)
  })
  document
    .getElementById('propDepthSlider')
    .addEventListener('input', function () {
      onPropDepthInput(parseFloat(this.value), 'slider')
    })
  document.getElementById('propDepth').addEventListener('change', function () {
    commitDepthText(this.value)
  })
  document
    .getElementById('propDepth')
    .addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault()
        commitDepthText(this.value)
        this.blur()
      }
    })
  document.getElementById('propTrans').addEventListener('change', function () {
    onPropTransChange(parseInt(this.value))
  })
  document.getElementById('propEase').addEventListener('change', function () {
    onPropEaseChange(parseInt(this.value))
  })
  document
    .getElementById('btnDeleteSelected')
    .addEventListener('click', deleteSelected)
  document
    .getElementById('btnAddMarker')
    .addEventListener('click', () => addMarkerAt(currentFrame()))

  // Frame input: scroll to increment/decrement
  document.getElementById('propFrame').addEventListener(
    'wheel',
    function (e) {
      if (state.selection.size === 0) return
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const delta = e.deltaY < 0 ? step : -step
      onPropFrameScroll(delta)
    },
    { passive: false },
  )

  // Volume control
  const volumeSlider = document.getElementById('volumeSlider')
  const btnMute = document.getElementById('btnMute')
  volumeSlider.addEventListener('input', () => {
    video.volume = parseFloat(volumeSlider.value)
    video.muted = video.volume === 0
    updateVolIcon()
  })
  btnMute.addEventListener('click', () => {
    video.muted = !video.muted
    volumeSlider.value = video.muted ? 0 : video.volume
    updateVolIcon()
  })

  // Timeline resizer
  const resizer = document.getElementById('timelineResizer')
  resizer.addEventListener('mousedown', (e) => {
    tlResize.active = true
    tlResize.startY = e.clientY
    tlResize.startH = document.getElementById('timelineSection').offsetHeight
    resizer.classList.add('dragging')
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  })
  document.addEventListener('mousemove', (e) => {
    if (!tlResize.active) return
    const delta = tlResize.startY - e.clientY // drag up = bigger
    const newH = Math.min(TL_H_MAX, Math.max(TL_H_MIN, tlResize.startH + delta))
    setTimelineHeight(newH)
  })
  document.addEventListener('mouseup', () => {
    if (!tlResize.active) return
    tlResize.active = false
    resizer.classList.remove('dragging')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    saveLayout()
  })

  // Set default timeline height
  const savedLayout = loadLayout()
  setTimelineHeight(savedLayout.tlH)

  // Restore fx panel if it was open
  if (savedLayout.fxVisible) {
    const fxSection = document.getElementById('fxSection')
    const fxHandle = document.getElementById('fxResizeHandle')
    const fxBtn = document.getElementById('btnToggleFx')
    state.fxVisible = true
    fxSection.style.display = 'flex'
    fxSection.style.height = savedLayout.fxH + 'px'
    fxSection.dataset.hset = '1'
    fxHandle.style.display = ''
    fxBtn.classList.add('active')
    fxBtn.textContent = '▾ EFFECTS'
    resizeFxCanvas()
  }

  // Set default props panel width and wire its resize handle
  const propsPanel = document.getElementById('propsPanel')
  propsPanel.style.width = savedLayout.propsW + 'px'
  const propsResize = { active: false, startX: 0, startW: 0 }
  const propsHandle = document.getElementById('propsResizeHandle')
  propsHandle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    propsResize.active = true
    propsResize.startX = e.clientX
    propsResize.startW = propsPanel.offsetWidth
    propsHandle.classList.add('dragging')
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  })
  document.addEventListener('mousemove', (e) => {
    if (!propsResize.active) return
    const delta = propsResize.startX - e.clientX // drag left = wider
    const newW = Math.min(600, Math.max(200, propsResize.startW + delta))
    propsPanel.style.width = newW + 'px'
  })
  document.addEventListener('mouseup', () => {
    if (!propsResize.active) return
    propsResize.active = false
    propsHandle.classList.remove('dragging')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    saveLayout()
  })

  // Metadata modal
  document.getElementById('btnEditMeta').addEventListener('click', openMetaModal)
  document.getElementById('btnClean').addEventListener('click', cleanMarkers)
  document.getElementById('metaClose').addEventListener('click', closeMetaModal)
  document
    .getElementById('metaCancel')
    .addEventListener('click', closeMetaModal)
  document.getElementById('metaSave').addEventListener('click', saveMetaModal)
  document.getElementById('metaOverlay').addEventListener('mousedown', (e) => {
    if (e.target === document.getElementById('metaOverlay')) closeMetaModal()
  })
  document.getElementById('metaModal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMetaModal()
      e.stopPropagation()
    }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault()
      saveMetaModal()
    }
  })

  // Generate Cycle (BPM)
  document
    .getElementById('btnGenerateCycle')
    .addEventListener('click', openCycleDialog)
  document
    .getElementById('bpmCreate')
    .addEventListener('click', executeCycleGenerate)
  document
    .getElementById('bpmCancel')
    .addEventListener('click', closeCycleDialog)
  document.getElementById('bpmOverlay').addEventListener('mousedown', (e) => {
    if (e.target === document.getElementById('bpmOverlay')) closeCycleDialog()
  })
  document
    .getElementById('bpmInput')
    .addEventListener('input', updateCyclePreview)
  document
    .getElementById('bpmCountInput')
    .addEventListener('input', updateCyclePreview)
  document.getElementById('bpmHalve').addEventListener('click', () => {
    const el = document.getElementById('bpmInput')
    el.value = Math.max(1, parseFloat(el.value || 120) / 2)
    updateCyclePreview()
  })
  document.getElementById('bpmDouble').addEventListener('click', () => {
    const el = document.getElementById('bpmInput')
    el.value = Math.min(999, parseFloat(el.value || 120) * 2)
    updateCyclePreview()
  })
  document.getElementById('bpmOverlay').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCycleDialog()
      e.stopPropagation()
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      executeCycleGenerate()
    }
  })

  // Effects timeline canvas events
  fxCanvas.addEventListener('mousedown', onFxMouseDown)
  fxCanvas.addEventListener('mousemove', onFxMouseMove)
  fxCanvas.addEventListener('mouseleave', onFxMouseLeave)
  fxCanvas.addEventListener('dblclick', onFxDblClick)
  fxCanvas.addEventListener('wheel', onTlWheel, { passive: false })

  // Effects resizer — dedicated handle above the fx section
  const fxResizerEl = document.getElementById('fxResizeHandle')
  const fxResize = { active: false, startY: 0, startH: 0 }
  fxResizerEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    fxResize.active = true
    fxResize.startY = e.clientY
    fxResize.startH = document.getElementById('fxSection').offsetHeight
    fxResizerEl.classList.add('dragging')
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  })
  document.addEventListener('mousemove', (e) => {
    if (!fxResize.active) return
    const delta = fxResize.startY - e.clientY // drag up = taller
    const newH = Math.min(
      Math.round(window.innerHeight * 0.5),
      Math.max(60, fxResize.startH + delta),
    )
    document.getElementById('fxSection').style.height = newH + 'px'
    resizeFxCanvas()
  })
  document.addEventListener('mouseup', () => {
    if (!fxResize.active) return
    fxResize.active = false
    fxResizerEl.classList.remove('dragging')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    saveLayout()
  })

  // Search input wiring
  const fxSearchInput = document.getElementById('fxSearchInput')
  fxSearchInput.addEventListener('input', () =>
    renderSearchResults(fxSearchInput.value),
  )
  fxSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideEffectSearch()
      e.stopPropagation()
    }
  })

  // Font upload
  document
    .getElementById('fileInputFont')
    .addEventListener('change', async (e) => {
      const file = e.target.files[0]
      if (!file) return
      e.target.value = ''
      const family = file.name
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9\- ]/g, '')
      const reader = new FileReader()
      reader.onload = async (ev) => {
        try {
          const face = new FontFace(family, ev.target.result)
          await face.load()
          document.fonts.add(face)
          state.customFonts.push({ name: family, family })
          renderEffectProps()
          if (state.selectedEffectId) {
            const ef = state.effects.find(
              (e) => e.id === state.selectedEffectId,
            )
            if (ef && ef.type === 'text') {
              ef.font = family
              renderEffectProps()
            }
          }
        } catch (err) {
          alert('Failed to load font: ' + err.message)
        }
      }
      reader.readAsArrayBuffer(file)
    })

  // Props panel tabs
  document
    .getElementById('tabMarker')
    .addEventListener('click', () => switchPropsTab('marker'))
  document
    .getElementById('tabEffect')
    .addEventListener('click', () => switchPropsTab('effect'))

  // Render the initial default-settings state in the props panel
  renderMarkerProps()

  new ResizeObserver(resizeFxCanvas).observe(fxCanvas.parentElement)

  // Marker list — event delegation
  document.getElementById('markerList').addEventListener('click', (e) => {
    const row = e.target.closest('.marker-row')
    if (!row) return
    const idx = parseInt(row.dataset.idx)
    const mode = e.shiftKey
      ? 'range'
      : e.ctrlKey || e.metaKey
        ? 'toggle'
        : 'single'
    selectMarker(idx, mode)
    if (state.hasVideo && mode === 'single') {
      video.currentTime = state.markers[idx].frame / FPS
    }
  })

  // Drag & drop
  let dragDepth = 0
  const clearDragOverlay = () => {
    dragDepth = 0
    document.body.classList.remove('dragging-over')
  }

  document.addEventListener('dragenter', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      dragDepth++
      document.body.classList.add('dragging-over')
    }
  })
  document.addEventListener('dragleave', (e) => {
    dragDepth--
    if (dragDepth <= 0) clearDragOverlay()
    // Also clear if the cursor left the browser window entirely (relatedTarget is null)
    if (e.relatedTarget === null) clearDragOverlay()
  })
  document.addEventListener('dragend', clearDragOverlay)
  window.addEventListener('blur', clearDragOverlay) // window lost focus mid-drag
  document.addEventListener('dragover', (e) => e.preventDefault())
  document.addEventListener('drop', (e) => {
    e.preventDefault()
    clearDragOverlay()
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (
      file.type.startsWith('video/') ||
      /\.(mp4|webm|mkv|mov|avi)$/i.test(file.name)
    ) {
      loadVideo(file)
    } else if (/\.(bx|bx2|json)$/i.test(file.name)) {
      _openFileHandle = null
      importBx(file)
    }
  })

  // Keyboard
  document.addEventListener('keydown', onKeydown)

  // Resize observers
  new ResizeObserver(resizeAllCanvases).observe(
    document.getElementById('previewWrap'),
  )
  new ResizeObserver(resizeTimelineCanvas).observe(
    document.getElementById('timelineScrollContainer'),
  )

  resizeAllCanvases()
  requestAnimationFrame(loop)
}

// ── Video ─────────────────────────────────────────────────────────────────────

function setTimelineHeight(h) {
  const section = document.getElementById('timelineSection')
  section.style.height = h + 'px'
  resizeTimelineCanvas()
}

function updateVolIcon() {
  const icon = document.getElementById('volIcon')
  const vol = video.volume
  const muted = video.muted || vol === 0
  if (muted) {
    icon.innerHTML = `
      <polygon points="2,5 6,5 10,2 10,14 6,11 2,11"/>
      <line x1="13" y1="5" x2="16" y2="11" stroke="currentColor"/>
      <line x1="16" y1="5" x2="13" y2="11" stroke="currentColor"/>`
  } else if (vol < 0.4) {
    icon.innerHTML = `
      <polygon points="2,5 6,5 10,2 10,14 6,11 2,11"/>
      <path d="M12,5.5 a3,3 0 0 1 0,5"/>`
  } else {
    icon.innerHTML = `
      <polygon points="2,5 6,5 10,2 10,14 6,11 2,11"/>
      <path d="M12,5.5 a3,3 0 0 1 0,5"/>
      <path d="M13.5,3.5 a5.5,5.5 0 0 1 0,9"/>`
  }
}

function onPropFrameScroll(delta) {
  if (state.selection.size !== 1) return
  const idx = [...state.selection][0]
  const m = state.markers[idx]
  const newFrame = Math.max(0, Math.min(state.totalFrames - 1, m.frame + delta))
  if (newFrame === m.frame) return
  // Make sure the new frame isn't occupied by another marker
  if (state.markers.some((mk, i) => i !== idx && mk.frame === newFrame)) return
  pushHistory()
  m.frame = newFrame
  sortMarkers()
  // Re-find the marker after sort and update selection
  const newIdx = state.markers.findIndex((mk) => mk.frame === newFrame)
  state.selection.clear()
  state.selection.add(newIdx)
  state.lastClickedIdx = newIdx
  if (state.hasVideo) video.currentTime = newFrame / FPS
  rebuildPath()
  renderMarkerList()
  renderMarkerProps()
}

function loadVideo(file) {
  if (video.src && video.src.startsWith('blob:')) URL.revokeObjectURL(video.src)
  video.src = URL.createObjectURL(file)
  state.hasVideo = true
  document.getElementById('videoPlaceholder').style.display = 'none'
  video.style.display = 'block'
  document.getElementById('btnExport').disabled = false
  document.title = `BX Editor — ${file.name}`
}

function onVideoMetadata() {
  state.duration = video.duration
  state.totalFrames = Math.round(video.duration * FPS)
  fitZoom()
  // Add default frame-0 anchor marker if one doesn't already exist
  if (!state.markers.some((m) => m.frame === 0)) {
    state.markers.unshift({
      frame: 0,
      depth: 0.0,
      trans: state.defaultTrans,
      ease: state.defaultEase,
    })
    updateMarkerCount()
    renderMarkerList()
  }
  rebuildPath()
}

function currentFrame() {
  return Math.round((video.currentTime || 0) * FPS)
}

function togglePlay() {
  if (!state.hasVideo) return
  video.paused || video.ended ? video.play() : video.pause()
}

function updatePlayBtn() {
  const icon = document.getElementById('playIcon')
  if (!video.paused && !video.ended) {
    icon.innerHTML = `<rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/>`
    icon.setAttribute('fill', 'currentColor')
    icon.parentElement.title = 'Pause (Space)'
  } else {
    icon.innerHTML = `<polygon points="3,2 13,8 3,14"/>`
    icon.parentElement.title = 'Play (Space)'
  }
}

// ── Import ────────────────────────────────────────────────────────────────────

function importBx(file) {
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const raw = JSON.parse(e.target.result)
      // Support plain .bx, version:2 at root (old), and meta.version:2.0 (new)
      const metaVersion = raw.meta?.version
      const isV2 =
        metaVersion === 2 ||
        metaVersion === 2.0 ||
        raw.version === 2 ||
        raw.version === 2.0
      const markerData = isV2 ? raw.markers : raw
      state.markers = Object.entries(markerData)
        .map(([k, v]) => ({
          frame: parseInt(k),
          depth: parseFloat(v[0]) || 0,
          trans: parseInt(v[1]) || 0,
          ease: parseInt(v[2]) || 0,
        }))
        .sort((a, b) => a.frame - b.frame)
      // Load effects
      if (isV2 && Array.isArray(raw.effects)) {
        state.effects = raw.effects.map((e) => ({ ...e }))
        _effectIdCounter = state.effects.reduce((m, e) => {
          const n = parseInt(e.id.slice(1)) || 0
          return Math.max(m, n)
        }, _effectIdCounter)
      } else {
        state.effects = []
      }
      // Load meta
      const rawMeta = raw.meta || {}
      state.meta = {
        title: rawMeta.title || '',
        path_creator: rawMeta.path_creator || '',
        bpm: rawMeta.bpm != null ? String(rawMeta.bpm) : '',
        related_media: rawMeta.related_media || '',
        video_url: rawMeta.video_url || '',
      }
      state.selectedEffectId = null
      state.selection.clear()
      state.lastClickedIdx = null
      rebuildPath()
      renderMarkerList()
      renderMarkerProps()
      updateMarkerCount()
      updateExportLabel()
    } catch (err) {
      alert(`Failed to parse file: ${err.message}`)
    }
  }
  reader.readAsText(file)
}

// ── Export ────────────────────────────────────────────────────────────────────

async function exportBx2() {
  if (state.markers.length === 0) {
    alert('No markers to export.')
    return
  }

  const markerData = {}
  for (const m of state.markers) {
    markerData[String(m.frame)] = [m.depth, m.trans, m.ease, 0]
  }

  // Always export as version 2 with meta block and marker_fields.
  // effects is always present (empty array when none).
  const metaObj = { version: 2, marker_fields: ['depth', 'trans', 'ease', 'auxiliary'] }
  if (state.meta.title)         metaObj.title         = state.meta.title
  if (state.meta.path_creator)  metaObj.path_creator  = state.meta.path_creator
  if (state.meta.bpm !== '')    metaObj.bpm            = parseFloat(state.meta.bpm) || state.meta.bpm
  if (state.meta.related_media) metaObj.related_media = state.meta.related_media
  if (state.meta.video_url)     metaObj.video_url     = state.meta.video_url

  const content = JSON.stringify({ meta: metaObj, markers: markerData, effects: state.effects }, null, 2)

  const blob = new Blob([content], { type: 'application/json' })

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'path.bx',
        types: [
          {
            description: 'BounceX Path File',
            accept: { 'application/json': ['.bx'] },
          },
        ],
      })
      const w = await handle.createWritable()
      await w.write(blob)
      await w.close()
      return
    } catch (err) {
      if (err.name === 'AbortError') return
    }
  }
  // Fallback download — prompt for filename since there's no native save dialog
  const suggested = prompt('Save as:', 'path.bx')
  if (suggested === null) return // user cancelled
  const filename = suggested.trim() || 'path.bx'
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: filename.endsWith('.bx') ? filename : filename + '.bx',
  })
  a.click()
  URL.revokeObjectURL(url)
}

/** Update the export button label. Always .bx now. */
function updateExportLabel() {
  const btn = document.getElementById('btnExport')
  if (!btn) return
  btn.querySelector('.export-label').textContent = 'Export .bx'
}

// ── Markers ───────────────────────────────────────────────────────────────────

function addMarkerAt(frame, depth = state.defaultDepth) {
  frame = Math.max(0, Math.min(Math.max(state.totalFrames - 1, 0), frame))
  if (state.markers.some((m) => m.frame === frame)) return
  pushHistory()
  state.markers.push({
    frame,
    depth,
    trans: state.defaultTrans,
    ease: state.defaultEase,
  })
  sortMarkers()
  rebuildPath()
  const idx = state.markers.findIndex((m) => m.frame === frame)
  selectMarker(idx, 'single')
  renderMarkerList()
  updateMarkerCount()
}

function deleteSelected() {
  if (state.selection.size === 0) return
  pushHistory()
  state.markers = state.markers.filter((_, i) => !state.selection.has(i))
  state.selection.clear()
  state.lastClickedIdx = null
  rebuildPath()
  renderMarkerList()
  renderMarkerProps()
  updateMarkerCount()
}

function sortMarkers() {
  state.markers.sort((a, b) => a.frame - b.frame)
}

function rebuildPath() {
  if (state.markers.length === 0 || state.totalFrames === 0) {
    state.path = null
    return
  }
  const markerData = {}
  for (const m of state.markers) {
    markerData[String(m.frame)] = [m.depth, m.trans, m.ease, 0]
  }
  state.path = buildPath(markerData, state.totalFrames)
}

function updateMarkerCount() {
  document.getElementById('markerCountBadge').textContent = state.markers.length
}

// ── Selection ─────────────────────────────────────────────────────────────────

function selectMarker(idx, mode = 'single') {
  if (idx < 0 || idx >= state.markers.length) return
  if (mode === 'single') {
    state.selection.clear()
    state.selection.add(idx)
    state.lastClickedIdx = idx
  } else if (mode === 'toggle') {
    if (state.selection.has(idx)) {
      state.selection.delete(idx)
      if (state.lastClickedIdx === idx) state.lastClickedIdx = null
    } else {
      state.selection.add(idx)
      state.lastClickedIdx = idx
    }
  } else if (mode === 'range') {
    const anchor = state.lastClickedIdx ?? idx
    const lo = Math.min(anchor, idx)
    const hi = Math.max(anchor, idx)
    state.selection.clear()
    for (let i = lo; i <= hi; i++) state.selection.add(i)
    // Don't update anchor for range select
  }
  renderMarkerList()
  renderMarkerProps()
}

function selectAll() {
  for (let i = 0; i < state.markers.length; i++) state.selection.add(i)
  renderMarkerList()
  renderMarkerProps()
}

function clearSelection() {
  state.selection.clear()
  state.lastClickedIdx = null
  renderMarkerList()
  renderMarkerProps()
}

// ── Marker list (DOM) ─────────────────────────────────────────────────────────

function renderMarkerList() {
  const list = document.getElementById('markerList')
  if (state.markers.length === 0) {
    list.innerHTML =
      '<div class="markers-empty">No markers yet.<br>Press <strong>M</strong> to add one at the playhead.</div>'
    return
  }

  const curF = currentFrame()
  let nearestIdx = -1,
    nearestDist = Infinity
  state.markers.forEach((m, i) => {
    const d = Math.abs(m.frame - curF)
    if (d < nearestDist) {
      nearestDist = d
      nearestIdx = i
    }
  })
  state.nearestMarkerIdx = nearestIdx

  list.innerHTML = state.markers
    .map((m, i) => {
      const sel = state.selection.has(i)
      const nearest = i === nearestIdx && !sel
      const depthPct = (m.depth * 100).toFixed(1)
      return `<div class="marker-row${sel ? ' selected' : ''}${nearest ? ' nearest' : ''}" data-idx="${i}">
      <span class="marker-row-sel${sel ? ' active' : ''}"></span>
      <span class="marker-row-frame">${m.frame}</span>
      <div class="marker-row-depth-bar">
        <div class="marker-row-depth-fill" style="width:${depthPct}%"></div>
      </div>
      <span class="marker-row-depth-val">${m.depth.toFixed(2)}</span>
      <span class="marker-row-ease">${easeLabel(m.trans, m.ease)}</span>
    </div>`
    })
    .join('')

  // Scroll selected into view
  if (state.selection.size === 1) {
    const idx = [...state.selection][0]
    list
      .querySelector(`[data-idx="${idx}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }
}

// ── Properties panel (DOM) ────────────────────────────────────────────────────

function renderMarkerProps() {
  const label = document.getElementById('selectionLabel')
  const empty = document.getElementById('propsEmpty')
  const form = document.getElementById('propsForm')
  const panelTitle = document.getElementById('propsPanelTitle')
  const deleteRow = document.getElementById('propDeleteRow')
  const frameRow = document.getElementById('propFrameRow')

  // ── No selection: show default new-marker settings ──────────────────────────
  if (state.selection.size === 0) {
    panelTitle.textContent = 'NEW MARKER'
    label.textContent = 'Defaults'
    empty.style.display = 'none'
    form.style.display = 'flex'
    frameRow.style.display = 'none'
    deleteRow.style.display = 'none'

    document.getElementById('propDepthSlider').value = state.defaultDepth
    document.getElementById('propDepth').value = state.defaultDepth.toFixed(2)
    document.getElementById('propTrans').value = state.defaultTrans
    document.getElementById('propEase').value = state.defaultEase
    return
  }

  // ── Selection: show selected marker properties ───────────────────────────────
  panelTitle.textContent = 'PROPERTIES'
  const sel = [...state.selection]
  label.textContent = sel.length === 1 ? '1 marker' : `${sel.length} markers`
  empty.style.display = 'none'
  form.style.display = 'flex'
  frameRow.style.display = ''
  deleteRow.style.display = ''

  const frameEl = document.getElementById('propFrame')
  const sliderEl = document.getElementById('propDepthSlider')
  const depthEl = document.getElementById('propDepth')
  const transEl = document.getElementById('propTrans')
  const easeEl = document.getElementById('propEase')

  if (sel.length === 1) {
    const m = state.markers[sel[0]]
    frameEl.value = m.frame
    frameEl.disabled = false
    sliderEl.value = m.depth
    depthEl.value = m.depth.toFixed(2)
    transEl.value = m.trans
    easeEl.value = m.ease
  } else {
    const ms = sel.map((i) => state.markers[i])
    const allSameDepth = ms.every((m) => m.depth === ms[0].depth)
    const allSameTrans = ms.every((m) => m.trans === ms[0].trans)
    const allSameEase = ms.every((m) => m.ease === ms[0].ease)

    frameEl.value = ''
    frameEl.disabled = true
    sliderEl.value = allSameDepth ? ms[0].depth : 0.5
    depthEl.value = allSameDepth ? ms[0].depth.toFixed(2) : ''
    depthEl.placeholder = allSameDepth ? '' : '—'
    transEl.value = allSameTrans ? ms[0].trans : ''
    easeEl.value = allSameEase ? ms[0].ease : ''
  }
}

// ── Property change handlers ──────────────────────────────────────────────────

function onPropFrameChange(el) {
  if (state.selection.size !== 1) return
  const idx = [...state.selection][0]
  const newFrame = Math.max(
    0,
    Math.min(state.totalFrames - 1, parseInt(el.value) || 0),
  )
  if (state.markers.some((m, i) => i !== idx && m.frame === newFrame)) {
    el.value = state.markers[idx].frame
    return
  }
  pushHistory()
  state.markers[idx].frame = newFrame
  sortMarkers()
  const newIdx = state.markers.findIndex((m) => m.frame === newFrame)
  state.selection.clear()
  state.selection.add(newIdx)
  state.lastClickedIdx = newIdx
  rebuildPath()
  renderMarkerList()
  renderMarkerProps()
}

function commitDepthText(raw) {
  // Called when the text input is committed (blur / Enter).
  // Accepts values like "0.5", ".5", "50" (treated as 0–1 range).
  const parsed = parseFloat(raw)
  if (isNaN(parsed)) {
    // Revert display to current value without changing anything
    renderMarkerProps()
    return
  }
  onPropDepthInput(parsed, 'text')
}

function onPropDepthInput(val, source = 'slider') {
  if (isNaN(val)) return
  const clamped = Math.max(0, Math.min(1, val))
  // Only sync slider from text, not the other way (slider fires its own event)
  if (source === 'text') {
    document.getElementById('propDepthSlider').value = clamped
  }
  // Always update the text box to show the clean formatted value
  document.getElementById('propDepth').value = clamped.toFixed(2)

  if (state.selection.size === 0) {
    state.defaultDepth = clamped
  } else {
    // Absolute set — every selected marker gets exactly this value
    pushHistory()
    for (const idx of state.selection) state.markers[idx].depth = clamped
    rebuildPath()
    renderMarkerList()
  }
}

function onPropTransChange(val) {
  if (state.selection.size === 0) {
    state.defaultTrans = val
  } else {
    pushHistory()
    for (const idx of state.selection) state.markers[idx].trans = val
    rebuildPath()
    renderMarkerList()
  }
}

function onPropEaseChange(val) {
  if (state.selection.size === 0) {
    state.defaultEase = val
  } else {
    pushHistory()
    for (const idx of state.selection) state.markers[idx].ease = val
    rebuildPath()
    renderMarkerList()
  }
}

// ── Timeline coordinate helpers ───────────────────────────────────────────────

function pixelsPerFrame() {
  if (state.totalFrames === 0) return 1
  return (timelineCanvas.width / state.totalFrames) * state.timelineZoom
}

function frameToTlX(frame) {
  return frame * pixelsPerFrame() - state.timelineScrollX
}

function tlXToFrame(x) {
  return Math.round((x + state.timelineScrollX) / pixelsPerFrame())
}

function clampScroll() {
  const maxScroll = Math.max(
    0,
    state.totalFrames * pixelsPerFrame() - timelineCanvas.width,
  )
  state.timelineScrollX = Math.max(
    0,
    Math.min(maxScroll, state.timelineScrollX),
  )
}

function getMarkerAtTlX(x, y) {
  // Only detect in the marker area (below ruler)
  const RULER_H = 24
  if (y < RULER_H) return -1
  const tolerance = 10
  let closest = -1,
    closestDist = Infinity
  state.markers.forEach((m, i) => {
    const mx = frameToTlX(m.frame)
    const dist = Math.abs(mx - x)
    if (dist < tolerance && dist < closestDist) {
      closest = i
      closestDist = dist
    }
  })
  return closest
}

// ── Timeline zoom ─────────────────────────────────────────────────────────────

function adjustZoom(factor) {
  const container = document.getElementById('timelineScrollContainer')
  const centerX = container.clientWidth / 2
  const centerFrame = tlXToFrame(centerX)
  state.timelineZoom = Math.max(1, Math.min(500, state.timelineZoom * factor))
  state.timelineScrollX = centerFrame * pixelsPerFrame() - centerX
  clampScroll()
  document.getElementById('zoomLabel').textContent =
    `${state.timelineZoom.toFixed(1)}×`
}

function fitZoom() {
  state.timelineZoom = 1.0
  state.timelineScrollX = 0
  document.getElementById('zoomLabel').textContent = '1.0×'
}

// ── Timeline mouse events ─────────────────────────────────────────────────────

let tlHoverMarkerIdx = -1

function onTlMouseDown(e) {
  if (e.button !== 0) return
  const rect = timelineCanvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top

  tlMouse.down = true
  tlMouse.dragMoved = false
  const hitMarker = getMarkerAtTlX(x, y)
  const clickedFrame = Math.max(
    0,
    Math.min(state.totalFrames - 1, tlXToFrame(x)),
  )

  if (hitMarker >= 0) {
    const alreadyInSelection = state.selection.has(hitMarker)
    const hasModifier = e.shiftKey || e.ctrlKey || e.metaKey

    if (hasModifier) {
      // Modifier held — normal range/toggle behaviour
      const mode = e.shiftKey ? 'range' : 'toggle'
      selectMarker(hitMarker, mode)
    } else if (!alreadyInSelection) {
      // Clicking a marker not in the current selection → single-select it
      selectMarker(hitMarker, 'single')
    }
    // If clicking a marker already in the selection with no modifier,
    // preserve the full selection so the whole group can be dragged.

    // Prime drag for no-modifier clicks (single or group)
    if (!hasModifier) {
      tlMouse.draggingMarkerIdx = hitMarker
      tlMouse.dragStartX        = x
      tlMouse.dragStartFrame    = state.markers[hitMarker].frame
      tlMouse.origFrames        = new Map()
      for (const si of state.selection) {
        if (state.markers[si]) tlMouse.origFrames.set(si, state.markers[si].frame)
      }
      document.body.style.userSelect = 'none'
    }
  } else {
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) clearSelection()
    if (state.hasVideo) video.currentTime = clickedFrame / FPS
    tlMouse.draggingPlayhead = true
  }
}

function onTlMouseMove(e) {
  const rect = timelineCanvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top

  // ── Marker drag ────────────────────────────────────────────────────────────
  if (tlMouse.draggingMarkerIdx >= 0 && tlMouse.down) {
    const DRAG_THRESHOLD = 4
    if (!tlMouse.dragMoved && Math.abs(x - tlMouse.dragStartX) < DRAG_THRESHOLD) return
    if (!tlMouse.dragMoved) {
      pushHistory()
      tlMouse.dragMoved = true
    }

    timelineCanvas.style.cursor = 'grabbing'
    document.body.style.cursor = 'grabbing'

    // Frame delta from the drag-anchor marker's original position
    const rawTarget = Math.max(0, Math.min(state.totalFrames - 1, tlXToFrame(x)))
    // Snap anchor to playhead only when dragging a single marker
    const snapped = state.hasVideo && tlMouse.origFrames.size === 1
      && Math.abs(x - frameToTlX(currentFrame())) <= 10
      ? currentFrame() : rawTarget
    let delta = snapped - tlMouse.dragStartFrame

    // Clamp delta so no selected marker goes out of bounds
    for (const [si, origF] of tlMouse.origFrames) {
      const proposed = origF + delta
      if (proposed < 0) delta = Math.max(delta, -origF)
      if (proposed >= state.totalFrames) delta = Math.min(delta, state.totalFrames - 1 - origF)
    }

    if (delta === 0) return

    // Check for collisions with non-selected markers
    const selectedSet = new Set(tlMouse.origFrames.keys())
    const proposedFrames = new Set()
    for (const [, origF] of tlMouse.origFrames) proposedFrames.add(origF + delta)
    const wouldCollide = state.markers.some((mk, i) =>
      !selectedSet.has(i) && proposedFrames.has(mk.frame)
    )
    if (wouldCollide) return

    // Apply delta to all selected markers
    for (const [si, origF] of tlMouse.origFrames) {
      if (state.markers[si]) state.markers[si].frame = origF + delta
    }

    sortMarkers()

    // Re-map selection and origFrames indices after sort
    const newSelection = new Set()
    const newOrigFrames = new Map()
    const anchorNewFrame = tlMouse.dragStartFrame + delta
    let newAnchorIdx = -1
    for (const [, origF] of tlMouse.origFrames) {
      const newF = origF + delta
      const newIdx = state.markers.findIndex(mk => mk.frame === newF)
      if (newIdx >= 0) {
        newSelection.add(newIdx)
        newOrigFrames.set(newIdx, origF)
        if (origF === tlMouse.dragStartFrame) newAnchorIdx = newIdx
      }
    }
    state.selection = newSelection
    tlMouse.origFrames = newOrigFrames
    if (newAnchorIdx >= 0) {
      tlMouse.draggingMarkerIdx = newAnchorIdx
      state.lastClickedIdx = newAnchorIdx
    }

    rebuildPath()
    renderMarkerList()
    renderMarkerProps()
    return
  }

  // ── Playhead drag ──────────────────────────────────────────────────────────
  tlHoverMarkerIdx = getMarkerAtTlX(x, y)
  const isDraggingMarker = tlMouse.draggingMarkerIdx >= 0
  timelineCanvas.style.cursor =
    tlHoverMarkerIdx >= 0 && !isDraggingMarker ? 'grab' : 'crosshair'

  if (tlMouse.down && tlMouse.draggingPlayhead && state.hasVideo) {
    const frame = Math.max(0, Math.min(state.totalFrames - 1, tlXToFrame(x)))
    video.currentTime = frame / FPS
  }
}

function onTlMouseLeave() {
  tlHoverMarkerIdx = -1
}

function onTlMouseUp() {
  // If we clicked a marker without dragging, seek to it now
  if (tlMouse.draggingMarkerIdx >= 0 && !tlMouse.dragMoved && state.hasVideo) {
    const m = state.markers[tlMouse.draggingMarkerIdx]
    if (m) video.currentTime = m.frame / FPS
  }
  tlMouse.down = false
  tlMouse.draggingPlayhead = false
  tlMouse.draggingMarkerIdx = -1
  tlMouse.dragMoved = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  timelineCanvas.style.cursor = ''
}

function onTlWheel(e) {
  e.preventDefault()
  if (e.ctrlKey || e.metaKey) {
    // Ctrl+Wheel → zoom, keep mouse position stable
    const rect = timelineCanvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const frameBefore = tlXToFrame(x)
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    state.timelineZoom = Math.max(1, Math.min(500, state.timelineZoom * factor))
    state.timelineScrollX = frameBefore * pixelsPerFrame() - x
    clampScroll()
    document.getElementById('zoomLabel').textContent =
      `${state.timelineZoom.toFixed(1)}×`
  } else {
    // Scroll
    state.timelineScrollX += e.deltaX || e.deltaY * 0.8
    clampScroll()
  }
}

// ── Timeline rendering ────────────────────────────────────────────────────────

function renderTimeline() {
  const W = timelineCanvas.width
  const H = timelineCanvas.height
  const ctx = timelineCtx
  const RULER_H = 24
  const ppf = pixelsPerFrame()

  ctx.clearRect(0, 0, W, H)

  // Base background
  ctx.fillStyle = '#0d0d10'
  ctx.fillRect(0, 0, W, H)

  if (state.totalFrames === 0) {
    ctx.fillStyle = '#333'
    ctx.font = `12px ${getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace'}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Load a video to activate the timeline', W / 2, H / 2)
    return
  }

  const visStart = Math.floor(state.timelineScrollX / ppf)
  const visEnd = Math.ceil((state.timelineScrollX + W) / ppf)

  // ── Ruler background ────────────────────────────────────────────────────────
  ctx.fillStyle = '#141418'
  ctx.fillRect(0, 0, W, RULER_H)
  ctx.fillStyle = '#1a1a1e'
  ctx.fillRect(0, RULER_H, W, H - RULER_H)

  // Ruler bottom border
  ctx.strokeStyle = '#2a2a30'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, RULER_H)
  ctx.lineTo(W, RULER_H)
  ctx.stroke()

  // ── Tick marks & labels ─────────────────────────────────────────────────────
  // Pick a sensible tick interval (always in whole frames)
  const minTickPx = 55
  const tickCandidates = [
    1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 14400,
  ]
  let tickEvery = tickCandidates[tickCandidates.length - 1]
  for (const c of tickCandidates) {
    if (c * ppf >= minTickPx) {
      tickEvery = c
      break
    }
  }

  ctx.font = `9px 'JetBrains Mono', monospace`
  ctx.textBaseline = 'middle'

  const firstTick = Math.ceil(visStart / tickEvery) * tickEvery
  for (let f = firstTick; f <= visEnd + tickEvery; f += tickEvery) {
    const x = Math.round(frameToTlX(f)) + 0.5
    if (x < -1 || x > W + 1) continue

    // Tick
    ctx.strokeStyle = '#2a2a32'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, RULER_H - 7)
    ctx.lineTo(x, RULER_H)
    ctx.stroke()

    // Subtle column line into marker area
    ctx.strokeStyle = 'rgba(255,255,255,0.025)'
    ctx.beginPath()
    ctx.moveTo(x, RULER_H)
    ctx.lineTo(x, H)
    ctx.stroke()

    // Label
    const secs = f / FPS
    const mm = Math.floor(secs / 60)
    const ss = Math.floor(secs % 60)
    const ff = Math.floor(f % FPS)
    const label =
      tickEvery >= FPS
        ? `${pad(mm)}:${pad(ss)}`
        : `${pad(mm)}:${pad(ss)}:${pad(ff)}`
    ctx.fillStyle = '#484860'
    ctx.textAlign = 'left'
    ctx.fillText(label, x + 3, RULER_H / 2)
  }

  // ── Depth minimap ────────────────────────────────────────────────────────────
  if (state.path) {
    const miniTop = RULER_H + 4
    const miniH = H - miniTop - 4

    ctx.strokeStyle = 'rgba(232, 160, 32, 0.3)'
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.beginPath()
    let started = false
    for (let px = 0; px <= W; px++) {
      const frame = Math.round(tlXToFrame(px))
      if (frame < 0 || frame >= state.totalFrames) continue
      const d = state.path[frame]
      if (d < 0) continue
      const y = miniTop + (1 - d) * miniH
      if (!started) {
        ctx.moveTo(px, y)
        started = true
      } else ctx.lineTo(px, y)
    }
    if (started) ctx.stroke()

    // Faint fill beneath curve
    if (started) {
      ctx.lineTo(W, miniTop + miniH)
      ctx.lineTo(0, miniTop + miniH)
      ctx.closePath()
      ctx.fillStyle = 'rgba(232,160,32,0.05)'
      ctx.fill()
    }
  }

  // ── Markers ──────────────────────────────────────────────────────────────────
  state.markers.forEach((m, i) => {
    const x = frameToTlX(m.frame)
    if (x < -12 || x > W + 12) return

    const isSel = state.selection.has(i)
    const isHovered = tlHoverMarkerIdx === i
    const isNearest = state.nearestMarkerIdx === i && !isSel

    // Vertical line colour — accent for selected, teal for nearest, white dim otherwise
    const lineAlpha = isSel ? 1.0 : isNearest ? 0.7 : isHovered ? 0.6 : 0.3
    const lineColor = isSel ? '#e8a020' : isNearest ? '#3dd6c8' : '#ffffff'
    ctx.globalAlpha = lineAlpha
    ctx.strokeStyle = lineColor
    ctx.lineWidth = isSel ? 1.5 : 1
    ctx.beginPath()
    ctx.moveTo(x + 0.5, RULER_H)
    ctx.lineTo(x + 0.5, H)
    ctx.stroke()

    // Diamond at depth position — depth 0 = top, depth 1 = bottom of minimap area
    const miniTop = RULER_H + 4
    const miniH = H - miniTop - 4
    const r = isSel ? 8 : isHovered ? 7 : 6
    const cy = miniTop + (1 - m.depth) * miniH // match minimap y mapping
    // Clamp so diamond stays inside canvas with margin
    const cyClamped = Math.max(miniTop + r, Math.min(H - r, cy))

    // White fill, accent/teal outline when selected/nearest
    ctx.globalAlpha = isSel ? 1.0 : isNearest ? 0.85 : isHovered ? 0.8 : 0.55
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(x, cyClamped - r)
    ctx.lineTo(x + r, cyClamped)
    ctx.lineTo(x, cyClamped + r)
    ctx.lineTo(x - r, cyClamped)
    ctx.closePath()
    ctx.fill()
    if (isSel || isNearest) {
      ctx.strokeStyle = isSel ? '#e8a020' : '#3dd6c8'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    // Depth label when selected or hovered
    if (isSel || isHovered) {
      ctx.font = `9px 'JetBrains Mono', monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = '#ffffff'
      ctx.globalAlpha = 0.9
      const labelY = cyClamped + r + 2
      if (labelY + 11 < H) ctx.fillText(m.depth.toFixed(2), x, labelY)
    }

    ctx.globalAlpha = 1
  })

  // ── Playhead ─────────────────────────────────────────────────────────────────
  const pxHead = frameToTlX(currentFrame())
  if (pxHead >= 0 && pxHead <= W) {
    // Shadow glow
    ctx.shadowColor = 'rgba(255,255,255,0.2)'
    ctx.shadowBlur = 4

    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(pxHead + 0.5, 0)
    ctx.lineTo(pxHead + 0.5, H)
    ctx.stroke()

    // Triangle at top
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(pxHead - 5, 0)
    ctx.lineTo(pxHead + 5, 0)
    ctx.lineTo(pxHead, 9)
    ctx.closePath()
    ctx.fill()

    ctx.shadowBlur = 0
  }

  // ── End-of-video marker ───────────────────────────────────────────────────────
  const xEnd = frameToTlX(state.totalFrames - 1)
  if (xEnd >= 0 && xEnd <= W) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(xEnd + 0.5, RULER_H)
    ctx.lineTo(xEnd + 0.5, H)
    ctx.stroke()
    ctx.setLineDash([])
  }
}

// ── Preview canvas rendering ──────────────────────────────────────────────────

const BALL_R = 7
const PPF_PREV = 3 // pixels per frame in the preview waveform
const EDGE_PAD = 8

function renderPreview() {
  const W = previewCanvas.width,
    H = previewCanvas.height,
    ctx = previewCtx
  ctx.clearRect(0, 0, W, H)

  if (!state.path || state.totalFrames === 0) {
    if (!state.hasVideo) {
      ctx.fillStyle = '#2a2a2a'
      ctx.font = `10px 'JetBrains Mono',monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Load a video', W / 2, H / 2)
    }
    return
  }

  const curFrameExact = (video.currentTime || 0) * FPS
  const curFrame = Math.floor(curFrameExact)
  const frac = curFrameExact - curFrame

  const BALL_MARGIN = BALL_R + 2
  const topY = BALL_MARGIN,
    bottomY = H - BALL_MARGIN,
    ballX = W / 2

  // Effective colours from pathColor effects
  const { pathRgb, ballRgb, bgRgb, bgOpaque } = getEffectiveColors(curFrame)
  const pcStr = `${pathRgb[0]},${pathRgb[1]},${pathRgb[2]}`

  // Background — use bgColor from active effect; semi-transparent by default
  const [bgR, bgG, bgB] = bgRgb || [10, 11, 15]
  ctx.fillStyle = bgOpaque
    ? `rgb(${bgR},${bgG},${bgB})`
    : `rgba(${bgR},${bgG},${bgB},0.45)`
  ctx.fillRect(0, 0, W, H)

  // Compute current depth first so boundary lines can react to it
  const dA =
    curFrame >= 0 && state.path[curFrame] >= 0 ? state.path[curFrame] : 0
  const dB =
    state.path[Math.min(curFrame + 1, state.totalFrames - 1)] >= 0
      ? state.path[Math.min(curFrame + 1, state.totalFrames - 1)]
      : dA
  const curDepth = dA + (dB - dA) * frac
  const ballY = bottomY + curDepth * (topY - bottomY)

  const isNearTop = curDepth >= 0.99
  const isNearBottom = curDepth <= 0.01

  // Boundary lines — light up accent colour when ball is at the extreme
  ctx.lineWidth = 1
  ctx.strokeStyle = isNearTop ? '#3dd6c8' : 'rgba(255,255,255,0.15)'
  ctx.beginPath()
  ctx.moveTo(0, topY)
  ctx.lineTo(W, topY)
  ctx.stroke()
  ctx.strokeStyle = isNearBottom ? '#f07849' : 'rgba(255,255,255,0.15)'
  ctx.beginPath()
  ctx.moveTo(0, bottomY)
  ctx.lineTo(W, bottomY)
  ctx.stroke()

  ctx.save()
  ctx.beginPath()
  ctx.rect(0, EDGE_PAD, W, H - EDGE_PAD * 2)
  ctx.clip()

  const framesVisible = Math.ceil(W / PPF_PREV) + 2

  // ── Per-frame speed integration ────────────────────────────────────────────
  // Instead of one global ppfEffective, compute each frame's x by integrating
  // speed from the playhead outward. Frames outside any speed effect use PPF_PREV;
  // frames inside get the lerped speed for that specific frame. This means only
  // the affected zone stretches — past/future frames outside the effect don't snap.
  function speedAt(f) {
    let s = 1.0
    for (const eff of state.effects) {
      if (eff.type !== 'pathSpeed') continue
      const fade = getEffectFade(eff, f)
      if (fade <= 0) continue
      s = 1.0 + ((eff.speed || 1.0) - 1.0) * fade
    }
    return s
  }

  // Build a small x-position cache by stepping away from curFrameExact in both
  // directions, accumulating (PPF_PREV * speedAt(f)) per frame.
  const xCache = new Map()
  xCache.set(curFrameExact, ballX)

  // Step rightward (future frames)
  let xAcc = ballX
  const maxF = Math.min(
    state.totalFrames - 1,
    Math.ceil(curFrameExact) + Math.ceil(W / PPF_PREV) + 4,
  )
  for (let f = Math.ceil(curFrameExact); f <= maxF; f++) {
    const step = PPF_PREV * speedAt(f - 0.5)
    xAcc += step
    xCache.set(f, xAcc)
  }

  // Step leftward (past frames)
  xAcc = ballX
  const minF = Math.max(
    0,
    Math.floor(curFrameExact) - Math.ceil(W / PPF_PREV) - 4,
  )
  for (let f = Math.floor(curFrameExact); f >= minF; f--) {
    if (!xCache.has(f)) {
      const step = PPF_PREV * speedAt(f + 0.5)
      xAcc -= step
      xCache.set(f, xAcc)
    }
  }

  // Interpolate x for any fractional frame (the playhead itself)
  function frameToX(f) {
    if (xCache.has(f)) return xCache.get(f)
    const fl = Math.floor(f),
      fr = Math.ceil(f)
    const xl = xCache.get(fl) ?? ballX + (fl - curFrameExact) * PPF_PREV
    const xr = xCache.get(fr) ?? ballX + (fr - curFrameExact) * PPF_PREV
    return xl + (xr - xl) * (f - fl)
  }

  // For the speed label, read the current speed at the playhead
  const activeSpeed = speedAt(curFrameExact)

  const sf = minF
  const efEnd = maxF
  const grad = ctx.createLinearGradient(0, 0, W, 0)
  grad.addColorStop(0, `rgba(${pcStr},0)`)
  grad.addColorStop(0.12, `rgba(${pcStr},0.5)`)
  grad.addColorStop(0.42, `rgba(${pcStr},1)`)
  grad.addColorStop(0.58, `rgba(${pcStr},1)`)
  grad.addColorStop(0.88, `rgba(${pcStr},0.5)`)
  grad.addColorStop(1, `rgba(${pcStr},0)`)

  ctx.strokeStyle = grad
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.beginPath()
  let pathStarted = false
  for (let f = sf; f <= efEnd; f++) {
    const d = state.path[f]
    if (d < 0) continue
    const x = frameToX(f)
    if (x < -20 || x > W + 20) continue
    const y = bottomY + d * (topY - bottomY)
    if (!pathStarted) {
      ctx.moveTo(x, y)
      pathStarted = true
    } else ctx.lineTo(x, y)
  }
  if (pathStarted) ctx.stroke()

  // Speed label when a speed effect is active
  if (activeSpeed !== 1.0) {
    ctx.save()
    ctx.font = `bold 10px 'JetBrains Mono', monospace`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillStyle = '#d07030'
    ctx.globalAlpha = 0.85
    ctx.fillText(`${activeSpeed}×`, W - 6, topY + 2)
    ctx.restore()
  }

  // Selected marker ticks
  if (state.selection.size > 0 && state.selection.size <= 32) {
    state.selection.forEach((idx) => {
      const m = state.markers[idx]
      if (!m) return
      const x = frameToX(m.frame)
      if (x < 0 || x > W) return
      ctx.strokeStyle = `rgba(${pcStr},0.4)`
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(x, EDGE_PAD)
      ctx.lineTo(x, H - EDGE_PAD)
      ctx.stroke()
      ctx.setLineDash([])
    })
  }

  // Ball glow
  const glow = ctx.createRadialGradient(
    ballX,
    ballY,
    0,
    ballX,
    ballY,
    BALL_R * 3,
  )
  glow.addColorStop(0, 'rgba(255,255,255,0.28)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.beginPath()
  ctx.arc(ballX, ballY, BALL_R * 3, 0, Math.PI * 2)
  ctx.fillStyle = glow
  ctx.fill()

  // Ball
  ctx.beginPath()
  ctx.arc(ballX, ballY, BALL_R, 0, Math.PI * 2)
  ctx.fillStyle = `rgb(${ballRgb[0]},${ballRgb[1]},${ballRgb[2]})`
  ctx.fill()

  ctx.restore()

  // ── Text effects ──────────────────────────────────────────────────────────────
  // posX/posY are % of the path area (topY→bottomY).
  const pathAreaH = bottomY - topY
  for (const eff of state.effects) {
    if (eff.type !== 'text') continue
    const fade = getEffectFade(eff, curFrame) * (eff.opacity ?? 1)
    if (fade <= 0) continue
    const fontFamily = eff.font || 'Rajdhani'
    let actualFontSize = Math.max(
      4,
      Math.round(((eff.fontSize || 50) / 100) * pathAreaH),
    )
    ctx.save()
    ctx.globalAlpha = fade
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = eff.color || '#ffffff'
    ctx.shadowColor = 'rgba(0,0,0,0.85)'

    const lines = String(eff.text || '').split('\n')
    const maxAllowedW = W * 0.92

    // Measure at nominal size; shrink font if widest line overflows
    ctx.font = `${actualFontSize}px '${fontFamily}', sans-serif`
    const widestLine = lines.reduce(
      (max, l) => Math.max(max, ctx.measureText(l).width),
      0,
    )
    if (widestLine > maxAllowedW) {
      actualFontSize = Math.max(
        4,
        Math.floor((actualFontSize * maxAllowedW) / widestLine),
      )
      ctx.font = `${actualFontSize}px '${fontFamily}', sans-serif`
    }

    ctx.shadowBlur = Math.max(2, Math.ceil(actualFontSize / 10))
    const m = ctx.measureText('Ag')
    const vAsc = m.actualBoundingBoxAscent ?? actualFontSize * 0.72
    const vDesc = m.actualBoundingBoxDescent ?? actualFontSize * 0.18
    const baselineOffset = (vAsc - vDesc) / 2

    const tx = W * ((eff.posX ?? 50) / 100)
    const centerY = topY + pathAreaH * ((eff.posY ?? 50) / 100)
    const lineH = actualFontSize * 1.25
    lines.forEach((line, li) => {
      const lineCenterY = centerY + (li - (lines.length - 1) / 2) * lineH
      ctx.fillText(line, tx, lineCenterY + baselineOffset)
    })
    ctx.restore()
  }

  // Playhead center line
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 4])
  ctx.beginPath()
  ctx.moveTo(ballX, 0)
  ctx.lineTo(ballX, H)
  ctx.stroke()
  ctx.setLineDash([])
}

// ── HUD update ────────────────────────────────────────────────────────────────

function updateHUD() {
  const f = currentFrame()
  document.getElementById('frameDisplay').textContent = f
  document.getElementById('timeCurrentDisplay').textContent =
    framesToTimecode(f)
  document.getElementById('timeDurationDisplay').textContent = framesToTimecode(
    state.totalFrames,
  )
}

// ── Canvas resizing ───────────────────────────────────────────────────────────

function resizeAllCanvases() {
  const wrap = document.getElementById('previewWrap')
  previewCanvas.width = wrap.clientWidth || 400
  previewCanvas.height = wrap.clientHeight || 96
  resizeTimelineCanvas()
  resizeFxCanvas()
}

function resizeTimelineCanvas() {
  const container = document.getElementById('timelineScrollContainer')
  timelineCanvas.width = container.clientWidth || 800
  timelineCanvas.height = container.clientHeight || 188
  clampScroll()
}

function resizeFxCanvas() {
  if (!fxCanvas) return
  const parent = fxCanvas.parentElement
  if (!parent) return
  fxCanvas.width = parent.clientWidth || 800
  fxCanvas.height = parent.clientHeight || 100
}

// ── RAF loop ──────────────────────────────────────────────────────────────────

function loop() {
  updateHUD()
  renderTimeline()
  renderFxTimeline()
  renderPreview()
  // Keep marker list nearest-highlight in sync (cheap string compare)
  if (state.markers.length > 0) {
    const curF = currentFrame()
    let nearestIdx = -1,
      nearestDist = Infinity
    state.markers.forEach((m, i) => {
      const d = Math.abs(m.frame - curF)
      if (d < nearestDist) {
        nearestDist = d
        nearestIdx = i
      }
    })
    if (nearestIdx !== state.nearestMarkerIdx) {
      state.nearestMarkerIdx = nearestIdx
      renderMarkerList() // re-render list to move the teal highlight
    }
  }
  requestAnimationFrame(loop)
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function onKeydown(e) {
  const tag = e.target.tagName
  const inInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'

  // ── Record mode: arrow keys stamp markers at current frame ───────────────────
  if (state.recordMode && state.hasVideo && !video.paused && !inInput) {
    if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowRight'
    ) {
      e.preventDefault()
      const depthMap = { ArrowLeft: 0.0, ArrowUp: 0.5, ArrowRight: 1.0 }
      const depth = depthMap[e.key]
      const frame = currentFrame()
      // If a marker already exists at this frame, update its depth instead
      const existing = state.markers.findIndex((m) => m.frame === frame)
      if (existing >= 0) {
        state.markers[existing].depth = depth
        state.markers[existing].trans = state.defaultTrans
        state.markers[existing].ease = state.defaultEase
        rebuildPath()
        renderMarkerList()
      } else {
        addMarkerAt(frame, depth)
        clearSelection() // Don't interrupt playback with selection UI
      }
      return
    }
  }

  switch (e.key) {
    case 'z':
    case 'Z':
      if (!inInput && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      break

    case 'y':
    case 'Y':
      if (!inInput && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        redo()
      }
      break

    case ' ':
      if (inInput) return
      e.preventDefault()
      togglePlay()
      // Exit record mode when user manually pauses
      if (state.recordMode && !video.paused === false) {
        // (video.play/pause will handle the actual state, keep rec mode on)
      }
      break

    case 'r':
    case 'R':
      if (inInput) return
      if (!e.ctrlKey && !e.metaKey) toggleRecordMode()
      break

    case 'm':
    case 'M':
      if (inInput) return
      addMarkerAt(currentFrame())
      break

    case 'Delete':
    case 'Backspace':
      if (inInput) return
      e.preventDefault()
      if (state.selectedEffectId) deleteSelectedEffect()
      else deleteSelected()
      break

    case 'ArrowLeft':
      if (inInput) return
      e.preventDefault()
      if (!state.recordMode && state.selection.size >= 1) {
        pushHistory()
        for (const idx of state.selection) state.markers[idx].depth = 0.0
        rebuildPath()
        renderMarkerList()
        renderMarkerProps()
      } else if (state.hasVideo) {
        const step = e.shiftKey ? 10 : 1
        video.currentTime = Math.max(0, video.currentTime - step / FPS)
      }
      break

    case 'ArrowUp':
      if (inInput) return
      e.preventDefault()
      if (!state.recordMode && state.selection.size >= 1) {
        pushHistory()
        for (const idx of state.selection) state.markers[idx].depth = 0.5
        rebuildPath()
        renderMarkerList()
        renderMarkerProps()
      }
      break

    case 'ArrowRight':
      if (inInput) return
      e.preventDefault()
      if (!state.recordMode && state.selection.size >= 1) {
        pushHistory()
        for (const idx of state.selection) state.markers[idx].depth = 1.0
        rebuildPath()
        renderMarkerList()
        renderMarkerProps()
      } else if (state.hasVideo) {
        const step = e.shiftKey ? 10 : 1
        video.currentTime = Math.min(
          state.duration,
          video.currentTime + step / FPS,
        )
      }
      break

    case 'ArrowDown':
      if (inInput) return
      e.preventDefault()
      // No-op but prevent scroll when a marker is selected
      break

    case 'a':
    case 'A':
      if (!inInput && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        selectAll()
      }
      break

    case 'c':
    case 'C':
      if (!inInput && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        copySelection()
      }
      break

    case 'x':
    case 'X':
      if (!inInput && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        copySelection()
        if (state.selectedEffectId) deleteSelectedEffect()
        else if (state.selection.size > 0) deleteSelected()
      }
      break

    case 'v':
    case 'V':
      if (!inInput && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        pasteSelection()
      }
      break

    case 'Escape':
      if (state.recordMode) {
        toggleRecordMode()
        break
      }
      selectEffect(null)
      clearSelection()
      break

    case '[':
      if (!inInput) jumpMarker(-1)
      break

    case ']':
      if (!inInput) jumpMarker(+1)
      break
  }
}

function jumpMarker(dir) {
  if (!state.hasVideo || state.markers.length === 0) return
  const curF = currentFrame()
  let target
  if (dir > 0) target = state.markers.find((m) => m.frame > curF)
  else target = [...state.markers].reverse().find((m) => m.frame < curF)
  if (target) video.currentTime = target.frame / FPS
}

// ── Record Mode ───────────────────────────────────────────────────────────────

function updateRecordBtn() {
  if (!state.hasVideo) return
  // Auto-exit record mode if video stops — but never disable the button itself
  if (state.recordMode && (video.paused || video.ended)) {
    state.recordMode = false
    const btn = document.getElementById('btnRecord')
    btn.classList.remove('record-active')
    btn.querySelector('.rec-label').textContent = 'Record'
    document.getElementById('recIndicator').style.display = 'none'
  }
}

function toggleRecordMode() {
  state.recordMode = !state.recordMode
  const btn = document.getElementById('btnRecord')
  btn.classList.toggle('record-active', state.recordMode)
  btn.querySelector('.rec-label').textContent = state.recordMode
    ? 'RECORDING'
    : 'Record'
  document.getElementById('recIndicator').style.display = state.recordMode
    ? 'flex'
    : 'none'
  // Always start playback when entering record mode, whether paused or not
  if (state.recordMode && state.hasVideo && video.paused) video.play()
}

// ── Scrub inputs (drag left/right to change value) ────────────────────────────
// Call after inserting HTML. Returns cleanup fn (optional).
// opts: { min, max, step, decimals, onchange }
function makeScrubInput(el, opts = {}) {
  if (!el) return
  const {
    min = -Infinity,
    max = Infinity,
    step = 1,
    decimals = 0,
    onchange,
  } = opts
  let scrubbing = false,
    startX = 0,
    startVal = 0

  el.style.cursor = 'ew-resize'
  el.title =
    (el.title ? el.title + ' · ' : '') + 'Drag to adjust · Double-click to type'

  function parseVal() {
    return parseFloat(el.value) || 0
  }

  function enterEditMode() {
    el.style.cursor = 'text'
    el.select()
  }

  function exitEditMode() {
    el.style.cursor = 'ew-resize'
    // Clamp and reformat the typed value
    const raw = parseFloat(el.value)
    if (!isNaN(raw)) {
      const clamped = Math.max(min, Math.min(max, raw))
      el.value = decimals > 0 ? clamped.toFixed(decimals) : Math.round(clamped)
      if (onchange) onchange(parseFloat(el.value))
    }
  }

  el.addEventListener('dblclick', (e) => {
    e.preventDefault()
    enterEditMode()
  })

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      exitEditMode()
      el.blur()
    }
    if (e.key === 'Escape') {
      el.blur()
    }
  })

  el.addEventListener('blur', () => {
    exitEditMode()
  })

  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    // Let double-click through; block single-click scrub only when not already focused
    if (document.activeElement === el) return // already in edit mode — let browser handle
    scrubbing = true
    startX = e.clientX
    startVal = parseVal()
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  })

  function onMove(e) {
    if (!scrubbing) return
    const dx = e.clientX - startX
    const accel = Math.abs(dx) > 50 ? 3 : 1
    const raw = startVal + dx * step * accel
    const clamped = Math.max(min, Math.min(max, raw))
    const rounded =
      decimals > 0
        ? parseFloat(clamped.toFixed(decimals))
        : Math.round(clamped / step) * step
    el.value = decimals > 0 ? rounded.toFixed(decimals) : rounded
    if (onchange) onchange(rounded)
  }

  function onUp() {
    if (!scrubbing) return
    scrubbing = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (onchange) onchange(parseVal())
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)

  el.addEventListener('focus', () => {
    if (document.activeElement === el) el.style.cursor = 'text'
  })

  return () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
}

// ── Effects ───────────────────────────────────────────────────────────────────

const FX_RULER_H = 20
const FX_TRACK_H = 34

const ALL_EFFECT_TYPES = [
  {
    type: 'text',
    label: 'Text Overlay',
    desc: 'Fading text on the preview',
    color: '#7060d0',
  },
  {
    type: 'pathColor',
    label: 'Path Color',
    desc: 'Animate path & ball color smoothly',
    color: '#3db88a',
  },
  {
    type: 'pathSpeed',
    label: 'Path Speed',
    desc: 'Change path playback speed (0.5x–4x)',
    color: '#d07030',
  },
]

function getEffectTypeInfo(type) {
  return (
    ALL_EFFECT_TYPES.find((t) => t.type === type) || {
      type,
      label: type,
      color: '#888',
      desc: '',
    }
  )
}

// ── Layer helpers ─────────────────────────────────────────────────────────────

function getMaxLayer() {
  if (state.effects.length === 0) return -1
  return Math.max(0, ...state.effects.map((e) => e.layer ?? 0))
}

function autoAssignLayer(startFrame, endFrame, excludeId = null) {
  for (let layer = 0; layer < 64; layer++) {
    const conflict = state.effects.some(
      (e) =>
        e.id !== excludeId &&
        (e.layer ?? 0) === layer &&
        !(endFrame <= e.startFrame || startFrame >= e.endFrame),
    )
    if (!conflict) return layer
  }
  return 0
}

// ── Color utilities ───────────────────────────────────────────────────────────

// ── Effect helpers ────────────────────────────────────────────────────────────

function getEffectFade(ef, frame) {
  if (frame < ef.startFrame || frame > ef.endFrame) return 0
  const dur = ef.endFrame - ef.startFrame
  const el = frame - ef.startFrame
  let alpha = 1.0
  const fi = ef.fadeIn ?? 0,
    fo = ef.fadeOut ?? 0
  if (fi > 0 && el < fi) alpha = Math.min(alpha, el / fi)
  if (fo > 0 && el > dur - fo) alpha = Math.min(alpha, (dur - el) / fo)
  return Math.max(0, Math.min(1, alpha))
}

function hexToRgbArr(hex) {
  const h = String(hex || '#888888')
    .replace(/[^0-9a-fA-F]/g, '')
    .padEnd(6, '0')
    .slice(0, 6)
  const n = parseInt(h, 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lerpRgbArr(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function getEffectiveColors(frame) {
  let pathRgb = hexToRgbArr('#f0b429')
  let ballRgb = hexToRgbArr('#ffffff')
  let bgRgb = null
  let bgOpaque = false
  for (const ef of state.effects) {
    if (ef.type !== 'pathColor') continue
    const fade = getEffectFade(ef, frame)
    if (fade <= 0) continue
    pathRgb = lerpRgbArr(pathRgb, hexToRgbArr(ef.pathColor || '#e05050'), fade)
    ballRgb = lerpRgbArr(ballRgb, hexToRgbArr(ef.ballColor || '#ffffff'), fade)
    if (ef.bgColor) {
      const target = hexToRgbArr(ef.bgColor)
      bgRgb = bgRgb
        ? lerpRgbArr(bgRgb, target, fade)
        : lerpRgbArr(hexToRgbArr('#0a0b0f'), target, fade)
      if (ef.bgOpaque) bgOpaque = true
    }
  }
  return { pathRgb, ballRgb, bgRgb, bgOpaque }
}

// ── Toggle fx panel ───────────────────────────────────────────────────────────

function toggleFxPanel() {
  state.fxVisible = !state.fxVisible
  const section = document.getElementById('fxSection')
  const handle = document.getElementById('fxResizeHandle')
  const btn = document.getElementById('btnToggleFx')
  section.style.display = state.fxVisible ? 'flex' : 'none'
  handle.style.display = state.fxVisible ? '' : 'none'
  // Set a sensible default height the first time it opens (~half the marker timeline)
  if (state.fxVisible && !section.dataset.hset) {
    section.style.height = Math.round(TL_H_DEFAULT / 2) + 'px'
    section.dataset.hset = '1'
  }
  btn.classList.toggle('active', state.fxVisible)
  btn.textContent = state.fxVisible ? '▾ EFFECTS' : '▸ EFFECTS'
  if (state.fxVisible) resizeFxCanvas()
  saveLayout()
}

// ── Effect management ─────────────────────────────────────────────────────────

const BUILTIN_FONTS = [
  'Rajdhani',
  'JetBrains Mono',
  'Arial',
  'Georgia',
  'Impact',
  'Trebuchet MS',
  'Courier New',
  'Verdana',
  'Times New Roman',
]

function defaultEffectProps(type) {
  if (type === 'text')
    return {
      text: 'New Text',
      font: 'Rajdhani',
      fontSize: 50,
      color: '#ffffff',
      opacity: 1.0,
      fadeIn: 30,
      fadeOut: 30,
      posX: 50,
      posY: 50,
    }
  if (type === 'pathColor')
    return {
      pathColor: '#e05050',
      ballColor: '#ffffff',
      bgColor: '#0a0b0f',
      bgOpaque: false,
      fadeIn: 60,
      fadeOut: 60,
    }
  if (type === 'pathSpeed')
    return {
      speed: 1.0,
      fadeIn: 0,
      fadeOut: 0,
    }
  return {}
}

function addEffect(type, startFrame, endFrame, forceLayer = null) {
  const layer =
    forceLayer !== null ? forceLayer : autoAssignLayer(startFrame, endFrame)
  const saved = loadLastEffectSettings(type)
  const ef = {
    id: newEffectId(),
    type,
    layer,
    startFrame,
    endFrame,
    ...defaultEffectProps(type),
    ...(saved || {}),
  }
  pushHistory()
  state.effects.push(ef)
  if (!state.fxVisible) toggleFxPanel()
  selectEffect(ef.id)
  updateExportLabel()
}

function deleteSelectedEffect() {
  if (!state.selectedEffectId) return
  pushHistory()
  state.effects = state.effects.filter((e) => e.id !== state.selectedEffectId)
  selectEffect(null)
  updateExportLabel()
}

function selectEffect(id) {
  state.selectedEffectId = id
  if (id) {
    state.selection.clear()
    state.lastClickedIdx = null
    renderMarkerList()
    switchPropsTab('effect')
  }
  renderEffectProps()
}

// ── Effect search popup ───────────────────────────────────────────────────────

let _fxSearchFrame = 0,
  _fxSearchLayer = 0

function showEffectSearch(clientX, clientY, frame, layer) {
  _fxSearchFrame = frame
  _fxSearchLayer = layer
  const popup = document.getElementById('fxSearchPopup')
  const input = document.getElementById('fxSearchInput')
  const pw = 230,
    ph = 180
  let left = clientX,
    top = clientY + 10
  if (left + pw > window.innerWidth) left = window.innerWidth - pw - 8
  if (top + ph > window.innerHeight) top = clientY - ph - 4
  popup.style.left = left + 'px'
  popup.style.top = top + 'px'
  popup.style.display = 'block'
  input.value = ''
  renderSearchResults('')
  setTimeout(() => input.focus(), 0)
}

function hideEffectSearch() {
  const popup = document.getElementById('fxSearchPopup')
  if (popup) popup.style.display = 'none'
}

function renderSearchResults(query) {
  const results = document.getElementById('fxSearchResults')
  const q = query.toLowerCase().trim()
  const matches = ALL_EFFECT_TYPES.filter(
    (t) =>
      !q ||
      t.label.toLowerCase().includes(q) ||
      t.desc.toLowerCase().includes(q),
  )
  if (matches.length === 0) {
    results.innerHTML = '<div class="fx-search-empty">No effects match</div>'
    return
  }
  results.innerHTML = matches
    .map(
      (t) =>
        `<div class="fx-search-item" data-type="${t.type}" style="--item-clr:${t.color}">
      <span class="fx-search-dot" style="background:${t.color}"></span>
      <div class="fx-search-text">
        <span class="fx-search-label">${t.label}</span>
        <span class="fx-search-desc">${t.desc}</span>
      </div>
    </div>`,
    )
    .join('')
  results.querySelectorAll('.fx-search-item').forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const type = el.dataset.type
      const start = Math.max(0, _fxSearchFrame - 30)
      const end = Math.min(
        Math.max(state.totalFrames - 1, start + 60),
        start + FPS * 3,
      )
      addEffect(type, start, end, _fxSearchLayer)
      hideEffectSearch()
    })
  })
}

// ── Props panel tabs ──────────────────────────────────────────────────────────

function switchPropsTab(tab) {
  document
    .getElementById('tabMarker')
    .classList.toggle('active', tab === 'marker')
  document
    .getElementById('tabEffect')
    .classList.toggle('active', tab === 'effect')
  document.getElementById('propsTabMarker').style.display =
    tab === 'marker' ? 'flex' : 'none'
  document.getElementById('propsTabEffect').style.display =
    tab === 'effect' ? 'flex' : 'none'
}

// ── Effect props panel ────────────────────────────────────────────────────────

function renderEffectProps() {
  const empty = document.getElementById('fxPropsEmpty')
  const form = document.getElementById('fxPropsForm')
  const selLabel = document.getElementById('fxSelLabel')

  if (!state.selectedEffectId) {
    selLabel.textContent = 'No selection'
    empty.style.display = ''
    form.innerHTML = ''
    form.style.display = 'none'
    return
  }

  const ef = state.effects.find((e) => e.id === state.selectedEffectId)
  if (!ef) {
    selectEffect(null)
    return
  }

  const typeInfo = getEffectTypeInfo(ef.type)
  selLabel.textContent = typeInfo.label
  empty.style.display = 'none'
  form.style.display = 'flex'

  const allFonts = [...BUILTIN_FONTS, ...state.customFonts.map((f) => f.family)]
  const fontOpts = allFonts
    .map(
      (f) =>
        `<option value="${f}"${ef.font === f ? ' selected' : ''}>${f}</option>`,
    )
    .join('')

  let typeFields = ''
  if (ef.type === 'text') {
    typeFields = `
      <div class="prop-row" style="align-items:flex-start">
        <label class="prop-label" style="padding-top:4px">Text</label>
        <textarea class="prop-textarea" id="fxText" rows="2">${escHtml(ef.text || '')}</textarea>
      </div>
      <div class="prop-row">
        <label class="prop-label">Font</label>
        <div style="display:flex;gap:4px;flex:1">
          <select class="prop-select" id="fxFont" style="flex:1">${fontOpts}</select>
          <button class="btn btn-ghost" style="height:26px;padding:0 8px;font-size:11px;flex-shrink:0" id="fxUploadFont">↑</button>
        </div>
      </div>
      <div class="prop-row">
        <label class="prop-label">Size</label>
        <input type="number" class="prop-input" id="fxFontSize" min="1" max="100" step="0.5" value="${ef.fontSize || 50}" style="width:70px">
        <span style="font-size:11px;color:var(--text3);margin-left:4px">% h</span>
      </div>
      <div class="prop-row">
        <label class="prop-label">Color</label>
        <input type="color" class="prop-color" id="fxColor" value="${ef.color || '#ffffff'}">
        <span class="prop-color-hex" id="fxColorHex"><input class="prop-hex-input" id="fxColorHexInput" value="${ef.color || '#ffffff'}"></span>
      </div>
      <div class="prop-row">
        <label class="prop-label">Opacity</label>
        <input type="range" class="prop-slider" id="fxOpacitySlider" min="0" max="1" step="0.05" value="${ef.opacity ?? 1}">
        <input type="text" class="prop-input prop-num" id="fxOpacity" value="${(ef.opacity ?? 1).toFixed(2)}" style="padding-right:10px">
      </div>
      <div class="prop-row">
        <label class="prop-label">Position</label>
        <div style="display:flex;gap:6px;align-items:center;flex:1">
          <span style="font-size:10px;color:var(--text3)">X</span>
          <input type="number" class="prop-input" id="fxPosX" min="0" max="100" step="1" value="${ef.posX ?? 50}" style="width:50px">
          <span style="font-size:10px;color:var(--text3)">Y</span>
          <input type="number" class="prop-input" id="fxPosY" min="0" max="100" step="1" value="${ef.posY ?? 80}" style="width:50px">
          <span style="font-size:10px;color:var(--text3)">%</span>
        </div>
      </div>`
  }
  if (ef.type === 'pathColor') {
    typeFields = `
      <div class="prop-row">
        <label class="prop-label">Path</label>
        <input type="color" class="prop-color" id="fxPathColor" value="${ef.pathColor || '#e05050'}">
        <span class="prop-color-hex" id="fxPathColorHex"><input class="prop-hex-input" id="fxPathColorHexInput" value="${ef.pathColor || '#e05050'}"></span>
      </div>
      <div class="prop-row">
        <label class="prop-label">Ball</label>
        <input type="color" class="prop-color" id="fxBallColor" value="${ef.ballColor || '#ffffff'}">
        <span class="prop-color-hex" id="fxBallColorHex"><input class="prop-hex-input" id="fxBallColorHexInput" value="${ef.ballColor || '#ffffff'}"></span>
      </div>
      <div class="prop-row">
        <label class="prop-label">Background</label>
        <input type="color" class="prop-color" id="fxBgColor" value="${ef.bgColor || '#0a0b0f'}">
        <span class="prop-color-hex" id="fxBgColorHex"><input class="prop-hex-input" id="fxBgColorHexInput" value="${ef.bgColor || '#0a0b0f'}"></span>
        <label style="font-size:10px;color:var(--text3);display:flex;align-items:center;gap:3px;margin-left:4px">
          <input type="checkbox" id="fxBgOpaque" ${ef.bgOpaque ? 'checked' : ''}> solid
        </label>
      </div>`
  }
  if (ef.type === 'pathSpeed') {
    const speedSteps = [
      0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5, 4.0,
    ]
    const speedOpts = speedSteps
      .map(
        (s) =>
          `<option value="${s}"${(ef.speed || 1.0) === s ? ' selected' : ''}>${s}×</option>`,
      )
      .join('')
    typeFields = `
      <div class="prop-row">
        <label class="prop-label">Speed</label>
        <select class="prop-select" id="fxSpeed">${speedOpts}</select>
      </div>`
  }

  form.innerHTML = `
    <div class="prop-row">
      <label class="prop-label">Start F</label>
      <input type="number" class="prop-input" id="fxStart" min="0" step="1" value="${ef.startFrame}" style="width:80px">
    </div>
    <div class="prop-row">
      <label class="prop-label">End F</label>
      <input type="number" class="prop-input" id="fxEnd" min="0" step="1" value="${ef.endFrame}" style="width:80px">
    </div>
    ${typeFields}
    <div class="prop-row">
      <label class="prop-label">Fade In</label>
      <input type="number" class="prop-input" id="fxFadeIn" min="0" step="1" value="${ef.fadeIn ?? 0}" style="width:70px">
      <span style="font-size:11px;color:var(--text3);margin-left:4px">frames</span>
    </div>
    <div class="prop-row">
      <label class="prop-label">Fade Out</label>
      <input type="number" class="prop-input" id="fxFadeOut" min="0" step="1" value="${ef.fadeOut ?? 0}" style="width:70px">
      <span style="font-size:11px;color:var(--text3);margin-left:4px">frames</span>
    </div>
    <div class="prop-row prop-row-actions">
      <button class="btn btn-danger-sm" id="fxDeleteBtn">Delete Effect</button>
    </div>`

  // wireC: change listener that also persists settings after each change
  const wireC = (id, fn) => {
    const el = document.getElementById(id)
    if (el)
      el.addEventListener('change', (ev) => {
        fn(ev)
        saveLastEffectSettings(ef.type, ef)
      })
  }

  // Scrub-wire all frame number inputs
  const g = (id) => document.getElementById(id)
  makeScrubInput(g('fxStart'), {
    min: 0,
    max: state.totalFrames - 1,
    step: 1,
    onchange: (v) => {
      ef.startFrame = Math.round(v)
      if (ef.startFrame >= ef.endFrame) ef.endFrame = ef.startFrame + 1
    },
  })
  makeScrubInput(g('fxEnd'), {
    min: 1,
    max: state.totalFrames,
    step: 1,
    onchange: (v) => {
      ef.endFrame = Math.max(ef.startFrame + 1, Math.round(v))
    },
  })
  makeScrubInput(g('fxFadeIn'), {
    min: 0,
    max: 600,
    step: 1,
    onchange: (v) => {
      ef.fadeIn = Math.max(0, Math.round(v))
    },
  })
  makeScrubInput(g('fxFadeOut'), {
    min: 0,
    max: 600,
    step: 1,
    onchange: (v) => {
      ef.fadeOut = Math.max(0, Math.round(v))
    },
  })

  wireC('fxStart', (e) => {
    ef.startFrame = Math.max(0, parseInt(e.target.value) || 0)
    if (ef.startFrame >= ef.endFrame) ef.endFrame = ef.startFrame + 1
  })
  wireC('fxEnd', (e) => {
    ef.endFrame = Math.max(ef.startFrame + 1, parseInt(e.target.value) || 1)
  })
  wireC('fxFadeIn', (e) => {
    ef.fadeIn = Math.max(0, parseInt(e.target.value) || 0)
  })
  wireC('fxFadeOut', (e) => {
    ef.fadeOut = Math.max(0, parseInt(e.target.value) || 0)
  })
  document
    .getElementById('fxDeleteBtn')
    .addEventListener('click', deleteSelectedEffect)

  if (ef.type === 'text') {
    wireC('fxText', (e) => {
      ef.text = e.target.value
    })
    wireC('fxFont', (e) => {
      ef.font = e.target.value
    })
    wireC('fxFontSize', (e) => {
      ef.fontSize = Math.max(1, parseFloat(e.target.value) || 8)
    })
    wireC('fxPosX', (e) => {
      ef.posX = Math.max(0, Math.min(100, parseInt(e.target.value) || 50))
    })
    wireC('fxPosY', (e) => {
      ef.posY = Math.max(0, Math.min(100, parseInt(e.target.value) || 80))
    })
    // Scrub size and position
    makeScrubInput(g('fxFontSize'), {
      min: 1,
      max: 100,
      step: 0.5,
      decimals: 1,
      onchange: (v) => {
        ef.fontSize = Math.max(1, v)
      },
    })
    makeScrubInput(g('fxPosX'), {
      min: 0,
      max: 100,
      step: 0.5,
      decimals: 1,
      onchange: (v) => {
        ef.posX = Math.max(0, Math.min(100, v))
      },
    })
    makeScrubInput(g('fxPosY'), {
      min: 0,
      max: 100,
      step: 0.5,
      decimals: 1,
      onchange: (v) => {
        ef.posY = Math.max(0, Math.min(100, v))
      },
    })
    wireColorInput(
      'fxColor',
      'fxColorHexInput',
      () => ef.color,
      (v) => {
        ef.color = v
        saveLastEffectSettings(ef.type, ef)
      },
    )
    const opS = document.getElementById('fxOpacitySlider'),
      opI = document.getElementById('fxOpacity')
    opS.addEventListener('input', (e) => {
      ef.opacity = parseFloat(e.target.value)
      opI.value = ef.opacity.toFixed(2)
      saveLastEffectSettings(ef.type, ef)
    })
    opI.addEventListener('change', (e) => {
      const v = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0))
      ef.opacity = v
      opS.value = v
      opI.value = v.toFixed(2)
    })
    document
      .getElementById('fxUploadFont')
      .addEventListener('click', () =>
        document.getElementById('fileInputFont').click(),
      )
  }
  if (ef.type === 'pathSpeed') {
    wireC('fxSpeed', (e) => {
      ef.speed = parseFloat(e.target.value) || 1.0
    })
  }
  if (ef.type === 'pathColor') {
    wireColorInput(
      'fxPathColor',
      'fxPathColorHexInput',
      () => ef.pathColor,
      (v) => {
        ef.pathColor = v
        saveLastEffectSettings(ef.type, ef)
      },
    )
    wireColorInput(
      'fxBallColor',
      'fxBallColorHexInput',
      () => ef.ballColor,
      (v) => {
        ef.ballColor = v
        saveLastEffectSettings(ef.type, ef)
      },
    )
    const bgE = document.getElementById('fxBgColor')
    wireColorInput(
      'fxBgColor',
      'fxBgColorHexInput',
      () => ef.bgColor,
      (v) => {
        ef.bgColor = v
        bgE.value = v
        saveLastEffectSettings(ef.type, ef)
      },
    )
    document.getElementById('fxBgOpaque').addEventListener('change', (e) => {
      ef.bgOpaque = e.target.checked
      saveLastEffectSettings(ef.type, ef)
    })
  }
}

// ── Hex color input helper ────────────────────────────────────────────────────
// Wires a color picker + editable hex text input together.
// The hex input accepts typed/pasted values; Ctrl+C/V/A are blocked from
// bubbling so they don't trigger the global marker clipboard.
function wireColorInput(pickerId, hexId, getter, setter) {
  const picker = document.getElementById(pickerId)
  const hexEl = document.getElementById(hexId)
  if (!picker || !hexEl) return

  // Picker → hex input + setter
  picker.addEventListener('input', (e) => {
    hexEl.value = e.target.value
    setter(e.target.value)
  })

  // Hex input: block clipboard shortcuts from reaching the global handler
  hexEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hexEl.value = getter()
      hexEl.blur()
      return
    }
    if (e.ctrlKey || e.metaKey) e.stopPropagation()
  })
  hexEl.addEventListener('focus', () => hexEl.select())

  // Commit on Enter or blur — parse and sync both picker and setter
  function commitHex() {
    let v = hexEl.value.trim()
    if (!v.startsWith('#')) v = '#' + v
    // Expand shorthand #abc → #aabbcc
    if (/^#[0-9a-fA-F]{3}$/.test(v))
      v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      picker.value = v
      setter(v)
      hexEl.value = v
    } else {
      // Invalid — revert to current value
      hexEl.value = getter()
    }
  }
  hexEl.addEventListener('change', commitHex)
  hexEl.addEventListener('blur', commitHex)
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Effects timeline coordinates (share main timeline scroll/zoom) ────────────

function fxFrameToX(frame) {
  return frameToTlX(frame)
}
function fxXToFrame(x) {
  return tlXToFrame(x)
}

function getFxEffectAtPos(x, y) {
  const layerIdx = Math.floor((y - FX_RULER_H) / FX_TRACK_H)
  if (layerIdx < 0) return null
  const EDGE = 8
  for (const ef of state.effects) {
    if ((ef.layer ?? 0) !== layerIdx) continue
    const x1 = fxFrameToX(ef.startFrame),
      x2 = fxFrameToX(ef.endFrame)
    if (x < x1 - EDGE || x > x2 + EDGE) continue
    if (x < x1 + EDGE) return { effectId: ef.id, zone: 'start' }
    if (x > x2 - EDGE) return { effectId: ef.id, zone: 'end' }
    return { effectId: ef.id, zone: 'body' }
  }
  return null
}

// ── Effects timeline rendering ────────────────────────────────────────────────

function renderFxTimeline() {
  if (!fxCanvas || !fxCtx || !state.fxVisible) return
  const W = fxCanvas.width,
    H = fxCanvas.height,
    ctx = fxCtx
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#0d0d10'
  ctx.fillRect(0, 0, W, H)

  if (state.totalFrames === 0) {
    ctx.fillStyle = '#333'
    ctx.font = `11px 'JetBrains Mono',monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Load a video to use effects', W / 2, H / 2)
    return
  }

  // ── Ruler ─────────────────────────────────────────────────────────────────────
  ctx.fillStyle = '#141418'
  ctx.fillRect(0, 0, W, FX_RULER_H)
  ctx.strokeStyle = '#222228'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, FX_RULER_H)
  ctx.lineTo(W, FX_RULER_H)
  ctx.stroke()

  const ppf = pixelsPerFrame()
  const minTickPx = 70
  const tickC = [
    1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 14400,
  ]
  let tickEvery = tickC[tickC.length - 1]
  for (const c of tickC) {
    if (c * ppf >= minTickPx) {
      tickEvery = c
      break
    }
  }
  const firstTick =
    Math.ceil(Math.floor(state.timelineScrollX / ppf) / tickEvery) * tickEvery
  const lastTick = Math.ceil((state.timelineScrollX + W) / ppf)

  ctx.font = `9px 'JetBrains Mono',monospace`
  ctx.textBaseline = 'middle'
  for (let f = firstTick; f <= lastTick + tickEvery; f += tickEvery) {
    const x = Math.round(fxFrameToX(f)) + 0.5
    if (x < -1 || x > W + 1) continue
    ctx.strokeStyle = '#2a2a32'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, FX_RULER_H - 5)
    ctx.lineTo(x, FX_RULER_H)
    ctx.stroke()
    const secs = f / FPS,
      mm = Math.floor(secs / 60),
      ss = Math.floor(secs % 60)
    ctx.fillStyle = '#444456'
    ctx.textAlign = 'left'
    ctx.fillText(`${pad(mm)}:${pad(ss)}`, x + 3, FX_RULER_H / 2)
  }

  // ── Dynamic layers ────────────────────────────────────────────────────────────
  const numLayers = Math.max(1, getMaxLayer() + 2)
  for (let li = 0; li < numLayers; li++) {
    const ty = FX_RULER_H + li * FX_TRACK_H
    if (ty >= H) break
    ctx.fillStyle = li % 2 === 0 ? '#111115' : '#0e0e12'
    ctx.fillRect(0, ty, W, FX_TRACK_H)
    ctx.strokeStyle = '#1e1e24'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, ty + FX_TRACK_H - 0.5)
    ctx.lineTo(W, ty + FX_TRACK_H - 0.5)
    ctx.stroke()
    // Empty layer hint
    if (!state.effects.some((e) => (e.layer ?? 0) === li)) {
      ctx.fillStyle = '#1c1c22'
      ctx.font = `9px 'JetBrains Mono',monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('double-click to add effect', W / 2, ty + FX_TRACK_H / 2)
    }
  }

  // ── Effect blocks ─────────────────────────────────────────────────────────────
  for (const ef of state.effects) {
    const li = ef.layer ?? 0
    const ty = FX_RULER_H + li * FX_TRACK_H
    if (ty >= H) continue
    const x1 = Math.round(fxFrameToX(ef.startFrame))
    const x2 = Math.round(fxFrameToX(ef.endFrame))
    const isSel = ef.id === state.selectedEffectId
    const isHov = ef.id === fxHoverEffectId
    const { color } = getEffectTypeInfo(ef.type)
    const cx1 = Math.max(0, x1),
      cx2 = Math.min(W, x2)
    if (cx2 <= cx1) continue
    const bY = ty + 3,
      bH = FX_TRACK_H - 6

    ctx.fillStyle = isSel ? color : isHov ? color + 'bb' : color + '55'
    ctx.beginPath()
    ctx.roundRect(cx1, bY, cx2 - cx1, bH, 3)
    ctx.fill()
    if (isSel) {
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.5
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // Fade overlays
    if (ef.fadeIn > 0) {
      const fw = Math.min(ef.fadeIn * ppf, cx2 - cx1)
      const gi = ctx.createLinearGradient(cx1, 0, cx1 + fw, 0)
      gi.addColorStop(0, 'rgba(0,0,0,0.5)')
      gi.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = gi
      ctx.beginPath()
      ctx.roundRect(cx1, bY, fw, bH, 3)
      ctx.fill()
    }
    if (ef.fadeOut > 0) {
      const fw = Math.min(ef.fadeOut * ppf, cx2 - cx1)
      const go = ctx.createLinearGradient(cx2 - fw, 0, cx2, 0)
      go.addColorStop(0, 'rgba(0,0,0,0)')
      go.addColorStop(1, 'rgba(0,0,0,0.5)')
      ctx.fillStyle = go
      ctx.beginPath()
      ctx.roundRect(cx2 - fw, bY, fw, bH, 3)
      ctx.fill()
    }

    // Label
    if (cx2 - cx1 > 18) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(cx1 + 4, bY, cx2 - cx1 - 8, bH)
      ctx.clip()
      ctx.font = `${isSel ? 'bold ' : ''}10px 'JetBrains Mono',monospace`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = isSel ? '#fff' : 'rgba(255,255,255,0.8)'
      const lbl =
        ef.type === 'text'
          ? `"${String(ef.text || 'Text').substring(0, 20)}"`
          : ef.type === 'pathColor'
            ? `color → ${ef.pathColor || '?'}`
            : getEffectTypeInfo(ef.type).label
      ctx.fillText(lbl, cx1 + 6, ty + FX_TRACK_H / 2)
      ctx.restore()
    }

    // Resize handles
    if (isSel || isHov) {
      ;[
        [x1, 'start'],
        [x2, 'end'],
      ].forEach(([hx, zone]) => {
        const hxC = Math.max(2, Math.min(W - 2, hx))
        ctx.fillStyle = '#fff'
        ctx.globalAlpha = fxHoverZone === zone ? 0.9 : 0.3
        ctx.beginPath()
        ctx.roundRect(hxC - 2, bY + 4, 4, bH - 8, 2)
        ctx.fill()
        ctx.globalAlpha = 1
      })
    }
  }

  // ── Playhead ──────────────────────────────────────────────────────────────────
  const px = fxFrameToX(currentFrame())
  if (px >= 0 && px <= W) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(px + 0.5, 0)
    ctx.lineTo(px + 0.5, H)
    ctx.stroke()
  }
}

// ── Effects timeline mouse ────────────────────────────────────────────────────

function onFxMouseDown(e) {
  if (e.button !== 0) return
  const rect = fxCanvas.getBoundingClientRect()
  const x = e.clientX - rect.left,
    y = e.clientY - rect.top
  const hit = getFxEffectAtPos(x, y)
  if (hit) {
    const ef = state.effects.find((ef) => ef.id === hit.effectId)
    if (!ef) return
    selectEffect(hit.effectId)
    fxDrag.active = true
    fxDrag.effectId = hit.effectId
    fxDrag.mode =
      hit.zone === 'start'
        ? 'resizeStart'
        : hit.zone === 'end'
          ? 'resizeEnd'
          : 'move'
    fxDrag.startX = x
    fxDrag.origStart = ef.startFrame
    fxDrag.origEnd = ef.endFrame
    fxDrag.origLayer = ef.layer ?? 0
    fxDrag.passedNeighbours = new Map()
    document.body.style.cursor = hit.zone === 'body' ? 'grabbing' : 'ew-resize'
    document.body.style.userSelect = 'none'
  } else {
    // Seek on click and keep seeking while dragging (mirrors marker timeline behaviour)
    fxDrag.seekingPlayhead = true
    if (state.hasVideo) {
      const frame = Math.max(0, Math.min(state.totalFrames - 1, fxXToFrame(x)))
      video.currentTime = frame / FPS
    }
    selectEffect(null)
    document.body.style.userSelect = 'none'
  }
}

function onFxMouseMove(e) {
  const rect = fxCanvas.getBoundingClientRect()
  const x = e.clientX - rect.left,
    y = e.clientY - rect.top
  if (fxDrag.active) {
    const ef = state.effects.find((ef) => ef.id === fxDrag.effectId)
    if (!ef) return
    const fd = Math.round((x - fxDrag.startX) / pixelsPerFrame())
    const maxF = Math.max(state.totalFrames - 1, 0)

    if (fxDrag.mode === 'move') {
      const dur = fxDrag.origEnd - fxDrag.origStart
      const newLayer = Math.max(0, Math.floor((y - FX_RULER_H) / FX_TRACK_H))
      let s = Math.max(0, Math.min(maxF - dur, fxDrag.origStart + fd))
      let end = s + dur
      // Collide: push away from any neighbour on the same layer
      s = fxCollideMove(ef.id, newLayer, s, end)
      ef.startFrame = s
      ef.endFrame = s + dur
      ef.layer = newLayer
    } else if (fxDrag.mode === 'resizeStart') {
      let s = Math.max(0, Math.min(fxDrag.origEnd - 1, fxDrag.origStart + fd))
      // Collide left edge: can't push past a neighbour to the left
      s = fxCollideResizeStart(ef.id, ef.layer ?? 0, s, ef.endFrame)
      ef.startFrame = s
    } else {
      let end = Math.max(
        fxDrag.origStart + 1,
        Math.min(maxF, fxDrag.origEnd + fd),
      )
      // Collide right edge: can't push past a neighbour to the right
      end = fxCollideResizeEnd(ef.id, ef.layer ?? 0, ef.startFrame, end)
      ef.endFrame = end
    }
    return
  }
  // Continue seeking while dragging on empty area
  if (fxDrag.seekingPlayhead && state.hasVideo) {
    const frame = Math.max(0, Math.min(state.totalFrames - 1, fxXToFrame(x)))
    video.currentTime = frame / FPS
    return
  }
  const hit = getFxEffectAtPos(x, y)
  fxHoverEffectId = hit ? hit.effectId : null
  fxHoverZone = hit ? hit.zone : null
  fxCanvas.style.cursor = !hit
    ? 'crosshair'
    : hit.zone === 'body'
      ? 'grab'
      : 'ew-resize'
}

// ── Effect collision helpers ──────────────────────────────────────────────────

/** Neighbours on a given layer, excluding the dragged effect itself. */
function fxNeighbours(excludeId, layer) {
  return state.effects
    .filter((e) => e.id !== excludeId && (e.layer ?? 0) === layer)
    .sort((a, b) => a.startFrame - b.startFrame)
}

/**
 * Resolve a full-block move so it doesn't overlap any neighbour.
 * If the desired position overlaps something, push the block to the nearest
 * free gap — preferring the direction of travel (left or right).
 */
function fxCollideMove(id, layer, desiredStart, desiredEnd) {
  const dur = desiredEnd - desiredStart
  const neighbours = fxNeighbours(id, layer)
  if (neighbours.length === 0) return desiredStart

  // Compare to the effect's *current* position, not origStart, so direction
  // is correct even after passing through a neighbour and coming back.
  const ef = state.effects.find((e) => e.id === id)
  const movingRight = desiredStart >= (ef ? ef.startFrame : fxDrag.origStart)

  // Update passedNeighbours: detect when block has fully cleared a neighbour
  for (const n of neighbours) {
    const alreadyPassed = fxDrag.passedNeighbours.has(n.id)
    if (!alreadyPassed) {
      if (n.startFrame >= fxDrag.origEnd && desiredStart >= n.endFrame) {
        fxDrag.passedNeighbours.set(n.id, 'right')
      }
      if (n.endFrame <= fxDrag.origStart && desiredEnd <= n.startFrame) {
        fxDrag.passedNeighbours.set(n.id, 'left')
      }
    } else {
      const dir = fxDrag.passedNeighbours.get(n.id)
      if (dir === 'right' && desiredStart < n.startFrame) {
        fxDrag.passedNeighbours.delete(n.id)
      }
      if (dir === 'left' && desiredEnd > n.endFrame) {
        fxDrag.passedNeighbours.delete(n.id)
      }
    }
  }

  if (movingRight) {
    let barrier = Infinity
    for (const n of neighbours) {
      const passed = fxDrag.passedNeighbours.get(n.id)
      const isBarrier =
        (!passed &&
          n.startFrame >= fxDrag.origEnd &&
          desiredStart < n.endFrame) ||
        (passed === 'left' && desiredStart < n.startFrame)
      if (isBarrier && n.startFrame < barrier) barrier = n.startFrame
    }
    return barrier === Infinity
      ? desiredStart
      : Math.min(desiredStart, barrier - dur)
  } else {
    let barrier = -Infinity
    for (const n of neighbours) {
      const passed = fxDrag.passedNeighbours.get(n.id)
      const isBarrier =
        (!passed &&
          n.endFrame <= fxDrag.origStart &&
          desiredEnd > n.startFrame) ||
        (passed === 'right' && desiredEnd > n.endFrame)
      if (isBarrier && n.endFrame > barrier) barrier = n.endFrame
    }
    return barrier === -Infinity
      ? desiredStart
      : Math.max(desiredStart, barrier)
  }
}

/** Prevent the start edge being dragged into a neighbour to the left. */
function fxCollideResizeStart(id, layer, desiredStart, endFrame) {
  const neighbours = fxNeighbours(id, layer)
  // Find the rightmost neighbour that ends at or before endFrame
  let barrier = 0
  for (const n of neighbours) {
    if (n.endFrame <= endFrame && n.endFrame > barrier) barrier = n.endFrame
  }
  return Math.max(desiredStart, barrier)
}

/** Prevent the end edge being dragged into a neighbour to the right. */
function fxCollideResizeEnd(id, layer, startFrame, desiredEnd) {
  const neighbours = fxNeighbours(id, layer)
  // Find the leftmost neighbour that starts at or after startFrame
  let barrier = Infinity
  for (const n of neighbours) {
    if (n.startFrame >= startFrame && n.startFrame < barrier)
      barrier = n.startFrame
  }
  return Math.min(desiredEnd, barrier === Infinity ? desiredEnd : barrier)
}

function onFxMouseLeave() {
  fxHoverEffectId = null
  fxHoverZone = null
}

function onFxDblClick(e) {
  if (fxDrag.active) return
  const rect = fxCanvas.getBoundingClientRect()
  const x = e.clientX - rect.left,
    y = e.clientY - rect.top
  if (getFxEffectAtPos(x, y)) return
  const frame = fxXToFrame(x)
  const layer = Math.max(0, Math.floor((y - FX_RULER_H) / FX_TRACK_H))
  showEffectSearch(e.clientX, e.clientY, frame, layer)
}

document.addEventListener('mouseup', () => {
  if (fxDrag.active || fxDrag.seekingPlayhead) {
    fxDrag.active = false
    fxDrag.seekingPlayhead = false
    if (fxCanvas) fxCanvas.style.cursor = ''
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
})

document.addEventListener(
  'mousedown',
  (ev) => {
    const popup = document.getElementById('fxSearchPopup')
    if (popup && popup.style.display !== 'none' && !popup.contains(ev.target))
      hideEffectSearch()
  },
  true,
)

// ── Copy / Paste ──────────────────────────────────────────────────────────────
//
// The clipboard holds either:
//   { kind: 'markers', items: [{frame, depth, trans, ease}], anchorFrame }
//   { kind: 'effect',  item: {...effect object} }
//
// Pasting markers offsets them so the first marker lands at the current
// playhead. Pasting an effect places it starting at the playhead.

let _clipboard = null

function copySelection() {
  // Effect takes priority if one is selected
  if (state.selectedEffectId) {
    const ef = state.effects.find((e) => e.id === state.selectedEffectId)
    if (!ef) return
    _clipboard = { kind: 'effect', item: JSON.parse(JSON.stringify(ef)) }
    flashClipboardMsg('Copied effect')
    return
  }

  if (state.selection.size === 0) return
  const sorted = [...state.selection]
    .map((i) => state.markers[i])
    .filter(Boolean)
    .sort((a, b) => a.frame - b.frame)
  if (sorted.length === 0) return

  _clipboard = {
    kind: 'markers',
    items: sorted.map((m) => ({ ...m })),
    anchorFrame: sorted[0].frame, // first marker's frame is the paste anchor
  }
  flashClipboardMsg(
    `Copied ${sorted.length} marker${sorted.length > 1 ? 's' : ''}`,
  )
}

function pasteSelection() {
  if (!_clipboard) return

  if (_clipboard.kind === 'effect') {
    const src = _clipboard.item
    const dur = src.endFrame - src.startFrame
    const pasteStart = state.hasVideo ? currentFrame() : src.startFrame
    const pasteEnd = pasteStart + dur
    const layer = autoAssignLayer(pasteStart, pasteEnd)
    const pasted = {
      ...JSON.parse(JSON.stringify(src)),
      id: newEffectId(),
      layer,
      startFrame: pasteStart,
      endFrame: pasteEnd,
    }
    pushHistory()
    state.effects.push(pasted)
    if (!state.fxVisible) toggleFxPanel()
    selectEffect(pasted.id)
    updateExportLabel()
    flashClipboardMsg('Pasted effect')
    return
  }

  if (_clipboard.kind === 'markers' && _clipboard.items.length > 0) {
    const offset =
      (state.hasVideo ? currentFrame() : 0) - _clipboard.anchorFrame
    const newMarkers = _clipboard.items
      .map((m) => ({
        ...m,
        frame: Math.max(
          0,
          Math.min(Math.max(state.totalFrames - 1, 0), m.frame + offset),
        ),
      }))
      // Skip frames already occupied
      .filter(
        (m) => !state.markers.some((existing) => existing.frame === m.frame),
      )

    if (newMarkers.length === 0) {
      flashClipboardMsg('Nothing to paste (frames occupied)')
      return
    }

    pushHistory()
    state.markers.push(...newMarkers)
    sortMarkers()
    // Select the pasted markers
    state.selection.clear()
    for (const nm of newMarkers) {
      const idx = state.markers.findIndex((m) => m.frame === nm.frame)
      if (idx >= 0) state.selection.add(idx)
    }
    state.lastClickedIdx = null
    rebuildPath()
    renderMarkerList()
    renderMarkerProps()
    updateMarkerCount()
    flashClipboardMsg(
      `Pasted ${newMarkers.length} marker${newMarkers.length > 1 ? 's' : ''}`,
    )
  }
}

function flashClipboardMsg(text) {
  // Reuse the toolbar frame badge area for a brief flash message
  const el = document.getElementById('clipboardMsg')
  if (!el) return
  el.textContent = text
  el.style.opacity = '1'
  clearTimeout(el._timer)
  el._timer = setTimeout(() => {
    el.style.opacity = '0'
  }, 1800)
}

// ── Metadata Modal ────────────────────────────────────────────────────────────

function openMetaModal() {
  document.getElementById('metaTitle').value = state.meta.title || ''
  document.getElementById('metaPathCreator').value =
    state.meta.path_creator || ''
  document.getElementById('metaBpm').value = state.meta.bpm || ''
  document.getElementById('metaRelatedMedia').value =
    state.meta.related_media || ''
  document.getElementById('metaVideoUrl').value = state.meta.video_url || ''
  document.getElementById('metaOverlay').style.display = 'flex'
  document.getElementById('metaTitle').focus()
}

function closeMetaModal() {
  document.getElementById('metaOverlay').style.display = 'none'
}

async function saveMetaModal() {
  state.meta.title = document.getElementById('metaTitle').value.trim()
  state.meta.path_creator = document
    .getElementById('metaPathCreator')
    .value.trim()
  state.meta.bpm = document.getElementById('metaBpm').value.trim()
  state.meta.related_media = document
    .getElementById('metaRelatedMedia')
    .value.trim()
  state.meta.video_url = document.getElementById('metaVideoUrl').value.trim()
  closeMetaModal()

  // If the file was opened with showOpenFilePicker we have a writable handle —
  // write the updated content straight back without showing a save-as dialog.
  if (_openFileHandle) {
    try {
      const markerData = {}
      for (const m of state.markers) {
        markerData[String(m.frame)] = [m.depth, m.trans, m.ease, 0]
      }
      const metaObj = { version: 2, marker_fields: ['depth', 'trans', 'ease', 'auxiliary'] }
      if (state.meta.title)         metaObj.title         = state.meta.title
      if (state.meta.path_creator)  metaObj.path_creator  = state.meta.path_creator
      if (state.meta.bpm !== '')    metaObj.bpm            = parseFloat(state.meta.bpm) || state.meta.bpm
      if (state.meta.related_media) metaObj.related_media = state.meta.related_media
      if (state.meta.video_url)     metaObj.video_url     = state.meta.video_url
      const content = JSON.stringify({ meta: metaObj, markers: markerData, effects: state.effects }, null, 2)
      const writable = await _openFileHandle.createWritable()
      await writable.write(content)
      await writable.close()
      flashClipboardMsg('Metadata saved & file updated')
    } catch (err) {
      flashClipboardMsg('Metadata saved (file write failed)')
      console.error('Auto-save failed:', err)
    }
  } else {
    flashClipboardMsg('Metadata saved')
  }
}

// ── Clean markers ─────────────────────────────────────────────────────────────
//
// Remove redundant middle markers from runs of 3+ consecutive markers with
// the same depth. E.g. [0.5, 0.5, 0.5] → delete the middle one;
// [0.5, 0.5, 0.5, 0.5] → delete the two middle ones.
// The first and last of each run are kept to preserve the shape of the path.

function cleanMarkers() {
  if (state.markers.length < 3) {
    flashClipboardMsg('Nothing to clean')
    return
  }

  // markers are always sorted by frame; find indices to remove
  const toRemove = new Set()
  let i = 0
  while (i < state.markers.length) {
    const depth = state.markers[i].depth
    // Find the end of the run at this depth
    let j = i + 1
    while (j < state.markers.length && state.markers[j].depth === depth) j++
    const runLength = j - i
    // If 3 or more in a row, mark all interior ones for removal
    if (runLength >= 3) {
      for (let k = i + 1; k < j - 1; k++) toRemove.add(k)
    }
    i = j
  }

  if (toRemove.size === 0) {
    flashClipboardMsg('No redundant markers found')
    return
  }

  pushHistory()
  state.markers = state.markers.filter((_, idx) => !toRemove.has(idx))
  state.selection.clear()
  state.lastClickedIdx = null
  rebuildPath()
  renderMarkerList()
  renderMarkerProps()
  updateMarkerCount()
  flashClipboardMsg(`Cleaned ${toRemove.size} redundant marker${toRemove.size > 1 ? 's' : ''}`)
}

// ── BPM Cycle Generator ───────────────────────────────────────────────────────
//
// Places depth-0 markers from the playhead to the end of the video at the
// given BPM. Because BPM is often not evenly divisible into whole frames, a
// Bresenham-style accumulator is used: each beat's ideal position is computed
// as a float (startFrame + n × framesPerBeat) and rounded to the nearest
// integer. This means rounding error never compounds — each beat independently
// corrects for the drift of the previous one.

function openCycleDialog() {
  const overlay = document.getElementById('bpmOverlay')
  overlay.style.display = 'flex'
  const input = document.getElementById('bpmInput')
  input.select()
  input.focus()
  updateCyclePreview()
}

function closeCycleDialog() {
  document.getElementById('bpmOverlay').style.display = 'none'
}

function computeCycleFrames(bpm, startFrame, maxCount = Infinity) {
  if (bpm <= 0 || !isFinite(bpm) || state.totalFrames === 0) return []
  const framesPerBeat = (60 / bpm) * FPS
  const endFrame = state.totalFrames - 1
  const frames = []
  let beatIndex = 0
  while (true) {
    if (frames.length >= maxCount) break
    const idealFrame = startFrame + beatIndex * framesPerBeat
    const f = Math.round(idealFrame)
    if (f > endFrame) break
    frames.push(f)
    beatIndex++
  }
  return frames
}

function updateCyclePreview() {
  const bpm = parseFloat(document.getElementById('bpmInput').value) || 120
  const countRaw = document.getElementById('bpmCountInput').value.trim()
  const maxCount =
    countRaw === '' ? Infinity : Math.max(1, parseInt(countRaw) || 1)
  const start = currentFrame()
  const fpb = (60 / bpm) * FPS
  const frames = computeCycleFrames(bpm, start, maxCount)
  const newCount = frames.filter(
    (f) => !state.markers.some((m) => m.frame === f),
  ).length
  const skipCount = frames.length - newCount
  const drift = fpb % 1
  const driftMs = ((drift * 1000) / FPS).toFixed(1)

  let msg = `<b>${frames.length}</b> beats · <b>${fpb.toFixed(3)}</b> frames/beat`
  msg +=
    drift < 0.001
      ? ' · <span style="color:var(--accent2)">exact alignment</span>'
      : ` · max drift ±${driftMs} ms`
  if (skipCount > 0)
    msg += ` · <span style="color:#f07849">${skipCount} skipped (occupied)</span>`

  document.getElementById('bpmPreview').innerHTML = msg
}

function executeCycleGenerate() {
  const bpm = parseFloat(document.getElementById('bpmInput').value) || 120
  const countRaw = document.getElementById('bpmCountInput').value.trim()
  const maxCount =
    countRaw === '' ? Infinity : Math.max(1, parseInt(countRaw) || 1)
  const start = currentFrame()
  if (bpm <= 0 || !state.hasVideo) return

  const frames = computeCycleFrames(bpm, start, maxCount)
  const toAdd = frames.filter((f) => !state.markers.some((m) => m.frame === f))
  if (toAdd.length === 0) {
    closeCycleDialog()
    return
  }

  pushHistory()
  for (const f of toAdd) {
    state.markers.push({
      frame: f,
      depth: 0,
      trans: state.defaultTrans,
      ease: state.defaultEase,
    })
  }
  sortMarkers()
  rebuildPath()
  renderMarkerList()
  renderMarkerProps()
  updateMarkerCount()
  closeCycleDialog()
  flashClipboardMsg(`Generated ${toAdd.length} markers at ${bpm} BPM`)
}

// ── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init)
