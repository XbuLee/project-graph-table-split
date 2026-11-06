import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { MessageChannel as NativeMessageChannel } from "node:worker_threads";
import * as Comlink from "comlink";
import vm from "node:vm";
import test from "node:test";

const code = await readFile(new URL("extension.js", import.meta.url), "utf8");
const sample = [
  "列一\t列二\t列三",
  "项目一\t值一\t说明一",
  "项目二\t值二\t说明二",
  "项目三\t值三\t说明三",
  "项目四\t值四\t说明四",
  "项目五\t值五\t说明五",
  "项目六\t值六\t",
].join("\n");

function rect(x, y, width, height) {
  return { left: x, top: y, right: x + width, bottom: y + height, width, height };
}

async function harness(text, options = {}) {
  const callbacks = new Map();
  const errors = [];
  const successes = [];
  const prompts = [];
  const inputs = options.inputs ? [...options.inputs] : null;
  const settings = { ...options.settings };
  const source = {
    uuid: "source", text, sizeAdjust: "manual", isSelected: true, isEditing: false,
    fontScaleLevel: 0, fontFamily: "", fontWeight: "", color: { r: 0, g: 0, b: 0, a: 0 },
    getFontSize: () => options.fontSize ?? 16, getPadding: () => 8,
    collisionBox: { getRectangle: () => rect(20, 30, 400, 120) },
  };
  const stage = [source];
  const snapshots = [];
  let adds = 0;
  const project = {
    uri: { toString: () => "file:///test.prg" },
    stage,
    historyManager: {
      recordStep: () => snapshots.push(stage.map((node) => ({ uuid: node.uuid, text: node.text }))),
    },
    textRenderer: {
      measureMultiLineTextSize(text, fontSize, limit, lineHeight) {
        const lines = text.split("\n");
        const lengths = lines.map((line) => Array.from(line).length * fontSize);
        return { x: Math.min(limit, Math.max(...lengths)), y: lengths.reduce((sum, width) => sum + Math.max(1, Math.ceil(width / limit)), 0) * fontSize * lineHeight };
      },
    },
    stageManager: {
      getSelectedEntities: () => stage.filter((node) => node.isSelected),
      get: (id) => stage.find((node) => node.uuid === id),
      add(data) {
        assert.equal(data._, "TextNode");
        assert.equal(data.$rpc.deserializeWithProject, true);
        adds++;
        if (options.failAt === adds) throw new Error("simulated host failure");
        stage.push({ ...data, isSelected: false });
      },
      updateReferences() {},
      clearSelectAll() { stage.forEach((node) => { node.isSelected = false; }); },
    },
  };
  const prg = {
    tabs_getCurrentProject: () => options.noProject ? null : project,
    settings_getOwn: (key) => settings[key],
    settings_setOwn: (key, value) => { settings[key] = value; },
    dialog_input: (title, description, config) => {
      prompts.push({ title, description, ...config });
      return inputs ? inputs.shift() : config.defaultValue;
    },
    keybinds_register: (id, icon, keys, callback) => { callbacks.set(id, callback); assert.equal(keys, "k e t"); },
    toast_error: (message) => errors.push(message),
    toast_success: (message) => successes.push(message),
  };
  const bridge = options.bridge ? options.bridge(prg, project, source) : null;
  if (bridge) {
    // Keep Object identity in the same realm as Comlink's transfer handlers, as in a real Worker.
    await new Function("prg", "Comlink", "crypto", `return ${code}`)(bridge.prg, bridge.Comlink, { randomUUID });
  } else {
    const context = vm.createContext({ prg, Comlink: { proxy: (value) => value }, crypto: { randomUUID } });
    await vm.runInContext(code, context);
  }
  assert.equal(errors.length, 0, "extension initializes");
  return {
    run: callbacks.get("按表格拆分"), stage, source, snapshots, errors, successes, settings, project, prompts,
  };
}

function bounds(node) {
  const shape = node.collisionBox.shapes[0];
  return rect(shape.location.x, shape.location.y, shape.size.x, shape.size.y);
}

test("table fixture creates 7 × 3 editable cells and preserves the missing last cell", async () => {
  const app = await harness(sample);
  await app.run();
  assert.deepEqual(app.errors, []);
  assert.equal(app.stage.length, 22);
  assert.equal(app.stage[0], app.source);
  assert.equal(app.source.text, sample);
  const cells = app.stage.slice(1);
  assert.deepEqual(cells.slice(0, 3).map((node) => node.text), ["列一", "列二", "列三"]);
  assert.deepEqual(cells.slice(-3).map((node) => node.text), ["项目六", "值六", ""]);
  assert.ok(cells.every((node) => node._ === "TextNode" && node.isSelected));
  assert.ok(bounds(cells[0]).top > app.source.collisionBox.getRectangle().bottom);
  for (let r = 0; r < 7; r++) {
    const row = cells.slice(r * 3, r * 3 + 3).map(bounds);
    assert.ok(row.every((item) => item.top === row[0].top && item.height === row[0].height));
    assert.ok(row[1].left >= row[0].right && row[2].left >= row[1].right);
    if (r > 0) assert.ok(row[0].top >= bounds(cells[(r - 1) * 3]).bottom);
    for (let c = 0; c < 3; c++) assert.equal(row[c].left, bounds(cells[c]).left);
  }
  assert.equal(app.snapshots.length, 2);
  assert.equal(app.snapshots[0].length, 1);
  assert.equal(app.snapshots[1].length, 22);
});

