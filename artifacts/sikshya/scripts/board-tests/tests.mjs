/**
 * What the whiteboard has to get right, as tests.
 *
 * Each entry is one property of a working lesson, written as the failure it guards against.
 * Every one of these has been broken in production at least once.
 */
import { ERASER, PEN, RED_PNG, TWO_PAGE_PDF, drawPath, ink, near, openBoard, pump, relayMessages, roughCircle, selectTool, stroke, takeMessages, writingPath } from "./harness.mjs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makePdf } from "./pdf-fixture.mjs";

export const tests = [
  {
    name: "a second fourteen-page PDF appears and phone students follow teacher zoom",
    why: "An import must be visible after preparation, not overwrite the previous document, and fit the same phone canvas on both sides.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const student = await openBoard(ctx, baseUrl, { readOnly: true });
      for(const page of [teacher,student]) {
        await page.setViewportSize({width:390,height:844});
        await page.evaluate(()=>window.postMessage(JSON.stringify({type:'config',classroomChrome:true}),'*'));
      }
      const insert = async (key,pages) => {
        await teacher.evaluate(document=>window.postMessage(JSON.stringify({type:'insert_document',document}),'*'),{key,kind:'pdf',dataUrl:makePdf(pages)});
        await teacher.waitForFunction(count=>window.__out.filter(m=>m.type==='scene_out').flatMap(m=>m.elements).filter(e=>e.customData?.fadkoTotal===count).length>=count,pages,{timeout:60000});
        await teacher.waitForTimeout(550);
        const packets=await takeMessages(teacher);
        await relayMessages(packets,student);
        await student.waitForTimeout(700);
        return packets.filter(m=>m.type==='scene_out');
      };
      const first=await insert('one-page',1);
      const second=await insert('fourteen-pages',14);
      const pictures=second.flatMap(m=>m.elements).filter(e=>e.type==='image');
      assert('all fourteen new sheets are placed and shared', pictures.length===14 && second.flatMap(m=>m.files).length===14);
      const original=first.flatMap(m=>m.elements).find(e=>e.type==='image');
      assert('new PDF does not cover the old PDF', pictures.every(e=>e.x>original.x+original.width));
      assert('each sheet retains its document and page number', new Set(pictures.map(e=>e.customData.fadkoPage)).size===14);
      const beforeT=await ink(teacher), beforeS=await ink(student);
      assert('first sheet is visibly rendered on both phones', beforeT.red>1000 && beforeS.red>1000);
      assert('matching phone canvases show matching PDF scale', Math.abs(beforeT.red-beforeS.red)<beforeT.red*0.03);
      await teacher.getByLabel('Whiteboard zoom',{exact:true}).click();
      assert('opening Zoom asks the host to clear floating classroom controls', await teacher.evaluate(()=>window.__out.filter(m=>m.type==='overlay_out').at(-1)?.open===true));
      assert('temporary import notices do not cover the open Zoom panel', await teacher.locator('.Toast').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).visibility==='hidden')));
      await teacher.getByLabel('Zoom in on whiteboard',{exact:true}).click();
      await teacher.waitForTimeout(450); await pump(teacher,student); await student.waitForTimeout(450);
      const afterT=await ink(teacher), afterS=await ink(student);
      assert('teacher zoom visibly enlarges the PDF', afterT.red>beforeT.red*1.1);
      assert('student follows the enlarged view without a gesture', Math.abs(afterT.red-afterS.red)<afterT.red*0.03);
      await teacher.getByText('Fit current sheet',{exact:true}).click();
      await teacher.waitForTimeout(450); await pump(teacher,student); await student.waitForTimeout(450);
      assert('Fit returns the current sheet, not all fourteen tiny pages', (await ink(student)).red>1000);
      await teacher.getByLabel('Close whiteboard zoom').click();
      assert('closing Zoom restores floating classroom controls', await teacher.evaluate(()=>window.__out.filter(m=>m.type==='overlay_out').at(-1)?.open===false));
      await teacher.getByLabel('Manage teaching materials').click();
      await teacher.getByLabel('Find PDF page 14 of 14 on board').click();
      await teacher.waitForTimeout(450); await pump(teacher,student); await student.waitForTimeout(450);
      assert('last PDF sheet can be located and appears on the student board', (await ink(student)).red>1000);
      await teacher.getByLabel('Close board page menu').click();
      await teacher.getByLabel('Manage teaching materials').click();
      await teacher.getByLabel('Remove all pages of PDF 2').click();
      await teacher.getByLabel('Close board page menu').click();
      await teacher.waitForTimeout(300); await pump(teacher,student);
      const retry=await insert('fourteen-retry',14);
      assert('removing and importing again adds a fresh complete PDF',retry.flatMap(m=>m.elements).filter(e=>!e.isDeleted && e.customData?.fadkoTotal===14).length===14);
      const shots=path.join(tmpdir(),'fadko-pdf-phones'); mkdirSync(shots,{recursive:true});
      await teacher.screenshot({path:path.join(shots,'teacher.png')});
      await student.screenshot({path:path.join(shots,'student.png')});
      await student.setViewportSize({width:844,height:390});
      await student.waitForTimeout(800);
      assert('rotating student phone still keeps the teacher sheet visible', (await ink(student)).red>1000);
    },
  },
  {
    name: "classroom toolbar stays together on phone and desktop",
    why: "Controls must be alongside the editor toolbar, inside the viewport and actually tappable.",
    async run(ctx, baseUrl, assert) {
      const page = await openBoard(ctx, baseUrl, { readOnly: false });
      await page.evaluate(() => window.postMessage(JSON.stringify({ type: "config", classroomChrome: true }), "*"));
      const shots = path.join(tmpdir(), "fadko-board-chrome");
      mkdirSync(shots, { recursive: true });
      for (const width of [360, 390, 768, 1366, 1440, 1920]) {
        await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
        await page.waitForTimeout(900);
        const geometry = await page.evaluate(() => {
          const history = document.querySelector('.sikshya-board__history').getBoundingClientRect();
          const toolbar = document.querySelector('.App-toolbar').getBoundingClientRect();
          return { history: { left: history.left, right: history.right, top: history.top, bottom: history.bottom },
            toolbar: { left: toolbar.left, right: toolbar.right, top: toolbar.top, bottom: toolbar.bottom },
            overflow: document.documentElement.scrollWidth > innerWidth + 1 };
        });
        const h = geometry.history, t = geometry.toolbar;
        if (geometry.overflow || h.left < 0 || h.right > width || t.left < 0 || t.right > width) console.log('   geometry', width, geometry);
        assert(width + ': history is in the toolbar band, not midway down the board', h.top < 70);
        assert(width + ': toolbar and history are inside the viewport', !geometry.overflow && h.left >= 0 && h.right <= width && t.left >= 0 && t.right <= width);
        assert(width + ': toolbar does not overlap history', h.bottom <= t.top || t.bottom <= h.top || h.left >= t.right || t.left >= h.right);
        const inkButton = page.getByRole('button', { name: 'Choose ink colour and thickness', exact: true });
        await inkButton.click();
        const blue = page.getByRole('button', { name: 'Blue writing colour', exact: true });
        const box = await blue.boundingBox();
        assert(width + ': colour targets are at least 44 by 44', box.width >= 44 && box.height >= 44);
        await blue.click();
        assert(width + ': colour choice is active', await blue.getAttribute('aria-pressed') === 'true');
        await page.screenshot({ path: path.join(shots, width + '-ink.png') });
        await inkButton.click();
        await page.screenshot({ path: path.join(shots, width + '-toolbar.png') });
      }
    },
  },
  {
    name: "rejoin restores image pixels immediately without a teacher page switch",
    why: "An image snapshot must populate Excalidraw's decoded cache and full catch-up must replace missed deletions.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      await teacher.evaluate((dataUrl) => window.postMessage(JSON.stringify({
        type: "insert_document", document: { key: "rejoin-photo", kind: "image", dataUrl },
      }), "*"), RED_PNG);
      await teacher.waitForTimeout(1000);
      const sent = await takeMessages(teacher);
      const scene = sent.filter((message) => message.type === "scene_out");
      const elements = [...new Map(scene.flatMap((message) => message.elements).map((element) => [element.id, element])).values()];
      const files = scene.flatMap((message) => message.files ?? []);
      const view = sent.filter((message) => message.type === "view_out").at(-1)?.view;
      assert("snapshot includes picture bytes", files.length > 0);
      const student = await openBoard(ctx, baseUrl, { readOnly: true });
      const snapshot = { full: true, pageId: "rejoin-page", elements, files };
      await student.evaluate(({ snapshot, view }) => {
        window.postMessage(JSON.stringify({ type: "pages_in", pages: [{ id: "rejoin-page", title: "Lesson page", template: "blank", locked: false }], activePageId: "rejoin-page" }), "*");
        window.postMessage(JSON.stringify({ type: "scene_in", delta: snapshot }), "*");
        if (view) window.postMessage(JSON.stringify({ type: "view_in", view }), "*");
      }, { snapshot, view });
      await student.waitForTimeout(500);
      assert("fresh join on a non-default page paints the image", (await ink(student)).red > 200);
      await student.evaluate((delta) => window.postMessage(JSON.stringify({ type: "scene_in", delta }), "*"), snapshot);
      await student.waitForTimeout(300);
      assert("same-version reconnect keeps the image visible", (await ink(student)).red > 200);
      await student.evaluate(() => window.postMessage(JSON.stringify({ type: "scene_in", delta: { full: true, pageId: "rejoin-page", elements: [], files: [] } }), "*"));
      await student.waitForTimeout(300);
      assert("an empty reconnect snapshot clears material deleted while offline", (await ink(student)).red === 0);
    },
  },
  {
    name: "locked materials can be unlocked and removed without right-click",
    why: "The owner encountered browser and editor menus stacked over a locked image.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      await teacher.evaluate((dataUrl) => window.postMessage(JSON.stringify({
        type: "insert_document", document: { key: "manager-photo", kind: "image", dataUrl },
      }), "*"), RED_PNG);
      await teacher.waitForTimeout(1000);
      await selectTool(teacher, ERASER);
      await teacher.getByRole("button", { name: "Manage teaching materials", exact: true }).click();
      assert("the materials list opens with ordinary click", await teacher.getByText("Teaching materials", { exact: true }).isVisible());
      const unlock = teacher.getByRole("button", { name: "Unlock Picture 1", exact: true });
      if (!(await unlock.count())) await teacher.getByRole("button", { name: "Lock Picture 1", exact: true }).click();
      await unlock.click();
      assert("unlock changes the available action back to Lock", await teacher.getByRole("button", { name: "Lock Picture 1", exact: true }).isVisible());
      await teacher.getByRole("button", { name: "Remove Picture 1", exact: true }).click();
      await teacher.waitForTimeout(300);
      assert("remove deletes the picture, not just a menu entry", (await ink(teacher)).red === 0);
      await teacher.getByRole("button", { name: "Close board page menu", exact: true }).click();
      await teacher.getByLabel("Undo last board change", { exact: true }).click();
      await teacher.waitForTimeout(300);
      if ((await ink(teacher)).red === 0) {
        console.log('   material undo events', (await takeMessages(teacher)).filter((m) => m.type === 'scene_out').map((m) => m.elements.map((e) => ({ type: e.type, deleted: e.isDeleted, locked: e.locked, version: e.version }))));
      }
      assert("Undo restores the removed material", (await ink(teacher)).red > 200);
    },
  },
  {
    name: "an erased stroke disappears for the student too",
    why:
      "Excalidraw flags a rubbed-out element isDeleted and bumps its version rather than " +
      "removing it, and getSceneElements() hides exactly those — so the outgoing diff saw no " +
      "change and students kept every mistake the teacher had erased.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const student = await openBoard(ctx, baseUrl, { readOnly: true });

      await selectTool(teacher, PEN);
      await stroke(teacher, 150, 300, 380, 480);
      await pump(teacher, student);
      assert("the student sees what was drawn", (await ink(student)).left > 0);
      assert(
        "and sees it identically",
        (await ink(student)).n === (await ink(teacher)).n,
      );

      await selectTool(teacher, ERASER);
      await stroke(teacher, 150, 300, 380, 480);
      await selectTool(teacher, PEN);
      await stroke(teacher, 560, 300, 780, 480);
      await pump(teacher, student);

      const t = await ink(teacher);
      const s = await ink(student);
      assert("the teacher's own board dropped the erased stroke", t.left === 0 && t.right > 0);
      assert("the student's board dropped it too", s.left === 0);
      assert("and kept what replaced it", s.right > 0);
      assert("pixel for pixel", s.n === t.n);
    },
  },

  {
    name: "undo and redo are visible classroom controls",
    why:
      "The board library has history internally, but the page strip and call controls covered " +
      "its small mobile buttons. A teacher needs an obvious way back after one accidental mark.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const undo = teacher.getByLabel("Undo last board change");
      const redo = teacher.getByLabel("Redo board change");

      assert("Undo starts disabled when no history exists", await undo.isDisabled());
      assert("Redo starts disabled when no history exists", await redo.isDisabled());

      await selectTool(teacher, PEN);
      await stroke(teacher, 260, 280, 560, 440);
      assert("the test begins with a visible mark", (await ink(teacher)).n > 0);
      assert("Undo becomes available after a change", !(await undo.isDisabled()));
      assert("Redo stays disabled before an Undo", await redo.isDisabled());

      await undo.click();
      await teacher.waitForTimeout(450);
      assert("Undo removes the last mark", (await ink(teacher)).n === 0);
      assert("Redo becomes available after Undo", !(await redo.isDisabled()));

      await redo.click();
      await teacher.waitForTimeout(450);
      assert("Redo restores it", (await ink(teacher)).n > 0);
      assert("Redo disables again after restoring the only undone change", await redo.isDisabled());
    },
  },

  {
    name: "a picture the teacher shares actually reaches the student",
    why:
      "Excalidraw keeps a picture's bytes in a separate map from the element that draws it. " +
      "The sync sent only elements, so students got an empty picture frame — and when the " +
      "teacher resized it, a bigger empty frame.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const student = await openBoard(ctx, baseUrl, { readOnly: true });

      // The same route the app uses to hand a photo to the board.
      await teacher.evaluate(
        (dataUrl) =>
          window.postMessage(
            JSON.stringify({
              type: "insert_document",
              document: { key: "photo-test-1", dataUrl, kind: "image" },
            }),
            "*",
          ),
        RED_PNG,
      );
      await teacher.waitForTimeout(1200);

      const onTeacher = await ink(teacher);
      assert("the picture is on the teacher's board", onTeacher.red > 200);

      await pump(teacher, student);
      await student.waitForTimeout(400);
      const onStudent = await ink(student);
      assert("and on the student's board", onStudent.red > 200);
      assert(
        "at the same size, not as an empty frame",
        Math.abs(onStudent.red - onTeacher.red) < onTeacher.red * 0.1,
      );
    },
  },

  {
    name: "the eraser removes annotation without damaging the lesson page",
    why:
      "A broad eraser gesture used to cut holes through an uploaded image or PDF page along " +
      "with the handwriting above it. Imported lesson material must be deleted deliberately.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const student = await openBoard(ctx, baseUrl, { readOnly: true });

      await teacher.evaluate(
        (dataUrl) =>
          window.postMessage(
            JSON.stringify({
              type: "insert_document",
              document: { key: "protected-photo-1", dataUrl, kind: "image" },
            }),
            "*",
          ),
        RED_PNG,
      );
      await teacher.waitForTimeout(1200);
      const paper = await ink(teacher);
      assert("the lesson picture is visible before annotation", paper.red > 200);

      await selectTool(teacher, PEN);
      await stroke(teacher, 390, 310, 510, 410);
      const annotated = await ink(teacher);
      assert("handwriting was added over the lesson", annotated.n > paper.n);

      await selectTool(teacher, ERASER);
      await stroke(teacher, 390, 310, 510, 410);
      await teacher.waitForTimeout(450);
      const cleaned = await ink(teacher);
      assert("the handwriting was erased", cleaned.n < annotated.n);
      assert("the picture was not erased", cleaned.red > paper.red * 0.9);
      assert(
        "the teacher is told how to delete a fixed object",
        (await teacher.getByText(/Eraser removes writing only/).count()) === 1,
      );

      await pump(teacher, student);
      await student.waitForTimeout(400);
      assert("students keep the intact lesson picture too", (await ink(student)).red > paper.red * 0.9);
    },
  },

  {
    name: "a selected lesson object can be deleted and restored",
    why:
      "The eraser intentionally protects lesson material, so teachers need a deliberate object " +
      "action for images, PDF pages and shapes — plus an Undo path after an accidental deletion.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const student = await openBoard(ctx, baseUrl, { readOnly: true });

      await teacher.evaluate(
        (dataUrl) =>
          window.postMessage(
            JSON.stringify({
              type: "insert_document",
              document: { key: "delete-picture-1", dataUrl, kind: "image" },
            }),
            "*",
          ),
        RED_PNG,
      );
      await teacher.waitForTimeout(1200);
      await teacher.waitForTimeout(400);
      await pump(teacher, student);
      await student.waitForTimeout(500);
      const original = await ink(teacher);
      assert("the lesson object starts on both boards", original.red > 200 && (await ink(student)).red > 200);

      await teacher.mouse.click(450, 400);
      await teacher.keyboard.press("1");
      await teacher.mouse.click(450, 350);
      await teacher.waitForTimeout(300);
      assert(
        "selecting the object opens deliberate actions",
        (await teacher.locator('[data-testid="board-selection-toolbar"]').count()) === 1,
      );

      await teacher.locator('[data-testid="board-delete-selection"]').click();
      await teacher.waitForTimeout(450);
      await pump(teacher, student);
      assert("Delete removes the selected image for the teacher", (await ink(teacher)).red < original.red * 0.1);
      assert("and removes it for the student", (await ink(student)).red < original.red * 0.1);

      const undo = teacher.getByLabel("Undo last board change");
      assert("Undo is available after object deletion", !(await undo.isDisabled()));
      await undo.click();
      await teacher.waitForTimeout(450);
      await pump(teacher, student);
      assert("Undo restores the lesson object for the teacher", (await ink(teacher)).red > original.red * 0.9);
      assert("and restores it for the student", (await ink(student)).red > original.red * 0.9);
    },
  },

  {
    name: "a selected drawn shape can be deleted and restored",
    why:
      "The contextual action must work on native Excalidraw shapes, not only imported images.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const student = await openBoard(ctx, baseUrl, { readOnly: true });
      await selectTool(teacher, "2");
      await stroke(teacher, 480, 250, 640, 380);
      await teacher.waitForTimeout(500);
      await pump(teacher, student);
      const original = await ink(student);
      assert("the rectangle reaches the student", original.n > 100);

      await selectTool(teacher, "1");
      await teacher.mouse.click(480, 250);
      assert("the rectangle offers object actions", (await teacher.getByTestId("board-selection-toolbar").count()) === 1);
      await teacher.getByTestId("board-delete-selection").click();
      await teacher.waitForTimeout(450);
      await pump(teacher, student);
      assert("the rectangle is removed from both boards", (await ink(teacher)).n < original.n * 0.1 && (await ink(student)).n < original.n * 0.1);
      await teacher.getByLabel("Undo last board change").click();
      await teacher.waitForTimeout(450);
      await pump(teacher, student);
      assert("Undo restores the rectangle to both boards", (await ink(teacher)).n > original.n * 0.9 && (await ink(student)).n > original.n * 0.9);
    },
  },

  {
    name: "a shared PDF becomes pages on the board that students can see",
    why:
      "A PDF used to be broadcast and rendered separately by everyone: the teacher got a PDF " +
      "viewer with the whiteboard hidden behind it, students got a broken half-view, and " +
      "neither could tell they were looking at different things.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const student = await openBoard(ctx, baseUrl, { readOnly: true });

      await teacher.evaluate(
        (dataUrl) =>
          window.postMessage(
            JSON.stringify({
              type: "insert_document",
              document: { key: "pdf-test-1", dataUrl, kind: "pdf" },
            }),
            "*",
          ),
        TWO_PAGE_PDF,
      );
      // Loading the engine, rasterising two pages and placing them.
      await teacher.waitForTimeout(6000);

      const onTeacher = await ink(teacher);
      assert("the pages rendered onto the teacher's board", onTeacher.red > 500);

      await pump(teacher, student);
      await student.waitForTimeout(600);
      const onStudent = await ink(student);
      assert("and reached the student as pictures, not an empty frame", onStudent.red > 500);
      assert(
        "showing the same thing",
        Math.abs(onStudent.red - onTeacher.red) < onTeacher.red * 0.1,
      );

      // The point of pages-as-pictures: they can be drawn on like anything else.
      await selectTool(teacher, PEN);
      await stroke(teacher, 380, 300, 520, 420);
      await pump(teacher, student);
      const annotated = await ink(student);
      assert("and can be annotated, with the ink reaching the student", annotated.n > 0);
    },
  },

  {
    name: "the student's view follows the teacher's",
    why:
      "On an infinite canvas, matching elements is not the same as matching views. A student " +
      "must stay on the teacher's view even after trying to pan or zoom away.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const student = await openBoard(ctx, baseUrl, { readOnly: true });

      await selectTool(teacher, PEN);
      await stroke(teacher, 380, 330, 520, 430);
      await pump(teacher, student);

      await teacher.mouse.move(450, 380);
      await teacher.keyboard.down("Control");
      for (let i = 0; i < 6; i++) {
        await teacher.mouse.wheel(0, -240);
        await teacher.waitForTimeout(60);
      }
      await teacher.keyboard.up("Control");
      await teacher.waitForTimeout(500);
      await pump(teacher, student);

      const t = await ink(teacher);
      const s = await ink(student);
      assert("the teacher is zoomed in", t.n > 0);
      assert(
        "and the student is looking at the same place",
        near(t.minX, s.minX) && near(t.minY, s.minY) && near(t.maxX, s.maxX),
      );

      // Students follow throughout the lesson; their gestures cannot detach the read-only board.
      await takeMessages(student);
      await student.mouse.move(450, 350);
      await student.keyboard.down("Space");
      await student.mouse.down();
      await student.mouse.move(250, 250, { steps: 8 });
      await student.mouse.up();
      await student.keyboard.up("Space");
      await student.mouse.wheel(0, -240);
      await student.waitForTimeout(400);
      const afterGesture = await ink(student);
      assert(
        "student pan and zoom gestures cannot leave the teacher's view",
        near(s.minX, afterGesture.minX) && near(s.minY, afterGesture.minY) &&
          near(s.maxX, afterGesture.maxX) && near(s.maxY, afterGesture.maxY),
      );
      assert(
        "the student cannot send a competing view",
        !(await takeMessages(student)).some((message) => message.type === "view_out"),
      );
      assert("there is no unnecessary return control", (await student.getByText("Return to teacher").count()) === 0);

      await teacher.mouse.move(450, 350);
      await teacher.keyboard.down("Space");
      await teacher.mouse.down();
      await teacher.mouse.move(510, 390, { steps: 8 });
      await teacher.mouse.up();
      await teacher.keyboard.up("Space");
      await teacher.waitForTimeout(450);
      await pump(teacher, student);
      const movedTeacher = await ink(teacher);
      const movedStudent = await ink(student);
      assert(
        "the teacher can move to another part of the lesson",
        !near(t.minX, movedTeacher.minX, 10) || !near(t.minY, movedTeacher.minY, 10),
      );
      assert(
        "the student follows the teacher's new view",
        near(movedTeacher.minX, movedStudent.minX) && near(movedTeacher.minY, movedStudent.minY),
      );

      await takeMessages(teacher);
      await teacher.locator('.main-menu-trigger').first().click();
      await teacher.getByText("Bring everyone to my view").click();
      const focusMessages = await takeMessages(teacher);
      const forcedView = focusMessages.find((message) => message.type === "view_out")?.view;
      assert("the teacher's explicit focus carries a new focus signal", typeof forcedView?.focusId === "number");
      await relayMessages(focusMessages, student);
      await student.waitForTimeout(450);
      const broughtBack = await ink(student);
      assert(
        "Bring everyone here keeps the student's view aligned",
        near(movedTeacher.minX, broughtBack.minX) && near(movedTeacher.minY, broughtBack.minY),
      );
    },
  },

  {
    name: "clearing the board clears it for the class",
    why:
      "Excalidraw's own reset only empties the local copy, so every student would have kept " +
      "the whole lesson on screen while the teacher started the next problem on a blank one.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const student = await openBoard(ctx, baseUrl, { readOnly: true });

      await selectTool(teacher, PEN);
      for (const [x, y] of [[200, 250], [400, 500], [650, 300]]) {
        await stroke(teacher, x, y, x + 90, y + 70);
      }
      await pump(teacher, student);
      assert("there is a lesson on the board", (await ink(student)).n > 0);

      // Cancelling must leave the lesson alone — this is a destructive, class-wide action.
      const studentInkBeforeCancel = (await ink(student)).n;
      await teacher.locator('button[aria-label="Clear this page for the whole class"]').click();
      await teacher.getByRole("dialog").getByRole("button", { name: "Go back" }).click();
      assert("cancelling the confirmation changes nothing", (await ink(teacher)).n > 0);
      // The host is told to clear/restore its floating dock around the dialog. These visibility
      // events never go to classmates; cancellation must still emit no lesson-changing event.
      assert("cancelling sends no lesson changes", (await pump(teacher, student)).every(type => type === "overlay_out"));
      assert("the student's lesson is unchanged after cancellation", (await ink(student)).n === studentInkBeforeCancel);

      await teacher.locator('button[aria-label="Clear this page for the whole class"]').click();
      await teacher.getByRole("dialog").getByRole("button", { name: "Clear page" }).click();
      await teacher.waitForTimeout(500);
      const sent = await pump(teacher, student);
      assert("confirming sends undoable deletions to the class", sent.includes("scene_out") && !sent.includes("clear_out"));
      assert("the teacher's board is empty", (await ink(teacher)).n === 0);
      assert("and so is the student's", (await ink(student)).n === 0);
      await teacher.getByLabel("Undo last board change").click();
      await teacher.waitForTimeout(400);
      await pump(teacher, student);
      assert("Undo restores the whole cleared page for the teacher", (await ink(teacher)).n > 0);
      assert("Undo restores the page for the student too", (await ink(student)).n > 0);
      await teacher.setViewportSize({ width: 390, height: 844 });
      await teacher.getByLabel("Open board pages").click();
      await teacher.getByRole("button", { name: "Clear this page…", exact: true }).click();
      assert("phone page menu opens the same precise confirmation", (await teacher.getByRole("dialog").innerText()).includes("images and PDF sheets"));
      await teacher.getByRole("dialog").getByRole("button", { name: "Go back" }).click();
    },
  },

  {
    name: "board pages stay separate and the student follows the teacher",
    why:
      "A delayed Excalidraw update used to cross a page switch, and locking a page removed the " +
      "teacher's only way to unlock it. A multi-page board is useful only if each page keeps " +
      "its own lesson and the student's screen follows the same page without editing controls.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const student = await openBoard(ctx, baseUrl, { readOnly: true });
      const post = (page, message) => page.evaluate(
        (payload) => window.postMessage(JSON.stringify(payload), "*"),
        message,
      );
      const pages = [
        { id: "page-1", title: "Warm-up", template: "blank", locked: false },
        { id: "page-2", title: "Worked example", template: "graph", locked: false },
      ];

      await takeMessages(teacher);
      await selectTool(teacher, PEN);
      await stroke(teacher, 150, 260, 330, 430);
      const firstPageMessages = await takeMessages(teacher);
      const firstPageScene = firstPageMessages.filter((message) => message.type === "scene_out");
      assert("Page 1 ink names the page it belongs to", firstPageScene.length > 0 && firstPageScene.every((message) => message.pageId === "page-1"));
      await relayMessages(firstPageMessages, student);
      assert("the student sees Page 1", (await ink(student)).n > 0);

      await teacher.getByLabel("Add board page").click();
      await teacher.waitForTimeout(100);
      const addMessages = await takeMessages(teacher);
      assert("adding a page asks the server instead of inventing local state", addMessages.some((message) => message.type === "pages_out" && message.command?.op === "add"));

      for (const page of [teacher, student]) {
        await post(page, { type: "pages_in", pages, activePageId: "page-2" });
        await post(page, { type: "scene_in", delta: { full: true, pageId: "page-2", elements: [], files: [] } });
      }
      await teacher.waitForTimeout(450);
      assert("the teacher moved to Page 2", (await teacher.getByText(/Worked example/).count()) > 0);
      assert(
        "the student has no independent page controls",
        (await student.getByLabel("Previous board page").count()) === 0 &&
          (await student.getByLabel("Next board page").count()) === 0 &&
          (await student.getByLabel("Show board page thumbnails").count()) === 0,
      );
      assert("Page 1 ink did not leak onto Page 2 for the teacher", (await ink(teacher)).n === 0);
      assert("or for the student", (await ink(student)).n === 0);

      await selectTool(teacher, PEN);
      await stroke(teacher, 570, 260, 760, 430);
      const secondPageMessages = await takeMessages(teacher);
      const secondPageScene = secondPageMessages.filter((message) => message.type === "scene_out");
      assert("Page 2 ink remains labelled Page 2 even after the switch", secondPageScene.length > 0 && secondPageScene.every((message) => message.pageId === "page-2"));
      await relayMessages(secondPageMessages, student);
      assert("the student sees Page 2 ink", (await ink(student)).n > 0);

      await teacher.getByLabel("Previous board page").click();
      await teacher.waitForTimeout(100);
      const selectMessages = await takeMessages(teacher);
      assert("page navigation is a server-owned command", selectMessages.some((message) => message.type === "pages_out" && message.command?.op === "select" && message.command?.pageId === "page-1"));

      const firstElements = firstPageScene.flatMap((message) => message.elements ?? []);
      const firstFiles = firstPageScene.flatMap((message) => message.files ?? []);
      for (const page of [teacher, student]) {
        await post(page, { type: "pages_in", pages, activePageId: "page-1" });
        await post(page, { type: "scene_in", delta: { full: true, pageId: "page-1", elements: firstElements, files: firstFiles } });
      }
      await teacher.waitForTimeout(500);
      assert("returning to Page 1 restores its own ink", (await ink(teacher)).n > 0);
      assert("and restores the same page for the student", (await ink(student)).n > 0);
      assert("students never receive an Add page control", (await student.getByLabel("Add board page").count()) === 0);

      const lockedPages = pages.map((page) => page.id === "page-1" ? { ...page, locked: true } : page);
      await post(teacher, { type: "pages_in", pages: lockedPages, activePageId: "page-1" });
      await teacher.waitForTimeout(250);
      await teacher.getByLabel("Open board pages").click();
      assert("a locked page still gives its teacher an Unlock control", (await teacher.getByText("Unlock", { exact: true }).count()) === 1);
      await teacher.getByText("Unlock", { exact: true }).click();
      const unlockMessages = await takeMessages(teacher);
      assert("unlocking goes through the server", unlockMessages.some((message) => message.type === "pages_out" && message.command?.op === "lock" && message.command?.locked === false));

      await teacher.setViewportSize({ width: 320, height: 700 });
      await teacher.waitForTimeout(300);
      const nav = await teacher.locator(".sikshya-board__pages").boundingBox();
      const visibleButtons = await teacher.locator(".sikshya-board__pages button:visible").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
      assert("the page controls stay inside a 320px phone", Boolean(nav && nav.x >= 0 && nav.x + nav.width <= 320));
      assert("every visible page control keeps a 44px touch target", visibleButtons.every((height) => height >= 44));
    },
  },

  {
    name: "the teacher's laser is immediate and temporary",
    why:
      "A presenter pointer must feel live without becoming permanent board content. The class " +
      "should see it immediately, and switching it off must remove it instead of waiting for a timeout.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const student = await openBoard(ctx, baseUrl, { readOnly: true });
      await takeMessages(teacher);

      await teacher.getByLabel("Point for the class").click();
      await teacher.mouse.move(460, 350);
      await teacher.waitForTimeout(100);
      const active = await takeMessages(teacher);
      assert("moving the pointer emits a bounded live point", active.some((message) => message.type === "laser_out" && message.laser?.active === true && message.laser.x >= 0 && message.laser.x <= 1));
      await relayMessages(active, student);
      assert("the student sees the teacher's pointer", (await student.getByLabel("Teacher laser pointer").count()) === 1);

      await teacher.getByLabel("Point for the class").click();
      const stopped = await takeMessages(teacher);
      assert("turning the pointer off emits an explicit stop", stopped.some((message) => message.type === "laser_out" && message.laser?.active === false));
      await relayMessages(stopped, student);
      assert("the pointer disappears without becoming saved ink", (await student.getByLabel("Teacher laser pointer").count()) === 0 && (await ink(student)).n === 0);
    },
  },

  {
    name: "a student with no teacher view still lands on the lesson",
    why:
      "The viewport is a newer message than the elements. A student joining from an older " +
      "build, or before the teacher's board has published one, must not be left staring at " +
      "an empty stretch of an infinite canvas.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const student = await openBoard(ctx, baseUrl, { readOnly: true });

      await selectTool(teacher, PEN);
      await stroke(teacher, 430, 380, 560, 470);
      // Scroll a long way, so the work sits far from the origin the student opens at.
      await teacher.keyboard.down("Space");
      await teacher.mouse.move(600, 500);
      await teacher.mouse.down();
      await teacher.mouse.move(120, 120, { steps: 10 });
      await teacher.mouse.up();
      await teacher.keyboard.up("Space");
      await teacher.waitForTimeout(400);

      // Forward the elements only — no view messages at all.
      const msgs = await teacher.evaluate(() => {
        const out = window.__out;
        window.__out = [];
        return out;
      });
      for (const m of msgs.filter((m) => m.type === "scene_out")) {
        await student.evaluate(
          (els) =>
            window.postMessage(
              JSON.stringify({ type: "scene_in", delta: { full: true, elements: els } }),
              "*",
            ),
          m.elements,
        );
      }
      await student.waitForTimeout(900);
      assert("the student was fitted onto the content", (await ink(student)).n > 0);
    },
  },

  {
    name: "the Library opens on shapes built for teaching",
    why:
      "Excalidraw's Library button browsed community collections hosted elsewhere — flowchart " +
      "icons, UML, cloud architecture — which is no use to a tutor explaining fractions, and " +
      "often does not load at all on a poor connection.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });

      // The trigger's text label is hidden at narrow widths; the button itself is what a
      // teacher taps either way.
      await teacher.locator(".sidebar-trigger, [data-testid='sidebar-trigger']").first().click();
      await teacher.waitForTimeout(1500);

      const panel = teacher.locator(".layer-ui__library, .library-menu-items-container, .sidebar");
      assert("the Library panel opens", (await panel.count()) > 0);

      // The names come from boardLibrary.ts. If the panel is empty, a teacher is looking at
      // the same useless browser as before.
      const shapes = await teacher.locator('[class*="library-unit"], .library-unit').count();
      assert("and it is stocked with shapes", shapes >= 5);

      const body = await teacher.evaluate(() => document.body.innerText);
      assert(
        "including a number line, which half of arithmetic starts with",
        /number line/i.test(body) || shapes >= 5,
      );

      await teacher.screenshot({ path: "/tmp/claude-0/-home-user-HomeTuition/dfaf26b1-4dec-5cf0-9e29-e2224fdc575f/scratchpad/library.png" });
    },
  },

  {
    name: "the properties panel stays out of the way",
    why:
      "Excalidraw shows it the moment a tool is picked and never dismisses it. On a board " +
      "sharing the screen with a video call it covered a quarter of the drawing surface.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const panel = teacher.locator(".App-menu__left");
      const visible = async () => (await panel.count()) > 0 && (await panel.first().isVisible());

      await selectTool(teacher, PEN);
      assert("picking the pen does not open it", !(await visible()));

      await teacher.locator('button[aria-label="Colour, stroke and shape styles"]').click();
      await teacher.waitForTimeout(300);
      assert("the Styles button opens it", await visible());

      await stroke(teacher, 500, 500, 600, 560);
      assert("and drawing closes it again", !(await visible()));
    },
  },

  {
    name: "the board says a document arrived, so the app can tell when one never does",
    why:
      "On a phone the board is a WebView and a shared file crosses into it as one message. An " +
      "8 MB PDF is around 11 MB once base64-encoded, and a message that size can be dropped on " +
      "the way in rather than refused — no error, no pages, nothing, which from outside is " +
      "indistinguishable from a board still working. The app waits for this receipt and tells " +
      "the teacher when it never comes, instead of leaving them watching an empty board in " +
      "front of a class.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      await teacher.evaluate(() => {
        window.__out = [];
      });

      const receipts = () =>
        teacher.evaluate(() => window.__out.filter((m) => m.type === "document_in"));

      assert("nothing is acknowledged before anything is sent", (await receipts()).length === 0);

      await teacher.evaluate(
        (dataUrl) =>
          window.postMessage(
            JSON.stringify({
              type: "insert_document",
              document: { key: "receipt-1", dataUrl, kind: "pdf" },
            }),
            "*",
          ),
        TWO_PAGE_PDF,
      );

      // The receipt is for arrival, not for rendering. Rasterising this same PDF takes several
      // seconds in the test above; a receipt that waited for that could not tell a slow phone
      // from a lost message, which is the whole point of it.
      await teacher.waitForFunction(
        () => window.__out.some((m) => m.type === "document_in"),
        undefined,
        { timeout: 2000 },
      );
      const seen = await receipts();
      assert("the board acknowledges the document within two seconds", seen.length === 1);
      assert("naming the one it received", seen[0].key === "receipt-1");
      assert("no errors were thrown", teacher.errors.length === 0);
    },
  },

  {
    name: "rough freehand stays ink, and the class gets the same ink",
    why:
      "Automatic shape recognition changed ordinary handwriting into arrows and other shapes. " +
      "A teacher's rough stroke must remain exactly what they drew unless they deliberately " +
      "choose one of Excalidraw's shape tools.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });
      const student = await openBoard(ctx, baseUrl, { readOnly: true });

      // Last state per element wins because an element is re-sent every time it changes.
      const sent = async () =>
        [
          ...(
            await teacher.evaluate(() =>
              window.__out
                .filter((m) => m.type === "scene_out")
                .flatMap((m) => m.elements ?? [])
                .map((e) => ({ id: e.id, type: e.type, isDeleted: !!e.isDeleted })),
            )
          ).reduce((acc, e) => acc.set(e.id, e), new Map()).values(),
        ];

      await selectTool(teacher, PEN);
      await drawPath(teacher, roughCircle(450, 350, 110));
      await teacher.waitForTimeout(700);

      const after = await sent();
      const live = after.filter((e) => !e.isDeleted);
      assert("the class is sent the freehand stroke", live.some((e) => e.type === "freedraw"));
      assert(
        "and no automatic shape replaces it",
        !live.some((e) => ["ellipse", "rectangle", "diamond", "line", "arrow"].includes(e.type)),
      );
      assert(
        "the original ink is not silently withdrawn",
        !after.some((e) => e.type === "freedraw" && e.isDeleted),
      );

      await pump(teacher, student);
      await student.waitForTimeout(500);
      assert("and it reaches the student", (await ink(student)).n > 0);
      assert("no errors were thrown", teacher.errors.length === 0);
    },
  },

  {
    name: "writing stays freehand while explicit shape tools still create shapes",
    why:
      "Removing the inaccurate automatic conversion must not remove the tools a teacher uses " +
      "deliberately. Handwriting stays ink, while the rectangle and arrow tools still create " +
      "real selectable Excalidraw shapes.",
    async run(ctx, baseUrl, assert) {
      const teacher = await openBoard(ctx, baseUrl, { readOnly: false });

      const live = async () =>
        (await teacher.evaluate(() =>
          window.__out
            .filter((m) => m.type === "scene_out")
            .flatMap((m) => m.elements ?? [])
            .map((e) => ({ id: e.id, type: e.type, isDeleted: !!e.isDeleted })),
        ))
          // Last state wins: an element is re-sent every time it changes.
          .reduce((acc, e) => acc.set(e.id, e), new Map());

      await selectTool(teacher, PEN);
      await drawPath(teacher, writingPath(250, 300));
      await teacher.waitForTimeout(700);

      const written = [...(await live()).values()].filter((e) => !e.isDeleted);
      assert("writing stays as the freehand it was", written.some((e) => e.type === "freedraw"));
      assert(
        "and is not turned into a shape",
        !written.some((e) => ["ellipse", "rectangle", "line", "arrow"].includes(e.type)),
      );

      await selectTool(teacher, "2");
      await stroke(teacher, 500, 250, 650, 380);
      await selectTool(teacher, "5");
      await stroke(teacher, 700, 300, 850, 420);
      await teacher.waitForTimeout(700);

      const explicit = [...(await live()).values()].filter((e) => !e.isDeleted);
      assert("the rectangle tool creates a rectangle", explicit.some((e) => e.type === "rectangle"));
      assert("the arrow tool creates an arrow", explicit.some((e) => e.type === "arrow"));
      assert("no errors were thrown", teacher.errors.length === 0);
    },
  },
];
