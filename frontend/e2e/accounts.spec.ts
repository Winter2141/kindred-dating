import { expect, test } from '@playwright/test'
import { latestEmail, linkIn } from './helpers'

test('sign up, land on Discover and confirm the email', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`
  await page.goto('/signup')

  // Account
  await page.getByLabel('First name').fill('Robin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('e2e-password-1')
  await page.getByLabel('Birthday').fill('1994-06-15')
  await page.getByRole('button', { name: /continue/i }).click()

  // About you
  await page.getByRole('group', { name: 'Gender' }).getByRole('button', { name: 'Woman', exact: true }).click()
  await page.getByRole('group', { name: 'Interested in' }).getByRole('button', { name: 'Men', exact: true }).click()
  await page.getByRole('button', { name: /continue/i }).click()

  // Your vibe: at least three interests
  for (const interest of ['Coffee', 'Hiking', 'Books']) {
    await page.getByRole('button', { name: new RegExp(interest) }).first().click()
  }
  await page.getByRole('button', { name: /create my profile/i }).click()

  await expect(page).toHaveURL(/\/app\/discover/)
  await expect(page.getByText(/confirm your email/i)).toBeVisible()

  const confirm = await latestEmail(page, email)
  expect(confirm.subject).toContain('Confirm your email')
  await page.goto(linkIn(confirm.body))
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to Kindred' }).click()
  await expect(page).toHaveURL(/\/app\/discover/)
  await expect(page.getByText(/confirm your email/i)).toHaveCount(0)
})

test('reset a forgotten password', async ({ page }) => {
  // A fresh account, so the shared demo logins keep their passwords.
  const email = `e2e-reset-${Date.now()}@example.com`
  const created = await page.request.post('/api/auth/register', {
    data: {
      email,
      password: 'old-password-1',
      name: 'Kit',
      birthdate: '1992-03-03',
      gender: 'man',
      interested_in: ['woman'],
    },
  })
  expect(created.ok()).toBeTruthy()

  await page.goto('/login')
  await page.getByRole('link', { name: 'Forgot it?' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()

  const reset = await latestEmail(page, email)
  expect(reset.subject).toContain('Reset your Kindred password')
  await page.goto(linkIn(reset.body))
  await page.getByLabel('New password').fill('new-password-2')
  await page.getByLabel('Type it again').fill('new-password-2')
  await page.getByRole('button', { name: 'Save and sign in' }).click()
  await expect(page).toHaveURL(/\/app\/discover/)

  // The link is used up.
  await page.goto(linkIn(reset.body))
  await page.getByLabel('New password').fill('third-password-3')
  await page.getByLabel('Type it again').fill('third-password-3')
  await page.getByRole('button', { name: 'Save and sign in' }).click()
  await expect(page.getByText(/invalid or used up/i)).toBeVisible()
})
