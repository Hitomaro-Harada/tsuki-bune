const STORAGE_KEY = "tsuki-bune-current-entry";
const ASSET_DIRECTORY_NAME = "assets";

const editor = document.querySelector("#editor");
const titleInput = document.querySelector("#entryTitle");
const dateInput = document.querySelector("#entryDate");
const saveStatus = document.querySelector("#saveStatus");
const folderStatus = document.querySelector("#folderStatus");
const entryList = document.querySelector("#entryList");
const entrySearch = document.querySelector("#entrySearch");
const entryCount = document.querySelector("#entryCount");
const pickFolderButton = document.querySelector("#pickFolder");
const openHtmlButton = document.querySelector("#openHtml");
const openHtmlInput = document.querySelector("#openHtmlInput");
const aboutDialog = document.querySelector("#aboutDialog");
const aboutOpenButton = document.querySelector("#aboutOpen");
const aboutCloseButton = document.querySelector("#aboutClose");
const blockFormatPicker = document.querySelector("#blockFormatPicker");
const blockFormatToggle = document.querySelector("#blockFormatToggle");
const blockFormatMenu = document.querySelector("#blockFormatMenu");
const fontSizePicker = document.querySelector("#fontSizePicker");
const fontSizeToggle = document.querySelector("#fontSizeToggle");
const fontSizeMenu = document.querySelector("#fontSizeMenu");

const today = new Date().toISOString().slice(0, 10);
let savedRange = null;
let directoryHandle = null;
let currentFileHandle = null;
let currentFileName = "";
let draftAssetBaseName = "";
let isSaving = false;
let hasUnsavedChanges = false;
let cleanEntrySnapshot = "";
let entryFiles = [];
const previewObjectUrls = new Map();

function defaultEntry() {
  return {
    title: "無題の日記",
    date: today,
    html: "<p>今日のことを書き始める。</p>"
  };
}

function loadEntry() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return defaultEntry();
  }

  try {
    return { ...defaultEntry(), ...JSON.parse(stored) };
  } catch {
    return defaultEntry();
  }
}

function renderEntry(entry) {
  titleInput.value = entry.title;
  dateInput.value = entry.date;
  editor.innerHTML = entry.html;
}

function readEntry() {
  return {
    title: titleInput.value.trim() || "無題の日記",
    date: dateInput.value || today,
    html: editor.innerHTML
  };
}

function persistEntry() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readEntry()));
}

function getEntrySnapshot() {
  return JSON.stringify(readEntry());
}

function setSaveStatus(message, state = "idle") {
  saveStatus.textContent = message;
  saveStatus.dataset.state = state;
}

function markEntryChanged() {
  persistEntry();
  hasUnsavedChanges = getEntrySnapshot() !== cleanEntrySnapshot;
  setSaveStatus(hasUnsavedChanges ? "未保存の変更があります" : "", hasUnsavedChanges ? "unsaved" : "idle");
}

function markEntryClean(message, state = "idle") {
  hasUnsavedChanges = false;
  persistEntry();
  cleanEntrySnapshot = getEntrySnapshot();
  setSaveStatus(message, state);
}

function saveSelection() {
  const selection = window.getSelection();
  if (!selection.rangeCount) {
    return;
  }

  const range = selection.getRangeAt(0);
  if (editor.contains(range.commonAncestorContainer)) {
    savedRange = range.cloneRange();
  }
}

function restoreSelection() {
  if (!savedRange) {
    editor.focus();
    return;
  }

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(savedRange);
}

function exec(command, value = null) {
  restoreSelection();
  document.execCommand(command, false, value);
  saveSelection();
  markEntryChanged();
}

function applyBlockFormat(tagName) {
  restoreSelection();
  document.execCommand("formatBlock", false, tagName.toLowerCase());
  saveSelection();
  markEntryChanged();
}

