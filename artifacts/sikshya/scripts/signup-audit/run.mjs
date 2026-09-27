import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleForBrowser } from '../bundle-for-browser.mjs';
import { getChromium } from '../board-tests/harness.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), 'fadko-signup-audit-'));
const bundle = path.join(work, 'bundle.js');
const mocks = path.join(here, 'mocks.js');
const built = await bundleForBrowser({ entry: path.join(here, 'entry.tsx'), outfile: bundle, alias: {
  '@/context/AuthContext': mocks, '@/utils/api': mocks, 'expo-router': mocks, 'react-native-safe-area-context': mocks,
  'expo-font': path.resolve(here, '../batch-planner/font.js'),
} });
assert.ok(built.ok, built.error);
const server = createServer((req,res) => {
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8');
  res.end(req.url === '/bundle.js' ? readFileSync(bundle) : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await (await getChromium()).launch({ headless: true });
let passed = 0;
const check = (ok,label) => { assert.ok(ok,label); passed++; console.log('PASS '+label); };
try {
  for (const width of [390,1440]) {
    const page = await browser.newPage({ viewport: {width,height:844} });
    const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base+'?role=student');
    check(!/citizenship|parent.s id document/i.test(await page.locator('body').innerText()),`${width}: student signup asks for no citizenship document`);
    await page.getByText('Create Account',{exact:true}).click();
    check(await page.getByText('Enter your full name.',{exact:true}).isVisible(),`${width}: specific name error`);
    check(await page.getByLabel('Full Name',{exact:true}).getAttribute('aria-invalid') === 'true',`${width}: invalid field is exposed accessibly`);
    check(!(await page.locator('body').innerText()).includes('thousands'),`${width}: no invented social proof`);
    check(!await page.evaluate(()=>!!window.registered),`${width}: empty signup does not submit`);
    check(await page.getByTestId('birth-date-bs').getAttribute('aria-checked') === 'true', `${width}: signup DOB defaults to Nepali BS`);
    await page.getByTestId('birth-date').fill('२०००-०१-०१');
    check((await page.getByTestId('birth-date-equivalent').innerText()).includes('1943-04-14'), `${width}: Nepali digits convert to the correct civil day`);
    await page.getByTestId('birth-date-ad').click();
    check(await page.getByTestId('birth-date').inputValue() === '1943-04-14', `${width}: changing to AD preserves DOB`);
    await page.getByPlaceholder('YYYY-MM-DD').fill('2000-01-01');
    await page.getByLabel('Full Name',{exact:true}).fill('UX Test');
    await page.getByLabel('Email Address',{exact:true}).fill('test@example.com');
    await page.getByLabel('Password',{exact:true}).fill('long-password');
    await page.getByLabel('Confirm Password',{exact:true}).fill('long-password');
    await page.getByText('Create Account',{exact:true}).click();
    check(await page.getByText('Choose your current learning level.',{exact:true}).isVisible(),`${width}: no default grade`);
    await page.getByText('Adult / professional',{exact:true}).click();
    await page.getByText('Create Account',{exact:true}).click();
    await page.waitForFunction(()=>window.registered);
    check((await page.evaluate(()=>window.registered.grade)) === 'Adult / professional',`${width}: explicit adult level submits`);
    await page.goto(base+'?role=teacher');
    check((await page.locator('body').innerText()).includes('identity documents and credentials'),`${width}: teacher signup explains later verification`);
    await page.getByPlaceholder('Search or type any subject').fill('Woodworking');
    await page.getByLabel('Full Name',{exact:true}).fill('Test Teacher');
    await page.getByLabel('Email Address',{exact:true}).fill('teacher@example.com');
    await page.getByLabel('Password',{exact:true}).fill('long-password');
    await page.getByLabel('Confirm Password',{exact:true}).fill('long-password');
    await page.getByLabel('About your teaching *',{exact:true}).fill('Synthetic teaching bio');
    await page.getByText('Create Account',{exact:true}).click();
    await page.waitForFunction(()=>window.registered);
    check((await page.evaluate(()=>window.registered.subject)) === 'Woodworking',`${width}: custom subject submits`);
    await page.screenshot({path:path.join(work,`teacher-${width}.png`),fullPage:true});
    await page.goto(base+'?verify=1');
    check(await page.getByText('Continue to my account',{exact:true}).count() === 0,`${width}: dead-end continuation removed`);
    await page.getByText('I’ve verified my email',{exact:true}).click();
    check(await page.getByText(/Verification is not confirmed here yet/).isVisible(),`${width}: pending verification has explanation`);
    check(!await page.evaluate(()=>!!window.lastNavigation),`${width}: unverified check does not navigate`);
    await page.getByText('Send another link',{exact:true}).click();
    check(await page.getByTestId('verification-resend').getAttribute('aria-disabled') === 'true',`${width}: resend cooldown`);
    await page.getByTestId('verification-signout').click();
    check(await page.evaluate(()=>window.signedOut && window.lastNavigation === '/welcome'),`${width}: recovery signout works`);
    await page.goto(base+'?verify=1');
    await page.evaluate(()=>window.verificationReady=true);
    await page.getByText('I’ve verified my email',{exact:true}).click();
    await page.waitForFunction(()=>window.lastNavigation === '/');
    check(true,`${width}: verified account continues`);
    check(errors.length === 0,`${width}: no runtime errors (${errors.join(',')})`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
console.log(`${passed} checks passed. Screenshots: ${work}`);
