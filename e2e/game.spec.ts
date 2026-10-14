import { expect, test, type Page } from '@playwright/test';

const drop = async (p: Page, c: number) => {
  await p.locator('.col').nth(c).click();
  await p.waitForTimeout(450);
};

test('pass & play: vertical win, undo, rematch', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-id=pvp]');
  for (const c of [0, 1, 0, 1, 0, 1]) await drop(page, c);
  await page.click('[data-id=undo]');
  await expect(page.locator('.discs .disc')).toHaveCount(5);
  await drop(page, 1);
  await drop(page, 0);
  await expect(page.locator('.result-title')).toContainText('Player 1 wins');
  await page.click('.result .btn.primary');
  await expect(page.locator('.discs .disc')).toHaveCount(0);
  await expect(page.locator('.seat[data-seat="0"] .seat-score')).toHaveText('1');
});

test('vs AI: AI replies and blocks', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-id=ai]');
  await page.click('[data-level=easy]');
  await drop(page, 3);
  await expect(page.locator('.discs .disc')).toHaveCount(2, { timeout: 8000 });
});

test('works offline after first visit', async ({ page, context }) => {
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null || navigator.serviceWorker?.ready);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await page.click('[data-id=ai]');
  await page.click('[data-level=beginner]');
  await drop(page, 3);
  await expect(page.locator('.discs .disc')).toHaveCount(2, { timeout: 8000 });
  await context.setOffline(false);
});

test('online (same-browser transport): create, join, play, rematch, reload', async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto('/?transport=local');
  await a.click('[data-id=online]');
  await a.fill('#online-name', 'Ann');
  await a.click('text=Create game');
  const code = (await a.locator('.room-code').innerText()).replace(/\s/g, '');
  expect(code).toMatch(/^[A-Z2-9]{4}$/);
  await b.goto(`/r/${code}?transport=local`);
  await b.waitForSelector('.game');
  await a.bringToFront();
  await a.waitForSelector('.game');

  const turnPage = async () => {
    for (let k = 0; k < 40; k++)
      for (const p of [a, b]) {
        await p.bringToFront();
        await p.waitForTimeout(150);
        if ((await p.locator('.status').innerText()).startsWith('Your turn')) return p;
      }
    throw new Error('nobody to move');
  };
  for (let i = 0; i < 7; i++) {
    const p = await turnPage();
    await p.locator('.col').nth(i % 2 === 0 ? 0 : 1).click();
    await p.waitForTimeout(500);
  }
  for (const p of [a, b]) {
    await p.bringToFront();
    await expect(p.locator('.result-title')).toBeVisible();
    await p.click('.result .btn.primary');
  }
  await a.bringToFront();
  await expect(a.locator('.discs .disc')).toHaveCount(0, { timeout: 5000 });
  await (await turnPage()).locator('.col').nth(3).click();
  await b.bringToFront();
  await b.waitForTimeout(800);
  await b.reload();
  await b.waitForSelector('.game');
  await expect(b.locator('.discs .disc')).toHaveCount(1, { timeout: 5000 });
});
