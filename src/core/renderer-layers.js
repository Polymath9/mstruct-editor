export const RENDERER_LAYERS_STORAGE_KEY = "mstruct-renderer-layers-v1";
export const RENDERER_LAYERS_CHANNEL = "mstruct-renderer-layers-v1";
export const RENDERER_LAYER_KEYS = Object.freeze(["speed", "form", "tags", "comments", "newRiemannian", "pianoKeyboard"]);
export const DEFAULT_RENDERER_LAYERS = Object.freeze(Object.fromEntries(RENDERER_LAYER_KEYS.map((key) => [key, key !== "pianoKeyboard"])));

export function tagIsVisible(tag, layers) { return tag.form ? layers.form : layers.tags; }

export function visibleTagLanes(source, layers) {
  const occupied = source.tagOccupiedLanes ?? new Set();
  return new Set([...(source.activeTags ?? []), ...(source.tags ?? [])]
    .filter((tag) => tagIsVisible(tag, layers) && occupied.has(tag.lane) && !(tag.kind === "active" && tag.visualMode === "detached")).map((tag) => tag.lane));
}

export function normalizeRendererLayers(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(RENDERER_LAYER_KEYS.map((key) => [key, typeof source[key] === "boolean" ? source[key] : DEFAULT_RENDERER_LAYERS[key]]));
}

export function readRendererLayers(storage) {
  try {
    const target = storage ?? globalThis.sessionStorage;
    return normalizeRendererLayers(JSON.parse(target?.getItem(RENDERER_LAYERS_STORAGE_KEY) ?? "null"));
  } catch {
    return normalizeRendererLayers();
  }
}

export function writeRendererLayers(value, storage) {
  const normalized = normalizeRendererLayers(value);
  try {
    const target = storage ?? globalThis.sessionStorage;
    target?.setItem(RENDERER_LAYERS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Rendering layers are deliberately best-effort session state.
  }
  return normalized;
}
