/**
 * Turn one silently-ignored response into a readable stop.
 *
 * ## The cascade this exists to prevent
 *
 * `lib/payments.ts` refuses a `teacher-plan` purchase outright unless `NODE_ENV` is `test`: no
 * provider is integrated, so a running development or production server must not activate a plan
 * it never took money for. That is correct and deliberate.
 *
 * The suites that drive an externally-started API — `one-chat`, `teacher-leave`, `monthly-tests`
 * and friends — call `POST /monthly/plan` and **ignore the response**. Start that API without
 * `NODE_ENV=test` and the purchase fails quietly, the next call is told "you need the monthly
 * plan first", and the run finally dies several steps later on a `recurring_days` query reading
 * `recurring_id = undefined`.
 *
 * **That cascade cost an hour and was then reported as a stale fixture broken on main.** It was
 * neither: the fixtures are fine and both suites pass. The API had been started the wrong way.
 * A misconfiguration that surfaces four steps downstream as a SQL syntax error is one nobody
 * diagnoses correctly the first time, so it should say so at the point it happens.
 *
 * Deliberately not solved by adding a mode field to `/healthz`: that would change a production
 * surface, and leak configuration, to serve a test. The information is already in the response
 * the suites were throwing away.
 */

/**
 * Check what `POST /monthly/plan` actually said, and stop with an explanation if it refused.
 *
 * @param {{status: number, body: any}} response  exactly what the suite's own `api()` returned
 * @returns the response, so it can be used inline
 */
export function assertPlanPurchased(response) {
  const bought = response?.status === 200 || response?.status === 201;
  if (bought) return response;

  const message = String(response?.body?.error ?? "");
  console.error("\n--------------------------------------------------------------------");
  console.error("The teacher could not buy a monthly plan, so nothing after this can work.");
  console.error(`The API answered ${response?.status}: ${message || "(no message)"}`);

  if (/not connected yet/i.test(message)) {
    console.error("");
    console.error("This is the expected refusal from lib/payments.ts when no payment provider");
    console.error("is configured — it is correct behaviour, not a bug, and not a stale fixture.");
    console.error("These suites need the API started in test mode:");
    console.error("");
    console.error("  PORT=8080 NODE_ENV=test DATABASE_URL=<test database> \\");
    console.error("    SESSION_SECRET=anything node artifacts/api-server/dist/index.mjs");
    console.error("");
    console.error("which is how .github/workflows/deploy-web.yml starts it.");
  }
  console.error("--------------------------------------------------------------------\n");
  process.exit(1);
}
