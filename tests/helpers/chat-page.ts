import type { Page } from '@playwright/test';

/** The message box of Pip's chat window; its placeholder changes with the scene, so tests find it by id. */
export const composer = (page: Page) => page.locator('#composer');

/** Settings, Feedback, Tracker, Remember and Browser task sit under the window's More button. */
export async function openMore(page: Page, item: 'Settings' | 'Feedback' | 'Tracker' | 'Remember' | 'Browser task') {
 await page.getByRole('button', { name: 'More', exact: true }).click();
 await page.getByRole('menuitem', { name: new RegExp('^' + item) }).click();
}
