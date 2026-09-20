/**
 * What the whiteboard has to get right, as tests.
 *
 * Each entry is one property of a working lesson, written as the failure it guards against.
 * Every one of these has been broken in production at least once.
 */
import { ERASER, PEN, RED_PNG, TWO_PAGE_PDF, drawPath, ink, near, openBoard, pump, relayMessages, roughCircle, selectTool, stroke, takeMessages, writingPath } from "./harness.mjs";

export const tests = [
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
      "On an infinite canvas, matching elements is not the same as matching views. Students " +
      "opened somewhere else entirely and had to pinch around hunting for the lesson.",
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

      // A student reading a detail must be able to break away without being snapped back.
      await student.mouse.move(450, 350);
      await student.keyboard.down("Space");
      await student.mouse.down();
      await student.mouse.move(250, 250, { steps: 8 });
      await student.mouse.up();
      await student.keyboard.up("Space");
      await student.waitForTimeout(400);
      assert(
        "a student who pans is offered the way back",
        (await student.getByText("Follow the teacher").count()) === 1,
      );

      await student.getByText("Follow the teacher").click();
      await student.waitForTimeout(500);
      const back = await ink(student);
      assert("and tapping it restores the teacher's view", near(t.minX, back.minX) && near(t.minY, back.minY));
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
      await teacher.locator('button[aria-label="Clear this page for the whole class"]').click();
      await teacher.getByRole("dialog").getByRole("button", { name: "Go back" }).click();
      assert("cancelling the confirmation changes nothing", (await ink(teacher)).n > 0);
      assert("and sends nothing", (await pump(teacher, student)).length === 0);

      await teacher.locator('button[aria-label="Clear this page for the whole class"]').click();
      await teacher.getByRole("dialog").getByRole("button", { name: "Clear page" }).click();
      await teacher.waitForTimeout(500);
      const sent = await pump(teacher, student);
      assert("confirming tells the class", sent.includes("clear_out"));
      assert("the teacher's board is empty", (await ink(teacher)).n === 0);
      assert("and so is the student's", (await ink(student)).n === 0);
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
      assert("the student followed to Page 2", (await student.getByText(/Worked example/).count()) > 0);
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