test("keeps internal blank cells and rows, pads ragged rows, accepts CRLF", async () => {
  const app = await harness("A\tB\tC\r\nx\t\t\r\n\t\t\r\ny\tz\r\n");
  await app.run();
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.stage.slice(1).map((node) => node.text), ["A", "B", "C", "x", "", "", "", "", "", "y", "z", ""]);
});

test("handles quoted multiline/tab cells and escaped double quotes", async () => {
  const app = await harness('A\tB\n"a\nb"\t"c\td"\n"say ""hi"""\tplain');
  await app.run();
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.stage.slice(1).map((node) => node.text), ["A", "B", "a\nb", "c\td", 'say "hi"', "plain"]);
});

test("column widths cap long content; all cells in its row share the wrapped height", async () => {
  const app = await harness(`A\tB\nx\t${"很长的内容".repeat(30)}`, { settings: { maxColumnWidth: "160", columnGap: "0", rowGap: "0" } });
  await app.run();
  assert.deepEqual(app.errors, []);
  const cells = app.stage.slice(1).map(bounds);
  assert.equal(cells[1].width, 160);
  assert.ok(cells[2].height > cells[0].height);
  assert.equal(cells[2].height, cells[3].height);
  assert.equal(cells[0].right, cells[1].left);
  assert.equal(cells[0].bottom, cells[2].top);
});

for (const [name, delimiter, text, expected] of [
  ["pipe", "|", "A|B\nx|y", ["A", "B", "x", "y"]],
  ["comma", ",", 'A,B\n"a,b",c', ["A", "B", "a,b", "c"]],
  ["space", " ", "A B\nx y", ["A", "B", "x", "y"]],
  ["space alias", "\\s", "A B\nx y", ["A", "B", "x", "y"]],
  ["multiple characters", "::", "A::B::C\nx::::", ["A", "B", "C", "x", "", ""]],
  ["regex characters are literal", ".*", "A.*B\nx.*y", ["A", "B", "x", "y"]],
  ["ordinary t is literal", "t", "AtB\nxty", ["A", "B", "x", "y"]],
]) {
  test(`custom separator: ${name}`, async () => {
    const app = await harness(text, { inputs: [delimiter, "240"] });
    await app.run();
    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.stage.slice(1).map((node) => node.text), expected);
    assert.equal(app.settings.columnSeparator, delimiter);
    assert.equal(app.settings.maxColumnWidth, 240);
  });
}

test("remembers the delimiter and width for the next conversion", async () => {
  const app = await harness("A|B\nx|y", { settings: { columnSeparator: "|", maxColumnWidth: 180 } });
  await app.run();
  assert.deepEqual(app.errors, []);
  assert.equal(app.prompts[0].defaultValue, "|");
  assert.equal(app.prompts[1].defaultValue, "180");
});

for (const inputs of [[undefined], ["|", undefined]]) {
  test(`cancel dialog ${inputs.length} leaves the canvas and saved options untouched`, async () => {
    const app = await harness("A|B\nx|y", { inputs });
    await app.run();
    assert.deepEqual(app.errors, []);
    assert.equal(app.stage.length, 1);
    assert.equal(app.snapshots.length, 0);
    assert.equal(app.settings.columnSeparator, "\\t");
    assert.equal(app.settings.maxColumnWidth, 480);
  });
}

for (const separator of ["", "\\n", "\n", '"']) {
  test(`rejects invalid separator ${JSON.stringify(separator)}`, async () => {
    const app = await harness(sample, { inputs: [separator, "240"] });
    await app.run();
    assert.equal(app.errors.length, 1);
    assert.equal(app.stage.length, 1);
    assert.equal(app.settings.columnSeparator, "\\t");
  });
}

test("does not exceed maximum width when source font is too large", async () => {
  const app = await harness(sample, { inputs: ["\\t", "100"], fontSize: 120 });
  await app.run();
  assert.equal(app.errors.length, 1);
  assert.match(app.errors[0], /当前字号较大/);
  assert.equal(app.stage.length, 1);
});

for (const [name, text, options] of [
  ["missing tabs", "A B\nx y", {}],
  ["unclosed quotes", 'A\tB\n"oops\tx', {}],
  ["single row", "A\tB", {}],
  ["invalid setting", "A\tB\nx\ty", { settings: { maxColumnWidth: "oops" } }],
  ["too many cells", Array(501).fill("A\tB").join("\n"), {}],
  ["no project", "A\tB\nx\ty", { noProject: true }],
]) {
  test(`${name} reports an error without changing the source`, async () => {
    const app = await harness(text, options);
    await app.run();
    assert.equal(app.errors.length, 1);
    assert.equal(app.stage.length, 1);
    assert.equal(app.source.text, text);
    assert.equal(app.snapshots.length, 0);
  });
}

