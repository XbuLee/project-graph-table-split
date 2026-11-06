(async () => {
  const DEFAULTS = { columnSeparator: "\\t", maxColumnWidth: 480, columnGap: 8, rowGap: 8 };
  let running = false;

  function parseSeparator(value) {
    if (typeof value !== "string" || value.length === 0) throw new Error("列分隔符不能为空。");
    const separator = value === "\\t" ? "\t" : value === "\\s" ? " " : value;
    if (separator.includes("\n") || separator.includes("\r") || separator === "\\n" || separator === "\\r") {
      throw new Error("换行固定用于分行，请使用其他字符分列。");
    }
    if (separator.includes('"')) throw new Error("双引号用于包裹单元格，不能用作列分隔符。");
    return separator;
  }

  async function chooseOptions() {
    const savedSeparator = await prg.settings_getOwn("columnSeparator");
    const separatorInput = await prg.dialog_input(
      "列分隔符",
      "固定按换行分行。\\t 表示 Tab，\\s 表示一个空格；也可以输入 |、逗号或多个字符。",
      { defaultValue: String(savedSeparator ?? DEFAULTS.columnSeparator) },
    );
    if (separatorInput === undefined) return;
    const separator = parseSeparator(separatorInput);
    const savedWidth = await prg.settings_getOwn("maxColumnWidth");
    const widthInput = await prg.dialog_input(
      "最大列宽",
      "每列宽度上限（100–2000），长文字会自动换行。",
      { defaultValue: String(savedWidth ?? DEFAULTS.maxColumnWidth) },
    );
    if (widthInput === undefined) return;
    const maxWidth = checkedNumber("maxColumnWidth", widthInput, 100, 2000);
    await prg.settings_setOwn("columnSeparator", separatorInput);
    await prg.settings_setOwn("maxColumnWidth", maxWidth);
    return { separator, maxWidth };
  }

  function parseTable(text, separator) {
    if (text.length > 200000) throw new Error("文本过长，请分成较小的表格后再转换。");
    text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    if (!text.includes(separator)) {
      throw new Error("文本中没有找到指定的列分隔符，请检查原文或修改分隔符。");
    }
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    let closedQuote = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            quoted = false;
            closedQuote = true;
          }
        } else cell += char;
      } else if (char === "\n" || text.startsWith(separator, i)) {
        row.push(cell);
        cell = "";
        closedQuote = false;
        if (char === "\n") {
          rows.push(row);
          row = [];
        } else i += separator.length - 1;
      } else if (char === '"' && cell === "" && !closedQuote) {
        quoted = true;
      } else {
        if (closedQuote) throw new Error("带引号的单元格格式不完整，请检查复制的表格文本。");
        cell += char;
      }
    }
    if (quoted) throw new Error("单元格的双引号没有闭合，请检查复制的表格文本。");
    if (!text.endsWith("\n") || cell !== "" || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }
    if (rows.length < 2) throw new Error("至少需要两行表格文本（可包含表头）。");
    const columns = rows.reduce((max, items) => Math.max(max, items.length), 0);
    if (rows.length * columns > 1000) throw new Error("一次最多转换 1000 个单元格，请分批处理。");
    return rows.map((items) => Array.from({ length: columns }, (_, i) => items[i] ?? ""));
  }

  function box(x, y, width, height) {
    return {
      _: "CollisionBox",
      shapes: [{
        _: "Rectangle",
        location: { _: "Vector", x, y },
        size: { _: "Vector", x: width, y: height },
      }],
    };
  }

  function checkedNumber(key, input, min, max) {
    const value = Number(input);
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`扩展设置 ${key} 需要在 ${min} 到 ${max} 之间。`);
    }
    return value;
  }

  async function numberSetting(key, min, max) {
    const saved = await prg.settings_getOwn(key);
    return checkedNumber(key, saved ?? DEFAULTS[key], min, max);
  }

  async function identity(project) {
    const uri = await project.uri;
    return uri.toString();
  }

  async function splitSelectedTable() {
    const project = await prg.tabs_getCurrentProject();
    if (!project) throw new Error("请先打开一个工程。");
    const projectUri = await identity(project);
    const manager = await project.stageManager;
    const selection = await manager.getSelectedEntities();
    if (selection.length !== 1) throw new Error("请只选中一个包含完整表格文本的节点。");
    const source = await selection[0];
    const text = await source.text;
    if (typeof text !== "string" || typeof (await source.sizeAdjust) !== "string") {
      throw new Error("请选择普通文本节点。");
    }
    if (await source.isEditing) throw new Error("请先结束文字编辑，再执行转换。");
    const options = await chooseOptions();
    if (!options) return;
    const { separator, maxWidth } = options;
    const rows = parseTable(text, separator);
    const columns = rows[0].length;
    const columnGap = await numberSetting("columnGap", 0, 200);
    const rowGap = await numberSetting("rowGap", 0, 200);
    const fontSize = await source.getFontSize();
    const padding = await source.getPadding();
    if (padding * 2 + fontSize > maxWidth) {
      throw new Error(`当前字号较大，最大列宽至少需要 ${Math.ceil(padding * 2 + fontSize)}。`);
    }
    const fontScaleLevel = await source.fontScaleLevel;
    const fontFamily = (await source.fontFamily) || "";
    const fontWeight = (await source.fontWeight) || "";
    const color = await source.color;
    const fill = { _: "Color", r: await color.r, g: await color.g, b: await color.b, a: await color.a };
    const renderer = await project.textRenderer;
    const widths = Array(columns).fill(Math.max(100, padding * 2 + fontSize));
    for (const row of rows) {
      for (let c = 0; c < columns; c++) {
        const measured = await renderer.measureMultiLineTextSize(row[c], fontSize, 10000000, 1.5, fontFamily, fontWeight);
        widths[c] = Math.max(widths[c], Math.min(maxWidth, Math.ceil(await measured.x) + padding * 2 + 2));
      }
    }
    const heights = [];
    for (const row of rows) {
      let height = fontSize * 1.5 + padding * 2;
      for (let c = 0; c < columns; c++) {
        const measured = await renderer.measureMultiLineTextSize(row[c], fontSize, widths[c] - padding * 2, 1.5, fontFamily, fontWeight);
        height = Math.max(height, Math.ceil(await measured.y) + padding * 2);
      }
      heights.push(height);
    }

    const sourceId = await source.uuid;
    const sourceRect = await (await source.collisionBox).getRectangle();
    const left = await sourceRect.left;
    let top = (await sourceRect.bottom) + 60;
    const history = await project.historyManager;
    const createdIds = new Set();
    // 保持远程属性路径；await project.stage 会得到数组快照，splice 无法修改宿主画布。
    const stage = project.stage;
    async function assertCurrent() {
      const current = await prg.tabs_getCurrentProject();
      if (!current || (await identity(current)) !== projectUri) {
        throw new Error("转换期间切换了工程，已停止转换。请保持当前工程打开后重试。");
      }
      const liveSource = await manager.get(sourceId);
      if (!liveSource || (await liveSource.text) !== text) {
        throw new Error("原始节点已经发生变化，请重新选择后转换。");
      }
    }
    await assertCurrent();
    await history.recordStep();
    try {
      for (let r = 0; r < rows.length; r++) {
        let x = left;
        for (let c = 0; c < columns; c++) {
          await assertCurrent();
          const uuid = crypto.randomUUID();
          const bounds = box(x, top, widths[c], heights[r]);
          createdIds.add(uuid);
          await manager.add({
            _: "TextNode",
            $rpc: { deserializeWithProject: true },
            uuid,
            text: rows[r][c],
            collisionBox: bounds,
            color: fill,
            sizeAdjust: "manual",
            fontScaleLevel,
            fontFamily,
            fontWeight,
          }, true);
          const node = await manager.get(uuid);
          // TextNode 的构造函数会按内容重算高度；写回统一行高以对齐单元格边界。
          node.collisionBox = box(x, top, widths[c], heights[r]);
          await node.collisionBox;
          x += widths[c] + columnGap;
        }
        top += heights[r] + rowGap;
      }
      await manager.updateReferences();
      await manager.clearSelectAll();
      for (const uuid of createdIds) {
        const node = await manager.get(uuid);
        node.isSelected = true;
        await node.isSelected;
      }
      await history.recordStep();
    } catch (error) {
      try {
        for (let i = (await stage.length) - 1; i >= 0; i--) {
          const node = await stage[i];
          if (createdIds.has(await node.uuid)) await stage.splice(i, 1);
        }
        await manager.updateReferences();
        source.isSelected = true;
        await source.isSelected;
        await history.recordStep();
      } catch (cleanupError) {
        throw new Error(`转换失败：${error.message}。清理未完成：${cleanupError.message}；原文仍保留，请使用撤销检查画布。`);
      }
      throw error;
    }
    await prg.toast_success(`已生成 ${rows.length} 行 × ${columns} 列节点，位于原文下方。原文已保留；按 F 聚焦新节点。`);
  }

  async function run() {
    if (running) return;
    running = true;
    try {
      await splitSelectedTable();
    } catch (error) {
      await prg.toast_error(`表格拆分：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  }

  for (const [key, value] of Object.entries(DEFAULTS)) {
    if ((await prg.settings_getOwn(key)) == null) await prg.settings_setOwn(key, value);
  }
  await prg.keybinds_register("按表格拆分", { $lucide: "Table" }, "k e t", Comlink.proxy(run));
})().catch(async (error) => {
  await prg.toast_error(`表格拆分扩展无法启动：${error instanceof Error ? error.message : String(error)}`);
});
