const assert = require("node:assert/strict");

exports.runSmoke = async ({ window, clipboard, fs, path, directory }) => {
  const output = path.resolve(directory, "../../.test-tmp/video-cover-prototype/qa");
  await fs.mkdir(output, { recursive: true });
  const run = code => window.webContents.executeJavaScript(code, true);
  async function waitFor(expression) {
    for (let i = 0; i < 100; i++) {
      if (await run(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const details = await run('JSON.stringify({ status: document.getElementById("cover-status").textContent, wide: document.getElementById("layout-wide").textContent, standard: document.getElementById("layout-standard").textContent })');
    throw new Error(`Timed out: ${expression}\n${details}`);
  }
  assert.equal(await run('document.getElementById("generate-menu").hidden'), true);
  await assert.rejects(() => run('window.coverPrototype.copyImage("bad", [1920,1080])'), /song-required/);
  await run('document.getElementById("demo").click()');
  await waitFor('document.getElementById("cover-dialog").open');
  assert.equal(await run('document.getElementById("cover-dialog").open'), true);
  assert.match(await run('document.getElementById("cover-title").value'), /K\.545/);
  assert.equal(await run('document.getElementById("title-size").value'), "120");
  await run('document.getElementById("title-size").value = "120"; document.getElementById("title-size").dispatchEvent(new Event("input"));');
  await waitFor('!document.getElementById("copy-standard").disabled');
  for (const [id, expected] of [["wide", { width: 1920, height: 1080 }], ["standard", { width: 1440, height: 1080 }]]) {
    await run(`document.getElementById("copy-${id}").click()`);
    await waitFor('document.getElementById("cover-status").textContent.includes("已复制")');
    const item = (await clipboard.read()).find(value => value.types.includes("image/png"));
    assert.ok(item, "clipboard contains a PNG image");
    const png = Buffer.from(await (await item.getType("image/png")).arrayBuffer());
    assert.deepEqual(require("electron").nativeImage.createFromBuffer(png).getSize(), expected);
    const dataUrl = await run(`document.getElementById("cover-${id}").src`);
    await fs.writeFile(path.join(output, `k545-${id}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
    await run('document.getElementById("cover-status").textContent = ""');
  }
  const cases = [
    ["月光", "克劳德·德彪西"],
    ["Piano Sonata No. 16 in C major, K.545 — First Movement", "Wolfgang Amadeus Mozart"],
    ["中文繁體・日本語のタイトル・한국어 노래 제목", "作者 / 作曲家 / 작곡가"],
    ["很长的歌曲标题".repeat(25), "作者名称".repeat(35)],
  ];
  for (const [index, [title, author]] of cases.entries()) {
    const titleSize = index === 3 ? 24 : 120;
    const authorSize = index === 3 ? 24 : 56;
    await run(`document.getElementById("title-size").value = "${titleSize}"; document.getElementById("author-size").value = "${authorSize}"; document.getElementById("cover-title").value = ${JSON.stringify(title)}; document.getElementById("cover-author").value = ${JSON.stringify(author)}; document.getElementById("cover-title").dispatchEvent(new Event("input"));`);
    await waitFor('!document.getElementById("copy-wide").disabled && !document.getElementById("copy-standard").disabled');
    for (const id of ["wide", "standard"]) {
      const dataUrl = await run(`document.getElementById("cover-${id}").src`);
      await fs.writeFile(path.join(output, `case-${index}-${id}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
    }
  }
  // A wide cover can fit while the narrower cover requires a smaller setting.
  await run(`document.getElementById("cover-title").value = ${JSON.stringify("A".repeat(30))}; document.getElementById("cover-author").value = "Author"; document.getElementById("title-size").value = "160"; document.getElementById("title-size").dispatchEvent(new Event("input"));`);
  await waitFor('!document.getElementById("copy-wide").disabled');
  assert.equal(await run('document.getElementById("cover-wide").dataset.titleSize'), "160");
  assert.equal(await run('document.getElementById("copy-standard").disabled && !document.getElementById("cover-standard").hasAttribute("src")'), true);
  assert.match(await run('document.getElementById("layout-standard").textContent'), /减小字号/);
  await run('document.getElementById("cover-title").value = "月光"; document.getElementById("title-size-range").value = "320"; document.getElementById("title-size-range").dispatchEvent(new Event("input"));');
  await waitFor('!document.getElementById("copy-standard").disabled');
  assert.equal(await run('document.getElementById("title-size").value'), "320");
  assert.equal(await run('document.getElementById("cover-standard").dataset.titleSize'), "320");
  await run('document.getElementById("title-size").value = "120"; document.getElementById("author-size-range").value = "96"; document.getElementById("author-size-range").dispatchEvent(new Event("input"));');
  await waitFor('!document.getElementById("copy-standard").disabled');
  assert.equal(await run('document.getElementById("author-size").value'), "96");
  assert.equal(await run('document.getElementById("cover-standard").dataset.authorSize'), "96");
  await run('document.getElementById("author-size").value = "16"; document.getElementById("author-size").dispatchEvent(new Event("input"));');
  await waitFor('!document.getElementById("copy-standard").disabled');
  assert.equal(await run('document.getElementById("author-size-range").value'), "16");
  await run('document.getElementById("title-size").value = "999"; document.getElementById("title-size").dispatchEvent(new Event("input"));');
  await waitFor('document.getElementById("cover-status").textContent.includes("整数字号")');
  assert.equal(await run('document.getElementById("copy-wide").disabled && document.getElementById("copy-standard").disabled'), true);
  await run('document.getElementById("title-size").value = "120"; document.getElementById("author-size").value = "56"; document.getElementById("author-size").dispatchEvent(new Event("input")); document.getElementById("title-size").dispatchEvent(new Event("input"));');
  await run('document.getElementById("cover-title").value = ""; document.getElementById("cover-title").dispatchEvent(new Event("input"));');
  assert.equal(await run('document.getElementById("copy-wide").disabled && !document.getElementById("cover-wide").hasAttribute("src")'), true);
  await run('document.getElementById("cover-reset").click()');
  await waitFor('!document.getElementById("copy-wide").disabled && !document.getElementById("copy-standard").disabled');
  await run('Promise.all([document.getElementById("cover-wide").decode(), document.getElementById("cover-standard").decode()]).then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
  await fs.writeFile(path.join(output, "dialog.png"), (await window.webContents.capturePage()).toPNG());
  await assert.rejects(() => run('window.coverPrototype.copyImage("bad", [1920,1080])'), /invalid-cover-image/);
  await run('document.getElementById("cover-done").click(); document.getElementById("back-menu").click();');
  assert.equal(await run('document.getElementById("generate-menu").hidden'), true);
  console.log(JSON.stringify({ ok: true, dimensions: ["1920x1080", "1440x1080"], cases: cases.length, titleSize: "24–320, exact size, range/number sync and per-ratio overflow passed", clipboard: "native PNG roundtrip passed", output }));
};
