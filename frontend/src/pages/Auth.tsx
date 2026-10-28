import { useMutation } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, ArrowRight, Heart } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { AgeRange, GENDER_LABELS, GENDER_SELF, InterestPicker, PromptEditor, Segmented } from '@/components/ProfileFields'
import { Logo, Photo, Spinner } from '@/components/ui'
import { api, type RegisterInput } from '@/lib/api'
import type { Gender } from '@/lib/types'
import { ageFromBirthdate } from '@/lib/time'
import { useAuth } from '@/store/auth'
import { useToasts } from '@/store/live'
import { useDemoLogin } from './Landing'

const COLLAGE = ['1534528741775-53994a69daeb', '1506794778202-cad84cf45f1d', '1531123897727-8f129e1688ce', '1500648767791-00dcc994a43e']

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ambient grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0 grid grid-cols-2 gap-3 p-3">
          {COLLAGE.map((id, i) => (
            <div key={id} className={clsx('overflow-hidden rounded-[2rem] [container-type:inline-size]', i % 2 && 'translate-y-12')}>
              <Photo
                src={`https://images.unsplash.com/photo-${id}?w=600&h=800&fit=crop&crop=faces&q=75`}
                name="Kindred member"
                className="size-full"
              />
            </div>
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-ink/10" />
        <div className="absolute inset-x-0 bottom-0 p-12">
          <p className="font-display text-5xl leading-tight">
            Come for the <em className="text-gradient pr-1">sourdough</em> in common. Stay for the person.
          </p>
          <p className="mt-4 text-sm text-muted">Matches built on what you'd actually do together.</p>
        </div>
      </div>
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <Link to="/" className="self-start">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">{children}</div>
      </div>
    </div>
  )
}

function ErrorNote({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.p
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  )
}

export function LoginPage() {
  const signIn = useAuth((s) => s.signIn)
  const navigate = useNavigate()
  const demo = useDemoLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const login = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: (session) => {
      signIn(session)
      navigate('/app/discover')
    },
  })

  return (
    <AuthLayout>
      <h1 className="font-display text-6xl leading-none">Welcome back</h1>
      <p className="mt-3 text-muted">Your matches have been busy.</p>
      <form
        className="mt-10 space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          login.mutate()
        }}
      >
        <label className="block">
          <span className="label">Email</span>
          <input className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Password</span>
          <input className="field" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <ErrorNote message={login.error?.message ?? null} />
        <button type="submit" className="btn-primary w-full py-4 text-base" disabled={login.isPending}>
          {login.isPending ? <Spinner className="size-5" /> : 'Sign in'}
        </button>
      </form>
      <div className="my-7 flex items-center gap-4 text-xs text-faint">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
      <button type="button" className="btn-secondary w-full py-4" onClick={() => demo.mutate()} disabled={demo.isPending}>
        <Heart className="size-4 text-coral" /> Explore with the demo account
      </button>
      <p className="mt-8 text-center text-sm text-muted">
        New here?{' '}
        <Link to="/signup" className="font-semibold text-apricot hover:underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  )
}

const STEPS = ['Account', 'About you', 'Your vibe'] as const

const EMPTY: RegisterInput = {
  email: '',
  password: '',
  name: '',
  birthdate: '',
  gender: 'woman',
  interested_in: ['man'],
  age_min: 24,
  age_max: 38,
  bio: '',
  job_title: '',
  city: '',
  interests: [],
  prompts: [],
}

