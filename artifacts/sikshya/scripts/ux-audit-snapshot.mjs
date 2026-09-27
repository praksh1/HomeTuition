import { getChromium } from './board-tests/harness.mjs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
const output = path.resolve('.ux-audit');
mkdirSync(output, { recursive: true });
const browser = await (await getChromium()).launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: Number(process.env.AUDIT_WIDTH || 390), height: 844 }, ...(process.env.AUDIT_STATE ? {storageState:path.join(os.tmpdir(),`fadko-ux-${process.env.AUDIT_STATE}-state.json`)} : {}) });
  for (const route of process.argv.slice(2)) {
    await page.goto(`https://hometuition-preview.praksh-dhakal.workers.dev${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    if (process.env.AUDIT_CLICK) {
      await page.getByText(process.env.AUDIT_CLICK, {exact:true}).click();
      await page.waitForTimeout(2500);
    }
    if (process.env.AUDIT_AFTER) {
      await page.getByText(process.env.AUDIT_AFTER, {exact:true}).first().click();
      await page.waitForTimeout(1500);
    }
    if (process.env.AUDIT_SCROLL) await page.getByText(process.env.AUDIT_SCROLL, {exact:true}).first().scrollIntoViewIfNeeded();
    if (process.env.AUDIT_ROLE) {
      await page.getByText(process.env.AUDIT_ROLE === 'teacher' ? 'I’m a teacher' : 'I’m a student', {exact:true}).click();
      await page.waitForTimeout(1200);
      await page.getByText('Create New Account', {exact:true}).click();
      await page.waitForTimeout(1200);
      if (process.env.AUDIT_REGISTER === '1') {
        const role = process.env.AUDIT_ROLE;
        const email = `fadko.ux.${role}.${Date.now()}@example.com`;
        const password = `Ux!${randomBytes(18).toString('hex')}aA7`;
        await page.getByPlaceholder('Your full name', {exact:true}).fill(`UX Audit Test ${role}`);
        await page.getByPlaceholder('your@email.com', {exact:true}).last().fill(email);
        await page.getByPlaceholder('Create a strong password', {exact:true}).fill(password);
        await page.getByPlaceholder('Repeat your password', {exact:true}).fill(password);
        if (role === 'teacher') {
          await page.getByText('Mathematics', {exact:true}).click();
          await page.locator('textarea').last().fill('Synthetic Preview UX test account. Not a real teacher. No real classes or payments.');
        } else {
          await page.getByPlaceholder('YYYY-MM-DD', {exact:true}).fill('2000-01-01');
          await page.getByText('College', {exact:true}).click();
        }
        await page.getByText('Create Account', {exact:true}).click();
        await page.waitForTimeout(6000);
        await page.context().storageState({path:path.join(os.tmpdir(),`fadko-ux-${role}-state.json`)});
        console.log(JSON.stringify({testAccount:email,role}));
      }
    }
    console.log(JSON.stringify({route, url:page.url(),text:await page.locator('body').innerText(), inputs:await page.locator('input').evaluateAll(nodes=>nodes.map(n=>({placeholder:n.placeholder,type:n.type}))) }));
    await page.screenshot({path:path.join(output,(process.env.AUDIT_LABEL || route.replace(/[^a-z0-9]/gi,'_'))+'.png'),fullPage:!process.env.AUDIT_SCROLL});
    if (process.env.AUDIT_STATE) await page.context().storageState({path:path.join(os.tmpdir(),`fadko-ux-${process.env.AUDIT_STATE}-state.json`)});
  }
} finally { await browser.close(); }
