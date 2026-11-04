import { expect, test } from '@playwright/test'
import { ALEX, signIn } from './helpers'

test('travel mode moves the deck to another city and back', async ({ page }) => {
  await signIn(page, ALEX)
  await page.getByRole('button', { name: 'Travel mode' }).click()
  await page.getByLabel('Where to').fill('Lisbon')
  await page.getByRole('button', { name: 'Start exploring' }).click()

  await expect(page.getByText('Exploring Lisbon', { exact: false }).first()).toBeVisible()
  const card = page.getByRole('heading', { level: 2 }).first()
  await expect(card).toHaveText(/^(Inês|Beatriz|Leonor)/)
  await expect(page.getByRole('button', { name: 'Travel mode: Lisbon, Portugal' })).toBeVisible()

  await page.getByRole('button', { name: 'Travel mode: Lisbon, Portugal' }).click()
  await page.getByRole('button', { name: 'End trip' }).click()
  await expect(page.getByText(/Picked for you around Brooklyn/)).toBeVisible()
})

test('save someone for later, find them in Saved and put them back', async ({ page }) => {
  await signIn(page, ALEX)
  // The top card is drawn last, over the two behind it.
  const name = (await page.getByRole('heading', { level: 2 }).last().textContent())?.match(/^\S+/)?.[0] ?? ''
  expect(name).not.toBe('')

  await page.getByRole('button', { name: 'Save for later' }).click()
  await expect(page.getByText(`Saved ${name}`)).toBeVisible()

  await page.goto('/app/likes?tab=saved')
  await expect(page.getByRole('heading', { name: 'Saved for later' })).toBeVisible()
  await page.getByRole('button', { name: `Put ${name} back in Discover` }).click()
  await expect(page.getByText('Nobody saved yet')).toBeVisible()
})

test('see who viewed you, and dismiss an announcement', async ({ page }) => {
  await signIn(page, ALEX)
  const banner = page.getByRole('status').filter({ hasText: 'New: travel mode.' })
  await expect(banner).toBeVisible()

  await page.goto('/app/likes')
  await page.getByRole('tab', { name: 'Viewed you' }).click()
  await expect(page.getByRole('button', { name: /^Harriet, looked once/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Nora, looked 3 times/ })).toContainText('Likes you')

  await banner.getByRole('button', { name: 'Dismiss announcement' }).click()
  await expect(banner).toBeHidden()
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Viewed you' })).toBeVisible()
  await expect(page.getByText('New: travel mode.')).toBeHidden()
})