export function SignupPage() {
  const signIn = useAuth((s) => s.signIn)
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<RegisterInput>(EMPTY)
  const [localError, setLocalError] = useState<string | null>(null)
  const set = <K extends keyof RegisterInput>(key: K, value: RegisterInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const register = useMutation({
    mutationFn: () => api.register({ ...form, prompts: form.prompts.filter((p) => p.answer.trim()) }),
    onSuccess: (session) => {
      signIn(session)
      useToasts.getState().push({ title: `Welcome to Kindred, ${session.user.name}!`, body: 'Add a photo so people can see you.' })
      navigate('/app/profile')
    },
  })

  const validateStep = (): string | null => {
    if (step === 0) {
      if (form.password.length < 8) return 'Use at least 8 characters for your password.'
      if (!form.birthdate) return 'Add your birthday.'
      if (ageFromBirthdate(form.birthdate) < 18) return 'You need to be 18 or older to join.'
    }
    if (step === 2 && form.interests.length < 3) return 'Pick at least three interests so we can find your people.'
    return null
  }

  const next = (e: FormEvent) => {
    e.preventDefault()
    const problem = validateStep()
    setLocalError(problem)
    if (problem) return
    if (step < STEPS.length - 1) setStep(step + 1)
    else register.mutate()
  }

  return (
    <AuthLayout>
      <div className="mb-8 flex gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-raised">
              <motion.div className="h-full bg-gradient-brand" initial={false} animate={{ width: i <= step ? '100%' : '0%' }} />
            </div>
            <p className={clsx('mt-2 text-xs font-semibold', i === step ? 'text-cream' : 'text-faint')}>{label}</p>
          </div>
        ))}
      </div>

      <form onSubmit={next} className="space-y-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.2 }}
            className="space-y-5"
          >
            {step === 0 && (
              <>
                <h1 className="font-display text-5xl leading-none">Let's get you started</h1>
                <label className="block">
                  <span className="label">First name</span>
                  <input className="field" required maxLength={50} autoComplete="given-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
                </label>
                <label className="block">
                  <span className="label">Email</span>
                  <input className="field" type="email" required autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
                </label>
                <label className="block">
                  <span className="label">Password</span>
                  <input className="field" type="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" value={form.password} onChange={(e) => set('password', e.target.value)} />
                </label>
                <label className="block">
                  <span className="label">Birthday</span>
                  <input className="field" type="date" required value={form.birthdate} onChange={(e) => set('birthdate', e.target.value)} />
                </label>
              </>
            )}

            {step === 1 && (
              <>
                <h1 className="font-display text-5xl leading-none">A little about you</h1>
                <div>
                  <span className="label">I am a</span>
                  <Segmented<Gender>
                    label="Gender"
                    value={[form.gender as Gender]}
                    onChange={([g]) => set('gender', g)}
                    options={(Object.keys(GENDER_SELF) as Gender[]).map((g) => ({ value: g, label: GENDER_SELF[g] }))}
                  />
                </div>
                <div>
                  <span className="label">Show me</span>
                  <Segmented<Gender>
                    label="Interested in"
                    multiple
                    value={form.interested_in as Gender[]}
                    onChange={(v) => set('interested_in', v)}
                    options={(Object.keys(GENDER_LABELS) as Gender[]).map((g) => ({ value: g, label: GENDER_LABELS[g] }))}
                  />
                </div>
                <AgeRange min={form.age_min} max={form.age_max} onChange={(min, max) => setForm((f) => ({ ...f, age_min: min, age_max: max }))} />
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="block">
                    <span className="label">Neighbourhood</span>
                    <input className="field" placeholder="Brooklyn, NY" value={form.city} onChange={(e) => set('city', e.target.value)} />
                  </label>
                  <label className="block">
                    <span className="label">Work</span>
                    <input className="field" placeholder="What do you do?" value={form.job_title} onChange={(e) => set('job_title', e.target.value)} />
                  </label>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h1 className="font-display text-5xl leading-none">Show your vibe</h1>
                <InterestPicker value={form.interests} onChange={(v) => set('interests', v)} />
                <label className="block">
                  <span className="label">Bio</span>
                  <textarea className="field min-h-24" maxLength={500} placeholder="A few lines that sound like you." value={form.bio} onChange={(e) => set('bio', e.target.value)} />
                </label>
                <PromptEditor value={form.prompts} onChange={(v) => set('prompts', v)} />
              </>
            )}
          </motion.div>
        </AnimatePresence>

        <ErrorNote message={localError ?? register.error?.message ?? null} />

        <div className="flex gap-3 pt-2">
          {step > 0 && (
            <button type="button" className="btn-secondary px-5" onClick={() => setStep(step - 1)} aria-label="Back">
              <ArrowLeft className="size-4" />
            </button>
          )}
          <button type="submit" className="btn-primary flex-1 py-4 text-base" disabled={register.isPending}>
            {register.isPending ? (
              <Spinner className="size-5" />
            ) : step === STEPS.length - 1 ? (
              <>
                <Heart className="size-4 fill-current" /> Create my profile
              </>
            ) : (
              <>
                Continue <ArrowRight className="size-4" />
              </>
            )}
          </button>
        </div>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-apricot hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