test("host failure rolls back only generated nodes and keeps source and unrelated nodes", async () => {
  const app = await harness(sample, { failAt: 5 });
  const unrelated = { uuid: "unrelated", text: "keep", isSelected: false };
  app.stage.push(unrelated);
  await app.run();
  assert.equal(app.errors.length, 1);
  assert.equal(app.successes.length, 0);
  assert.deepEqual(app.stage, [app.source, unrelated]);
  assert.equal(app.source.isSelected, true);
});

test("requires exactly one selected text node", async () => {
  const app = await harness(sample);
  app.source.isSelected = false;
  await app.run();
  assert.equal(app.errors.length, 1);
  assert.equal(app.stage.length, 1);
});

test("Comlink boundary contract covers proxies, serialized cells, property writes and rollback", async () => {
  const channels = [];
  const previous = { MessageChannel: globalThis.MessageChannel, ImageBitmap: globalThis.ImageBitmap, OffscreenCanvas: globalThis.OffscreenCanvas };
  globalThis.MessageChannel = class extends NativeMessageChannel {
    constructor() { super(); channels.push(this); }
  };
  globalThis.ImageBitmap = class {};
  globalThis.OffscreenCanvas = class {};
  const existingHandlers = new Map(Comlink.transferHandlers);
  try {
    class HostObject {}
    function hostObject(value) {
      return Object.assign(new HostObject(), value);
    }
    function decode(value) {
      if (value?._ === "TextNode") {
        assert.equal(value.$rpc.deserializeWithProject, true);
        return hostObject({ ...value, collisionBox: decode(value.collisionBox) });
      }
      if (value?._ === "CollisionBox") return hostObject({ shapes: value.shapes.map(decode) });
      if (value?._ === "Rectangle") return hostObject(value);
      return value;
    }
    // A standalone host fixture: arrays cross as snapshots, class instances cross as remote objects.
    const proxyHandler = Comlink.transferHandlers.get("proxy");
    Comlink.transferHandlers.set("TEST_HOST_OBJECTS", {
      canHandle: (value) => value instanceof HostObject || Array.isArray(value),
      serialize(value) {
        const items = Array.isArray(value) ? value : [value];
        const encoded = items.map((item) => proxyHandler.serialize(Comlink.proxy(item)));
        return [{ array: Array.isArray(value), ports: encoded.map(([port]) => port) }, encoded.flatMap(([, ports]) => ports)];
      },
      deserialize(value) {
        const objects = value.ports.map((port) => proxyHandler.deserialize(port));
        return value.array ? objects : objects[0];
      },
    });
    Comlink.transferHandlers.set("CUSTOM_TYPES", {
      canHandle: (value) => value !== null && typeof value === "object" && typeof value._ === "string",
      serialize: (value) => [value, []],
      deserialize: decode,
    });
    function bridge(prg, project, source) {
      for (const key of ["uri", "stageManager", "historyManager", "textRenderer"]) {
        project[key] = hostObject(project[key]);
      }
      Object.setPrototypeOf(project, HostObject.prototype);
      Object.setPrototypeOf(source, HostObject.prototype);
      source.color = hostObject(source.color);
      source.collisionBox = hostObject(source.collisionBox);
      const originalGetRectangle = source.collisionBox.getRectangle;
      source.collisionBox.getRectangle = () => hostObject(originalGetRectangle());
      const measure = project.textRenderer.measureMultiLineTextSize;
      project.textRenderer.measureMultiLineTextSize = (...args) => hostObject(measure(...args));
      const add = project.stageManager.add;
      project.stageManager.add = (data) => {
        add(data);
        Object.setPrototypeOf(project.stage.at(-1), HostObject.prototype);
      };
      const channel = new globalThis.MessageChannel();
      Comlink.expose({ ...prg, tabs_getCurrentProject: () => Comlink.proxy(project) }, channel.port1);
      return { prg: Comlink.wrap(channel.port2), Comlink };
    }
    const success = await harness(sample, { bridge });
    await success.run();
    assert.deepEqual(success.errors, []);
    assert.equal(success.stage.length, 22);
    assert.ok(success.stage.slice(1).every((node) => node.isSelected));
    assert.equal(success.stage.at(-1).text, "");
    const failed = await harness(sample, { bridge, failAt: 5 });
    await failed.run();
    assert.equal(failed.errors.length, 1);
    assert.equal(failed.stage.length, 1, "rollback must splice the remote stage rather than an array snapshot");
    assert.equal(failed.source.text, sample);
  } finally {
    for (const { port1, port2 } of channels) { port1.close(); port2.close(); }
    for (const key of ["TEST_HOST_OBJECTS", "CUSTOM_TYPES"]) {
      if (existingHandlers.has(key)) Comlink.transferHandlers.set(key, existingHandlers.get(key));
      else Comlink.transferHandlers.delete(key);
    }
    Object.assign(globalThis, previous);
  }
});