function insertNodeAtSelection(node) {
  restoreSelection();

  const selection = window.getSelection();
  if (!selection.rangeCount) {
    editor.append(node);
    saveSelection();
    markEntryChanged();
    return;
  }

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {
    editor.append(node);
  } else {
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  saveSelection();
  markEntryChanged();
}

function applyInlineStyle(styles) {
  restoreSelection();

  const selection = window.getSelection();
  if (!selection.rangeCount || selection.isCollapsed) {
    return;
  }

  const range = selection.getRangeAt(0);
  const span = document.createElement("span");

  Object.entries(styles).forEach(([property, value]) => {
    span.style[property] = value;
  });

  span.append(range.extractContents());
  range.insertNode(span);
  range.selectNodeContents(span);
  selection.removeAllRanges();
  selection.addRange(range);
  saveSelection();
  markEntryChanged();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[char];
  });
}

function normalizeEntryHtml(html) {
  const documentHtml = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  const root = documentHtml.querySelector("main");

  root.querySelectorAll("img").forEach((image) => {
    const assetSrc = image.dataset.tsukiSrc;
    if (assetSrc) {
      image.setAttribute("src", assetSrc);
      image.removeAttribute("data-tsuki-src");
    }
  });

  root.querySelectorAll("font").forEach((font) => {
    const span = documentHtml.createElement("span");
    const color = font.getAttribute("color");
    const size = font.getAttribute("size");
    const fontSizes = {
      "2": "80%",
      "3": "100%",
      "5": "150%",
      "7": "200%"
    };

    if (color) {
      span.style.color = color;
    }
    if (fontSizes[size]) {
      span.style.fontSize = fontSizes[size];
    }
    span.innerHTML = font.innerHTML;
    font.replaceWith(span);
  });

  root.querySelectorAll("span").forEach((span) => {
    if (!span.getAttribute("style")) {
      span.replaceWith(...span.childNodes);
    }
  });

  root.querySelectorAll("div").forEach((div) => {
    if (div.parentElement === root) {
      if (div.querySelector("ul, ol, h1, h2, h3, blockquote, pre, table")) {
        div.replaceWith(...div.childNodes);
        return;
      }

      const paragraph = documentHtml.createElement("p");
      paragraph.innerHTML = div.innerHTML || "<br>";
      div.replaceWith(paragraph);
    }
  });

  root.querySelectorAll("*").forEach((element) => {
    if (
      !element.textContent.trim() &&
      !element.matches("img, br") &&
      !element.querySelector("img, br")
    ) {
      element.remove();
    }
  });

  return root.innerHTML.trim() || "<p></p>";
}

function getEntryHtmlForSave() {
  return normalizeEntryHtml(editor.innerHTML);
}

