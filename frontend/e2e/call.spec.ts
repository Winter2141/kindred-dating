import { expect, test } from '@playwright/test'
import { ALEX, MAYA, openChat, personFor } from './helpers'

test('a video call connects peer to peer and is logged in the chat', async ({ browser }) => {
  const alex = await personFor(browser, ALEX)
  const maya = await personFor(browser, MAYA)
  await maya.goto('/app/matches')
  await openChat(alex, 'Maya')

  await alex.getByRole('button', { name: 'Video call Maya' }).click()
  await expect(alex.getByText('Ringing…')).toBeVisible()
  await expect(maya.getByText('Incoming video call')).toBeVisible()
  await maya.getByRole('button', { name: 'Answer' }).click()

  // Connected: both show a running timer and real video from the other side.
  await expect(alex.getByText(/^0:\d{2}$/)).toBeVisible({ timeout: 20_000 })
  await expect(maya.getByText(/^0:\d{2}$/)).toBeVisible()
  await expect
    .poll(() => alex.evaluate(() => document.querySelector<HTMLVideoElement>('[role=dialog] video')?.videoWidth ?? 0))
    .toBeGreaterThan(0)

  await alex.getByRole('button', { name: 'Mute' }).click()
  await expect(alex.getByRole('button', { name: 'Unmute' })).toBeVisible()
  await maya.getByRole('button', { name: 'Hang up' }).click()

  await expect(alex.getByText(/Video call · \d+:\d{2}/).last()).toBeVisible()
  await alex.context().close()
  await maya.context().close()
})

test('calling someone who is offline says so', async ({ browser }) => {
  const alex = await personFor(browser, ALEX)
  await openChat(alex, 'Maya')
  await alex.getByRole('button', { name: 'Video call Maya' }).click()
  await expect(alex.getByText(/isn't online right now/)).toBeVisible()
  await alex.context().close()
})
