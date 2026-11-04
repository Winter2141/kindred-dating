import { expect, test } from '@playwright/test'
import { ALEX, MAYA, openChat, personFor, signIn } from './helpers'

test('swipe into a match and chat with a persona who replies', async ({ page }) => {
  await signIn(page, ALEX)
  // Personas like you back most of the time; keep liking until one does.
  const celebration = page.getByText("It's a match")
  for (let i = 0; i < 25 && !(await celebration.isVisible()); i++) {
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(700)
  }
  await expect(celebration).toBeVisible()
  await page.getByRole('button', { name: 'Send a message' }).click()
  await expect(page).toHaveURL(/\/app\/matches\/\d+/)

  await page.getByRole('textbox', { name: /^Message / }).fill('Hi! What are you up to this weekend?')
  await page.keyboard.press('Enter')
  await expect(page.locator('[id^="message-"]', { hasText: 'Hi! What are you up to this weekend?' })).toBeVisible()
  // The persona reads it, types, and answers.
  await expect(page.getByLabel('Read').first()).toBeVisible()
  await expect(page.locator('.rounded-bl-md').last()).toBeVisible()
})

test('two people chat live: messages, typing, replies and edits', async ({ browser }) => {
  const alex = await personFor(browser, ALEX)
  const maya = await personFor(browser, MAYA)
  await openChat(alex, 'Maya')
  await openChat(maya, 'Alex')

  const text = `Live from e2e ${Date.now()}`
  await alex.getByRole('textbox', { name: 'Message Maya' }).pressSequentially('Live from')
  await expect(maya.getByText('typing…')).toBeVisible()
  await alex.getByRole('textbox', { name: 'Message Maya' }).fill(text)
  await alex.keyboard.press('Enter')
  const bubble = (page: typeof maya, body: string) => page.locator('[id^="message-"]', { hasText: body })
  await expect(bubble(maya, text)).toBeVisible()

  // Maya replies to it, quoting the message.
  await bubble(maya, text).hover()
  await maya.getByRole('button', { name: 'Reply' }).last().click()
  await maya.getByRole('textbox', { name: 'Message Alex' }).fill('Got it!')
  await maya.keyboard.press('Enter')
  await expect(alex.getByRole('button', { name: /Replying to You:/ }).last()).toBeVisible()

  // Alex edits the original; Maya sees the new text.
  await alex.getByRole('textbox', { name: 'Message Maya' }).click()
  await alex.keyboard.press('ArrowUp')
  await expect(alex.getByText('Editing message')).toBeVisible()
  await alex.getByRole('textbox', { name: 'Message Maya' }).fill(`${text} (edited)`)
  await alex.keyboard.press('Enter')
  await expect(bubble(maya, `${text} (edited)`).first()).toBeVisible()

  await alex.context().close()
  await maya.context().close()
})

test('an unkind message gets a second thought before it goes', async ({ page }) => {
  await signIn(page, ALEX)
  await openChat(page, 'Maya')
  const box = page.getByRole('textbox', { name: 'Message Maya' })
  const bubble = (body: string) => page.locator('[id^="message-"]', { hasText: body })

  const harsh = `ur such a l0ser ${Date.now()}`
  await box.fill(harsh)
  await page.keyboard.press('Enter')
  const nudge = page.getByRole('dialog', { name: 'Are you sure?' })
  await expect(nudge).toContainText('"loser" might hurt')
  await expect(box).toHaveValue(harsh) // nothing sent yet

  // Rewording it sends straight away.
  await nudge.getByRole('button', { name: /edit message/i }).click()
  await expect(nudge).toBeHidden()
  const kinder = `Ha, I lost that round ${Date.now()}`
  await box.fill(kinder)
  await page.keyboard.press('Enter')
  await expect(bubble(kinder)).toBeVisible()
  await expect(bubble(harsh)).toHaveCount(0)

  // It's a nudge, not a filter: "Send anyway" still sends.
  await box.fill(harsh)
  await page.keyboard.press('Enter')
  await nudge.getByRole('button', { name: /send anyway/i }).click()
  await expect(bubble(harsh)).toBeVisible()
})
