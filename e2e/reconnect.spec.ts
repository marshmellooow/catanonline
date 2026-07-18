import { expect, test, type BrowserContext, type Page } from '@playwright/test';

function watchBrowser(page: Page, label: string, problems: string[]) {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${label} console.${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`${label} pageerror: ${error.message}`));
}

async function openPage(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.locator('.boot')).toBeHidden({ timeout: 7_000 });
}

async function openContext(browserContext: BrowserContext, label: string, problems: string[], path = '/') {
  const page = await browserContext.newPage();
  watchBrowser(page, label, problems);
  await openPage(page, path);
  return page;
}

test('stellt einen eigenen Zug nach Disconnect ohne Sitz- oder Aktionsverlust wieder her', async ({ browser, baseURL }) => {
  const problems: string[] = [];
  expect(baseURL).toBeTruthy();
  const hostContext = await browser.newContext({ baseURL: baseURL! });
  const guestContext = await browser.newContext({ baseURL: baseURL! });

  try {
    const host = await openContext(hostContext, 'Spieler Nord', problems);
    await expect(host.getByRole('button', { name: 'Raum erstellen', exact: true })).toBeEnabled();
    await host.getByPlaceholder('Dein Spielername').fill('Spieler Nord');
    await host.getByRole('button', { name: 'Raum erstellen', exact: true }).click();
    const codeBadge = host.locator('.code-badge');
    await expect(codeBadge).toHaveText(/^[A-Z2-9]{6}$/);
    const roomCode = (await codeBadge.textContent())!;

    const guest = await openContext(guestContext, 'Spieler Süd', problems, `/?room=${roomCode}`);
    await guest.getByPlaceholder('Dein Spielername').fill('Spieler Süd');
    await guest.getByRole('button', { name: 'Raum beitreten', exact: true }).click();

    await expect(host.locator('.seat')).toHaveCount(2);
    await expect(guest.locator('.seat')).toHaveCount(2);
    await guest.getByRole('button', { name: 'Bereit', exact: true }).click();
    await host.getByRole('button', { name: 'Bereit', exact: true }).click();
    const start = host.getByRole('button', { name: 'Spiel starten', exact: true });
    await expect(start).toBeEnabled();
    await start.click();

    await expect(host.locator('.intro')).toBeHidden({ timeout: 7_000 });
    await expect(guest.locator('.intro')).toBeHidden({ timeout: 7_000 });
    await expect(host.locator('.game')).toBeVisible();
    await expect(guest.locator('.game')).toBeVisible();
    await expect.poll(async () =>
      (await host.locator('.phase-pill.mine').count()) + (await guest.locator('.phase-pill.mine').count()),
    ).toBe(1);

    const hostIsActive = (await host.locator('.phase-pill.mine').count()) === 1;
    const activePage = hostIsActive ? host : guest;
    const observerPage = hostIsActive ? guest : host;
    const activeContext = hostIsActive ? hostContext : guestContext;
    const activeName = hostIsActive ? 'Spieler Nord' : 'Spieler Süd';
    const activePlayerId = await activePage.locator('.rail-player.active').getAttribute('data-player-row');
    const sessionId = await activePage.evaluate(() => localStorage.getItem('catan.sessionId'));
    expect(activePlayerId).toBeTruthy();
    expect(sessionId).toBeTruthy();

    const observedRow = observerPage.locator('.rail-player', { hasText: activeName });
    await activePage.close();
    await expect(observedRow.locator('.status-dot.gone')).toBeVisible();
    await expect(observerPage.locator('.pause-badge')).toContainText(`Warte auf ${activeName}`);

    const reconnected = await openContext(activeContext, `${activeName} nach Reconnect`, problems);
    await expect(reconnected.locator('.game')).toBeVisible();
    await expect(reconnected.locator('.phase-pill.mine')).toHaveText('Setze deine Startsiedlung');
    await expect(reconnected.locator('.rail-player.active')).toHaveAttribute('data-player-row', activePlayerId!);
    await expect.poll(() => reconnected.evaluate(() => localStorage.getItem('catan.sessionId'))).toBe(sessionId);
    await expect(observedRow.locator('.status-dot.gone')).toHaveCount(0);
    await expect(observerPage.locator('.pause-badge')).toBeHidden();
    await expect(reconnected.locator('.conn-overlay')).toBeHidden();

    const settlementChoices = reconnected.locator('[data-highlight-corner]');
    await expect(settlementChoices.first()).toBeVisible();
    await settlementChoices.first().click();
    await expect(reconnected.locator('.phase-pill.mine')).toHaveText('Setze deine Startstraße');
    const roadChoices = reconnected.locator('[data-highlight-edge]');
    await expect(roadChoices.first()).toBeVisible();
    await roadChoices.first().click();
    await expect(observerPage.locator('[data-corner]')).toHaveCount(1);
    await expect(observerPage.locator('[data-road]')).toHaveCount(1);

    expect(problems).toEqual([]);
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()]);
  }
});
