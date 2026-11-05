import { createVideoExportPlan, pianoExportEvents } from "../core/video-export.js";
import { createPianoExport } from "../core/piano-export.js";
import { transposeMidiNotes } from "../core/transposition.js";

export function isVideoExportStage() {
  if (window.location.search !== "?video-export") return false;
  try { return Boolean(window.mstructVideo ?? window.parent.mstructVideo); }
  catch { return false; }
}

/** Deterministic presentation clock; no filesystem or live audio playback. */
export function setupVideoExportStage({ api, prepare, navigation, refreshLayout }) {
  if (!api && window.location.search === "?video-export") {
    try { api = window.parent.mstructVideo; } catch { /* Cross-origin hosts have no desktop capability. */ }
  }
  if (!api) return;
  const style = document.createElement("style");
  style.textContent = `body.video-export-mode .renderer-panel{position:fixed!important;inset:0!important;z-index:99999;--renderer-nav-height:0px!important}body.video-export-mode .renderer-nav{display:none!important}body.video-export-mode .renderer-canvas{scrollbar-width:none!important;scrollbar-gutter:auto!important}body.video-export-mode .renderer-canvas::-webkit-scrollbar{display:none!important}body.video-export-mode *,body.video-export-mode *::before,body.video-export-mode *::after{animation:none!important;transition:none!important;caret-color:transparent!important}`;
  document.head.append(style); document.body.classList.add("video-export-mode");
  let model;
  window.mstructVideoStage = {
    async initialize(value) {
      const result = await prepare(value);
      await document.fonts.ready;
      refreshLayout();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      navigation().handleCommand("auto-scroll", true);
      model = createVideoExportPlan(result, value.metadata, value.playback, value.fps);
      model.plan = { ...model.plan, entries: model.plan.entries.map(entry => ({ ...entry,
        midiNotes: entry.midiNotes ? transposeMidiNotes(entry.midiNotes, value.preferences, { audio: true }) : entry.midiNotes })) };
      await navigation().renderPresentationAt(0);
      return { ...model, plan: undefined, hasPiano: Boolean(value.playback.pianoEnabled && pianoExportEvents(model.plan).length) };
    },
    async frame(index) {
      if (!model || !Number.isInteger(index) || index < 0 || index >= model.frameCount) throw new Error("Invalid video frame.");
      await navigation().renderPresentationAt(index * 1000 / model.fps);
    },
    async audio() {
      const render = await createPianoExport(model.plan, api.pianoInstrumentUrl);
      const totalFrames = Math.ceil(model.frameCount / model.fps * model.sampleRate);
      for (let frame = 0; frame < totalFrames; frame += model.sampleRate * 20) {
        const pcm = await render(frame, Math.min(model.sampleRate * 20, totalFrames - frame));
        await api.writeAudio(pcm.buffer);
      }
    },
  };
  api.ready();
}
