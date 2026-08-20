/**
 * What the whiteboard has to get right, as tests.
 *
 * Each entry is one property of a working lesson, written as the failure it guards against.
 * Every one of these has been broken in production at least once.
 */
import { ERASER, PEN, RED_PNG, ink, near, openBoard, pump, selectTool, stroke } from "./harness.mjs";

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
            JSON.stringify({ type: "insert_image", image: { key: "test-1", dataUrl } }),
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
      teacher.once("dialog", (d) => d.dismiss());
      await teacher.locator('button[aria-label="Clear the board for the whole class"]').click();
      await teacher.waitForTimeout(400);
      assert("cancelling the confirmation changes nothing", (await ink(teacher)).n > 0);
      assert("and sends nothing", (await pump(teacher, student)).length === 0);

      teacher.once("dialog", (d) => d.accept());
      await teacher.locator('button[aria-label="Clear the board for the whole class"]').click();
      await teacher.waitForTimeout(500);
      const sent = await pump(teacher, student);
      assert("confirming tells the class", sent.includes("clear_out"));
      assert("the teacher's board is empty", (await ink(teacher)).n === 0);
      assert("and so is the student's", (await ink(student)).n === 0);
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
];
