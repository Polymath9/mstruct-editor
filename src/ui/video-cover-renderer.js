// Independent cover renderer: consumes normalized editor metadata, no platform I/O.
export const COVER_SIZES = Object.freeze({ "16:9": [1920, 1080], "4:3": [1440, 1080] });
export const TITLE_FONT_SIZE = Object.freeze({ minimum: 24, maximum: 320, initial: 120 });
export const AUTHOR_FONT_SIZE = Object.freeze({ minimum: 16, maximum: 160, initial: 56 });
const FONT = '"MStruct Cover Sans"';
const words = new Intl.Segmenter("zh", { granularity: "word" });
const graphemes = new Intl.Segmenter("zh", { granularity: "grapheme" });

export function coverFields(metadata = {}) {
  return {
    title: String(metadata.songName || "").trim(),
    author: (metadata.composers || []).map(person => String(person.name || "").trim()).filter(Boolean).join(" / "),
  };
}

export function wrapText(context, text, width) {
  const lines = [];
  for (const paragraph of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    const tokens = [...words.segment(paragraph)].flatMap(({ segment }) =>
      context.measureText(segment).width > width ? [...graphemes.segment(segment)].map(part => part.segment) : [segment]);
    for (const token of tokens) {
      if (line && context.measureText(line + token).width > width) {
        lines.push(line.trimEnd());
        line = token.trimStart();
      } else line += token;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function fitText(context, text, { width, height, maximum, minimum = 24, weight = 700, maxLines = 4 }) {
  if (!text.trim()) return { lines: [], size: maximum, height: 0, lineHeight: 0 };
  // Keep short titles on one line before choosing a larger, multi-line layout.
  if (!text.includes("\n")) {
    for (let size = maximum; size >= Math.max(minimum, maximum * .76); size -= 2) {
      context.font = `${weight} ${size}px ${FONT}`;
      if (context.measureText(text).width <= width && size * 1.25 <= height) return { lines: [text], size, height: size * 1.25, lineHeight: size * 1.25 };
    }
  }
  for (let size = maximum; size >= minimum; size -= 2) {
    context.font = `${weight} ${size}px ${FONT}`;
    const lines = wrapText(context, text, width);
    const lineHeight = size * 1.25;
    if (lines.length <= maxLines && lines.length * lineHeight <= height && lines.every(line => context.measureText(line).width <= width)) {
      return { lines, size, height: lines.length * lineHeight, lineHeight };
    }
  }
  throw new RangeError("cover-text-too-long");
}

export async function loadCoverAssets({ fontUrl }) {
  const font = new FontFace("MStruct Cover Sans", `url("${fontUrl}")`, { weight: "100 900" });
  await font.load();
  document.fonts.add(font);
  await Promise.all([document.fonts.load(`700 120px ${FONT}`), document.fonts.load(`400 60px ${FONT}`)]);
  const logo = new Image();
  logo.src = new URL("./video-cover-logo.svg", import.meta.url).href;
  await logo.decode();
  return { logo };
}

function paintText(context, layout, centerX, centerY, weight, color) {
  context.font = `${weight} ${layout.size}px ${FONT}`;
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  layout.lines.forEach((line, index) => {
    const metrics = context.measureText(line || "M");
    const middle = centerY - layout.height / 2 + (index + .5) * layout.lineHeight;
    context.fillText(line, centerX, middle + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2);
  });
}

export function renderCover(canvas, { title = "", author = "", ratio = "16:9", titleSize = TITLE_FONT_SIZE.initial, authorSize = AUTHOR_FONT_SIZE.initial }, assets) {
  const size = COVER_SIZES[ratio];
  if (!size) throw new RangeError("cover-ratio");
  if (!Number.isInteger(titleSize) || titleSize < TITLE_FONT_SIZE.minimum || titleSize > TITLE_FONT_SIZE.maximum) {
    throw new RangeError("cover-font-size");
  }
  if (!Number.isInteger(authorSize) || authorSize < AUTHOR_FONT_SIZE.minimum || authorSize > AUTHOR_FONT_SIZE.maximum) {
    throw new RangeError("cover-font-size");
  }
  const [width, height] = size;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const paper = context.createRadialGradient(width * .8, height * .1, 0, width * .8, height * .1, width * .9);
  paper.addColorStop(0, "#fffdfa");
  paper.addColorStop(1, "#f5f3ef");
  context.fillStyle = paper;
  context.fillRect(0, 0, width, height);
  // The source logo's visible outline is optically centered, preserving its paths.
  context.drawImage(assets.logo, width / 2 - 93.5, 100, 184, 184);
  paintText(context, { lines: ["MStruct"], size: 66, height: 82.5, lineHeight: 82.5 }, width / 2, 339, 600, "#29272b");
  const authorLayout = fitText(context, author, { width: width * .8, height: 200, maximum: authorSize, minimum: authorSize, weight: 400, maxLines: 3 });
  const titleHeight = Math.min(500, 1020 - 410 - 54 - authorLayout.height);
  const titleLayout = fitText(context, title, { width: width * .84, height: titleHeight, maximum: titleSize, minimum: titleSize });
  const titleCenter = Math.max(553, 410 + titleLayout.height / 2);
  paintText(context, titleLayout, width / 2, titleCenter, 700, "#29272b");
  const authorCenter = Math.max(729, titleCenter + titleLayout.height / 2 + 54 + authorLayout.height / 2);
  paintText(context, authorLayout, width / 2, authorCenter, 400, "#66616b");
  return { width, height, title: titleLayout, titleCenter, author: authorLayout, authorCenter };
}