function buildHtmlDocument(entry) {
  const title = escapeHtml(entry.title);
  const date = escapeHtml(entry.date);
  const html = normalizeEntryHtml(entry.html);

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <meta name="tsuki-bune:date" content="${date}">
    <style>
      body {
        max-width: 820px;
        margin: 48px auto;
        padding: 0 24px;
        color: #1f2937;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.8;
      }
      header {
        margin-bottom: 32px;
        border-bottom: 1px solid #d8dee8;
      }
      h1, h2, h3 {
        line-height: 1.35;
      }
      img {
        max-width: 100%;
        height: auto;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${title}</h1>
      <p><time datetime="${date}">${date}</time></p>
    </header>
    <main data-tsuki-bune-entry>
${html}
    </main>
  </body>
</html>
`;
}

function createFileName(entry) {
  const safeTitle = entry.title
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "diary";

  return `${entry.date}-${safeTitle}.html`;
}

function getBaseName(fileName) {
  return fileName.replace(/\.html$/i, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getEntryBaseName(entry = readEntry()) {
  return getBaseName(createFileName(entry));
}

function getDateFromFileName(fileName) {
  const match = fileName.match(/^(\d{4}-\d{2}-\d{2})-/);
  return match ? match[1] : "";
}

function compareEntryFiles(a, b) {
  const aDate = getDateFromFileName(a.name);
  const bDate = getDateFromFileName(b.name);

  if (aDate && bDate && aDate !== bDate) {
    return bDate.localeCompare(aDate);
  }

  if (aDate && !bDate) {
    return -1;
  }

  if (!aDate && bDate) {
    return 1;
  }

  return b.name.localeCompare(a.name, "ja");
}

function getAssetExtension(file) {
  const typeExtensions = {
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };
  const typedExtension = typeExtensions[file.type];
  const namedExtension = file.name.split(".").pop()?.toLowerCase();

  return typedExtension || namedExtension || "png";
}

function parseHtmlDocument(html) {
  const documentHtml = new DOMParser().parseFromString(html, "text/html");
  const entryRoot = documentHtml.querySelector("[data-tsuki-bune-entry]");
  const title = documentHtml.querySelector("title")?.textContent
    || documentHtml.querySelector("h1")?.textContent
    || "無題の日記";
  const date = documentHtml.querySelector('meta[name="tsuki-bune:date"]')?.content
    || documentHtml.querySelector("time")?.getAttribute("datetime")
    || today;

  return {
    title,
    date,
    html: entryRoot?.innerHTML.trim() || documentHtml.body.innerHTML.trim() || "<p></p>"
  };
}

function setCurrentFile(fileHandle, fileName) {
  currentFileHandle = fileHandle;
  currentFileName = fileName || fileHandle?.name || "";
  draftAssetBaseName = currentFileName ? getBaseName(currentFileName) : "";
  markActiveEntry();
}

function markActiveEntry() {
  entryList.querySelectorAll("button").forEach((button) => {
    const isActive = button.dataset.fileName === currentFileName;
    button.classList.toggle("is-active", isActive);
    if (isActive) {
      button.scrollIntoView({ block: "nearest" });
    }
  });
}

function updateFolderStatus(message) {
  folderStatus.textContent = message;
}

function confirmDownloadSave() {
  return window.confirm(
    "\nこの日記をダウンロード保存しますか？\n"
  );
}

function downloadHtml() {
  if (!confirmDownloadSave()) {
    setSaveStatus(
      hasUnsavedChanges ? "未保存の変更があります" : "ダウンロード保存をキャンセルしました",
      hasUnsavedChanges ? "unsaved" : "idle"
    );
    return;
  }

  const entry = readEntry();
  entry.html = getEntryHtmlForSave();
  const blob = new Blob([buildHtmlDocument(entry)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = createFileName(entry);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  markEntryClean("HTMLをダウンロードしました", "saved");
}

async function writeHtmlToHandle(fileHandle, entry) {
  const writable = await fileHandle.createWritable();
  await writable.write(buildHtmlDocument(entry));
  await writable.close();
}

async function getAssetDirectoryHandle() {
  if (!directoryHandle) {
    return null;
  }

  return directoryHandle.getDirectoryHandle(ASSET_DIRECTORY_NAME, { create: true });
}

function getNextAssetFileName(baseName, extension) {
  const pattern = new RegExp(`^${escapeRegExp(baseName)}-(\\d{3})\\.[^.]+$`);
  let maxIndex = 0;

  editor.querySelectorAll("img").forEach((image) => {
    const assetFileName = getAssetFileNameFromSrc(getImageAssetSrc(image));
    const match = assetFileName.match(pattern);
    if (match) {
      maxIndex = Math.max(maxIndex, Number(match[1]));
    }
  });

  return `${baseName}-${String(maxIndex + 1).padStart(3, "0")}.${extension}`;
}

function isAssetFileNameForBaseName(fileName, baseName) {
  return new RegExp(`^${escapeRegExp(baseName)}-\\d{3}\\.[^.]+$`).test(fileName);
}

function getImageAssetSrc(image) {
  return image.dataset.tsukiSrc || image.getAttribute("src") || "";
}

function getAssetFileNameFromSrc(src) {
  if (src.startsWith(`./${ASSET_DIRECTORY_NAME}/`)) {
    return src.slice(ASSET_DIRECTORY_NAME.length + 3);
  }
  if (src.startsWith(`${ASSET_DIRECTORY_NAME}/`)) {
    return src.slice(ASSET_DIRECTORY_NAME.length + 1);
  }

  try {
    const url = new URL(src, window.location.href);
    const assetPath = `/${ASSET_DIRECTORY_NAME}/`;
    const assetIndex = url.pathname.indexOf(assetPath);
    if (assetIndex !== -1) {
      return decodeURIComponent(url.pathname.slice(assetIndex + assetPath.length));
    }
  } catch {
    return "";
  }

  return "";
}

function getReferencedAssetFileNames(html = editor.innerHTML) {
  const documentHtml = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  const assetFileNames = new Set();

  documentHtml.querySelectorAll("img").forEach((image) => {
    const assetFileName = getAssetFileNameFromSrc(getImageAssetSrc(image));
    if (assetFileName) {
      assetFileNames.add(assetFileName);
    }
  });

  return assetFileNames;
}

function createPreviewUrl(assetFileName, file) {
  const previousUrl = previewObjectUrls.get(assetFileName);
  if (previousUrl) {
    URL.revokeObjectURL(previousUrl);
  }

  const url = URL.createObjectURL(file);
  previewObjectUrls.set(assetFileName, url);
  return url;
}

async function hydrateExternalImages() {
  if (!directoryHandle) {
    return;
  }

  let assetDirectoryHandle;
  try {
    assetDirectoryHandle = await getAssetDirectoryHandle();
  } catch (error) {
    console.warn("Could not open asset directory", error);
    return;
  }

  for (const image of editor.querySelectorAll("img")) {
    const src = image.getAttribute("src") || "";
    const assetFileName = getAssetFileNameFromSrc(src);
    if (!assetFileName) {
      continue;
    }

    try {
      const fileHandle = await assetDirectoryHandle.getFileHandle(assetFileName);
      const file = await fileHandle.getFile();
      image.dataset.tsukiSrc = `./${ASSET_DIRECTORY_NAME}/${assetFileName}`;
      image.src = createPreviewUrl(assetFileName, file);
    } catch (error) {
      console.warn(`Could not preview ${assetFileName}`, error);
    }
  }
}

async function copyAssetFile(assetDirectoryHandle, fromName, toName) {
  if (fromName === toName) {
    return;
  }

  const fromHandle = await assetDirectoryHandle.getFileHandle(fromName);
  const toHandle = await assetDirectoryHandle.getFileHandle(toName, { create: true });
  const writable = await toHandle.createWritable();
  await writable.write(await fromHandle.getFile());
  await writable.close();
}

async function renameReferencedAssets(previousBaseName, nextBaseName) {
  if (!directoryHandle || !previousBaseName || previousBaseName === nextBaseName) {
    return;
  }

  const assetDirectoryHandle = await getAssetDirectoryHandle();
  const renamedFiles = new Map();

  for (const image of editor.querySelectorAll("img")) {
    const assetFileName = getAssetFileNameFromSrc(getImageAssetSrc(image));
    if (!assetFileName || !isAssetFileNameForBaseName(assetFileName, previousBaseName)) {
      continue;
    }

    const nextFileName = assetFileName.replace(previousBaseName, nextBaseName);
    try {
      if (!renamedFiles.has(assetFileName)) {
        await copyAssetFile(assetDirectoryHandle, assetFileName, nextFileName);
        renamedFiles.set(assetFileName, nextFileName);
      }
      const nextFile = await (await assetDirectoryHandle.getFileHandle(nextFileName)).getFile();
      image.dataset.tsukiSrc = `./${ASSET_DIRECTORY_NAME}/${nextFileName}`;
      image.src = createPreviewUrl(nextFileName, nextFile);
    } catch (error) {
      console.warn(`Could not rename ${assetFileName}`, error);
    }
  }

  for (const oldFileName of renamedFiles.keys()) {
    try {
      await assetDirectoryHandle.removeEntry(oldFileName);
    } catch (error) {
      console.warn(`Could not remove ${oldFileName}`, error);
    }
  }
}

async function removeUnusedAssetsForBaseNames(baseNames, html = editor.innerHTML) {
  if (!directoryHandle) {
    return 0;
  }

  const targetBaseNames = [...new Set(baseNames.filter(Boolean))];
  if (!targetBaseNames.length) {
    return 0;
  }

  const assetDirectoryHandle = await getAssetDirectoryHandle();
  const referencedAssetFileNames = getReferencedAssetFileNames(html);
  let removedCount = 0;

  for await (const [name, handle] of assetDirectoryHandle.entries()) {
    const isTargetAsset = targetBaseNames.some((baseName) => isAssetFileNameForBaseName(name, baseName));
    if (handle.kind !== "file" || !isTargetAsset || referencedAssetFileNames.has(name)) {
      continue;
    }

    try {
      await assetDirectoryHandle.removeEntry(name);
      const previewUrl = previewObjectUrls.get(name);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewObjectUrls.delete(name);
      }
      removedCount += 1;
    } catch (error) {
      console.warn(`Could not remove unused asset ${name}`, error);
    }
  }

  return removedCount;
}

async function removeFileFromDirectory(fileName) {
  if (!directoryHandle || !fileName) {
    return;
  }

  try {
    await directoryHandle.removeEntry(fileName);
  } catch (error) {
    console.warn(`Could not remove ${fileName}`, error);
  }
}

async function saveEntry() {
  if (isSaving) {
    return;
  }

  isSaving = true;
  let entry = readEntry();
  const desiredFileName = createFileName(entry);
  const desiredBaseName = getBaseName(desiredFileName);
  const previousBaseName = currentFileName
    ? getBaseName(currentFileName)
    : draftAssetBaseName;

  try {
    if (currentFileHandle && (!directoryHandle || currentFileName === desiredFileName)) {
      entry.html = getEntryHtmlForSave();
      const removedAssetCount = directoryHandle
        ? await removeUnusedAssetsForBaseNames([desiredBaseName], entry.html)
        : 0;
      await writeHtmlToHandle(currentFileHandle, entry);
      markEntryClean(
        `${currentFileName || currentFileHandle.name} を上書き保存しました`
          + (removedAssetCount ? `（未使用画像${removedAssetCount}件を削除）` : ""),
        "saved"
      );
      return;
    }

    if (directoryHandle) {
      const previousFileName = currentFileName;
      await renameReferencedAssets(previousBaseName, desiredBaseName);
      entry = readEntry();
      entry.html = getEntryHtmlForSave();
      const removedAssetCount = await removeUnusedAssetsForBaseNames(
        [previousBaseName, desiredBaseName],
        entry.html
      );
      const fileHandle = await directoryHandle.getFileHandle(desiredFileName, { create: true });
      await writeHtmlToHandle(fileHandle, entry);
      setCurrentFile(fileHandle, desiredFileName);
      if (previousFileName && previousFileName !== desiredFileName) {
        await removeFileFromDirectory(previousFileName);
      }
      await refreshEntryList();
      markEntryClean(
        `${desiredFileName} を保存しました`
          + (removedAssetCount ? `（未使用画像${removedAssetCount}件を削除）` : ""),
        "saved"
      );
      return;
    }

    downloadHtml();
  } catch (error) {
    console.error(error);
    setSaveStatus("保存できませんでした", "error");
  } finally {
    isSaving = false;
  }
}

async function openFileHandle(fileHandle) {
  const file = await fileHandle.getFile();
  const entry = parseHtmlDocument(await file.text());
  renderEntry(entry);
  setCurrentFile(fileHandle, fileHandle.name);
  await hydrateExternalImages();
  markEntryClean(`${fileHandle.name} を読み込みました`);
}

async function openPickedFile(file) {
  const entry = parseHtmlDocument(await file.text());
  renderEntry(entry);
  setCurrentFile(null, file.name);
  markEntryClean(`${file.name} を読み込みました`);
}

async function refreshEntryList() {
  entryList.textContent = "";

  if (!directoryHandle) {
    entryFiles = [];
    entrySearch.hidden = true;
    entrySearch.value = "";
    entryCount.hidden = true;
    entryCount.textContent = "";
    return;
  }

  entrySearch.hidden = false;
  entryCount.hidden = false;
  const files = [];
  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind === "file" && name.toLowerCase().endsWith(".html")) {
      files.push({ name, handle });
    }
  }

  entryFiles = files.sort(compareEntryFiles);
  renderEntryList();
}

function renderEntryList() {
  entryList.textContent = "";

  const query = entrySearch.value.trim().toLowerCase();
  const visibleFiles = query
    ? entryFiles.filter(({ name }) => name.toLowerCase().includes(query))
    : entryFiles;

  visibleFiles.forEach(({ name, handle }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.dataset.fileName = name;
    button.addEventListener("click", () => openFileHandle(handle));
    entryList.append(button);
  });

  markActiveEntry();
  if (!entryFiles.length) {
    entryCount.textContent = "HTMLはまだありません";
    return;
  }

  entryCount.textContent = query
    ? `${visibleFiles.length}/${entryFiles.length}件のHTML`
    : `${entryFiles.length}件のHTML`;
}

async function pickDiaryFolder() {
  if (!("showDirectoryPicker" in window)) {
    updateFolderStatus("このブラウザはフォルダ保存に未対応です");
    return;
  }

  try {
    directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    updateFolderStatus(`選択中: ${directoryHandle.name}`);
    await refreshEntryList();
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error(error);
      updateFolderStatus("フォルダを選べませんでした");
    }
  }
}

async function insertExternalImage(file) {
  const assetDirectoryHandle = await getAssetDirectoryHandle();
  const entryBaseName = currentFileName
    ? getBaseName(currentFileName)
    : draftAssetBaseName || getEntryBaseName();
  const assetFileName = getNextAssetFileName(entryBaseName, getAssetExtension(file));
  const assetFileHandle = await assetDirectoryHandle.getFileHandle(assetFileName, { create: true });
  const writable = await assetFileHandle.createWritable();

  await writable.write(file);
  await writable.close();
  draftAssetBaseName = entryBaseName;
  const paragraph = document.createElement("p");
  const image = document.createElement("img");
  image.src = createPreviewUrl(assetFileName, file);
  image.dataset.tsukiSrc = `./${ASSET_DIRECTORY_NAME}/${assetFileName}`;
  image.alt = "";
  paragraph.append(image);
  insertNodeAtSelection(paragraph);
  setSaveStatus("未保存の変更があります", "unsaved");
}

function insertEmbeddedImage(file) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const paragraph = document.createElement("p");
    const image = document.createElement("img");
    image.src = reader.result;
    image.alt = "";
    paragraph.append(image);
    insertNodeAtSelection(paragraph);
  });
  reader.readAsDataURL(file);
}

async function insertImage(file) {
  if (directoryHandle) {
    try {
      await insertExternalImage(file);
      return;
    } catch (error) {
      console.warn("Could not save external image", error);
      setSaveStatus("画像をHTML内に埋め込みました", "unsaved");
    }
  }

  insertEmbeddedImage(file);
}

function openAboutDialog() {
  aboutDialog.hidden = false;
  document.body.classList.add("has-modal");
  aboutCloseButton.focus();
}

function closeAboutDialog() {
  aboutDialog.hidden = true;
  document.body.classList.remove("has-modal");
  aboutOpenButton.focus();
}

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => exec(button.dataset.command));
});

function closePickerMenu(menu, toggle) {
  menu.hidden = true;
  toggle.setAttribute("aria-expanded", "false");
}

function openPickerMenu(menu, toggle) {
  menu.hidden = false;
  toggle.setAttribute("aria-expanded", "true");
}

function closeToolbarMenus() {
  closePickerMenu(blockFormatMenu, blockFormatToggle);
  closePickerMenu(fontSizeMenu, fontSizeToggle);
}

[blockFormatPicker, fontSizePicker].forEach((picker) => {
  picker.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
});

blockFormatToggle.addEventListener("click", () => {
  if (blockFormatMenu.hidden) {
    closePickerMenu(fontSizeMenu, fontSizeToggle);
    openPickerMenu(blockFormatMenu, blockFormatToggle);
  } else {
    closePickerMenu(blockFormatMenu, blockFormatToggle);
  }
});

blockFormatMenu.querySelectorAll("[data-block-format]").forEach((button) => {
  button.addEventListener("click", () => {
    applyBlockFormat(button.dataset.blockFormat);
    closePickerMenu(blockFormatMenu, blockFormatToggle);
  });
});

fontSizeToggle.addEventListener("click", () => {
  if (fontSizeMenu.hidden) {
    closePickerMenu(blockFormatMenu, blockFormatToggle);
    openPickerMenu(fontSizeMenu, fontSizeToggle);
  } else {
    closePickerMenu(fontSizeMenu, fontSizeToggle);
  }
});

fontSizeMenu.querySelectorAll("[data-font-size]").forEach((button) => {
  button.addEventListener("click", () => {
    applyInlineStyle({ fontSize: button.dataset.fontSize });
    closePickerMenu(fontSizeMenu, fontSizeToggle);
  });
});

document.addEventListener("click", (event) => {
  if (!blockFormatPicker.contains(event.target) && !fontSizePicker.contains(event.target)) {
    closeToolbarMenus();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeToolbarMenus();
    if (!aboutDialog.hidden) {
      closeAboutDialog();
    }
  }
});

aboutOpenButton.addEventListener("click", openAboutDialog);
aboutCloseButton.addEventListener("click", closeAboutDialog);
aboutDialog.querySelectorAll("[data-about-close]").forEach((element) => {
  element.addEventListener("click", closeAboutDialog);
});

document.querySelectorAll("[data-text-color]").forEach((button) => {
  button.addEventListener("click", () => applyInlineStyle({ color: button.dataset.textColor }));
});

document.querySelectorAll("[data-highlight-color]").forEach((button) => {
  button.addEventListener("click", () => applyInlineStyle({ backgroundColor: button.dataset.highlightColor }));
});

document.querySelector("#saveHtml").addEventListener("click", saveEntry);

document.addEventListener("keydown", (event) => {
  const isSaveShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
  if (!isSaveShortcut) {
    return;
  }

  event.preventDefault();
  saveEntry();
});

pickFolderButton.addEventListener("click", pickDiaryFolder);

openHtmlButton.addEventListener("click", () => {
  openHtmlInput.click();
});

openHtmlInput.addEventListener("change", () => {
  const [file] = openHtmlInput.files;
  if (file) {
    openPickedFile(file);
  }
  openHtmlInput.value = "";
});

entrySearch.addEventListener("input", renderEntryList);

document.querySelector("#newEntry").addEventListener("click", () => {
  setCurrentFile(null, "");
  draftAssetBaseName = "";
  renderEntry(defaultEntry());
  markEntryClean("新規日記を作成しました");
  editor.focus();
});

[editor, titleInput, dateInput].forEach((element) => {
  element.addEventListener("input", markEntryChanged);
});

editor.addEventListener("keyup", saveSelection);
editor.addEventListener("mouseup", saveSelection);
editor.addEventListener("blur", saveSelection);

editor.addEventListener("paste", (event) => {
  const files = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
  if (!files.length) {
    return;
  }

  event.preventDefault();
  insertImage(files[0]);
});

renderEntry(loadEntry());
cleanEntrySnapshot = getEntrySnapshot();
setSaveStatus("");

if (!("showDirectoryPicker" in window)) {
  pickFolderButton.disabled = true;
  updateFolderStatus("フォルダ保存非対応: HTML読込/ダウンロード保存は利用可");
}
