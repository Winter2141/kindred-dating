import { expect, type Browser, type Page } from '@playwright/test'

/** Seeded demo accounts (see backend/app/seed_data.py). */
export const ALEX = { email: 'alex@kindred.app', password: 'kindred123', name: 'Alex' }
export const MAYA = { email: 'maya@kindred.app', password: 'kindred123', name: 'Maya' }

export async function signIn(page: Page, account: { email: string; password: string }): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(account.email)
  await page.locator('#login-password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app\/discover/)
}

/** A separate browser profile signed in as `account`, for two-person tests. */
export async function personFor(browser: Browser, account: { email: string; password: string }): Promise<Page> {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] })
  const page = await context.newPage()
  await signIn(page, account)
  return page
}

/** Open the chat with `name` from the chat list. */
export async function openChat(page: Page, name: string): Promise<void> {
  await page.goto('/app/matches')
  await page.getByRole('link', { name: new RegExp(`^${name}\\b`) }).first().click()
  await expect(page).toHaveURL(/\/app\/matches\/\d+/)
}

/** The newest email the dev outbox holds for `to`. */
export async function latestEmail(page: Page, to: string): Promise<{ subject: string; body: string }> {
  const response = await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(to)}`)
  expect(response.ok()).toBeTruthy()
  const [email] = await response.json()
  return email
}

export function linkIn(body: string): string {
  const match = body.match(/https?:\/\/\S+/)
  if (!match) throw new Error(`no link in: ${body}`)
  const url = new URL(match[0])
  return `${url.pathname}${url.search}`
}
