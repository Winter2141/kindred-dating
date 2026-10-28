import { useMutation } from '@tanstack/react-query'
import { ArrowRight, CheckCheck, Heart, MessageCircle, Sparkles, Wand2 } from 'lucide-react'
import { motion } from 'motion/react'
import { Link, useNavigate } from 'react-router'
import { CompatibilityRing, Logo, Photo, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { useAuth } from '@/store/auth'

export const DEMO_ACCOUNT = { email: 'alex@kindred.app', password: 'kindred123' }

const photo = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=700&h=940&fit=crop&crop=faces&q=80`

const HERO_CARDS = [
  { name: 'Sofia', age: 26, job: 'Architect', id: '1544005313-94ddf0286df2', tilt: -9, x: -150, y: 40, score: 88 },
  { name: 'Daniel', age: 30, job: 'Chef', id: '1507003211169-0a1dd7228f2d', tilt: 8, x: 150, y: 50, score: 81 },
  { name: 'Maya', age: 28, job: 'Pastry chef', id: '1494790108377-be9c29b29330', tilt: -1, x: 0, y: 0, score: 94 },
]

export function useDemoLogin() {
  const signIn = useAuth((s) => s.signIn)
  const navigate = useNavigate()
  return useMutation({
    mutationFn: () => api.login(DEMO_ACCOUNT.email, DEMO_ACCOUNT.password),
    onSuccess: (session) => {
      signIn(session)
      navigate('/app/discover')
    },
  })
}

export function LandingPage() {
  const demo = useDemoLogin()
  return (
    <div className="ambient relative min-h-dvh overflow-x-hidden">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <div className="flex items-center gap-2">
          <Link to="/login" className="btn-ghost">
            Sign in
          </Link>
          <Link to="/signup" className="btn-primary hidden sm:inline-flex">
            Join free
          </Link>
        </div>
      </nav>

      <section className="mx-auto grid max-w-7xl items-center gap-14 px-5 pt-8 pb-20 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
        <div>
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="chip mb-7 border-coral/30 text-apricot"
          >
            <Sparkles className="size-3.5" /> Real-time chat · transparent matching
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="font-display text-[clamp(3.4rem,8vw,6.6rem)] leading-[0.92] tracking-tight"
          >
            Find someone who <em className="text-gradient pr-3">gets</em> your weekends.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-7 max-w-xl text-lg leading-relaxed text-muted"
          >
            Kindred matches you on the things you'd actually do together, shows you exactly why
            you fit, and gets the conversation going the second you both say yes.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-10 flex flex-wrap items-center gap-3"
          >
            <button
              type="button"
              className="btn-primary px-7 py-4 text-base"
              onClick={() => demo.mutate()}
              disabled={demo.isPending}
            >
              {demo.isPending ? <Spinner className="size-5" /> : <Heart className="size-5 fill-current" />}
              Try the live demo
            </button>
            <Link to="/signup" className="btn-secondary px-7 py-4 text-base">
              Create an account <ArrowRight className="size-4" />
            </Link>
          </motion.div>
          {demo.isError && (
            <p className="mt-4 text-sm text-danger">
              Couldn't reach the API. Is the backend running on port 8000?
            </p>
          )}
          <p className="mt-6 text-sm text-faint">
            Demo signs you in as Alex. Message a match and watch them reply live.
          </p>
        </div>

        <div className="relative mx-auto h-[540px] w-full max-w-[560px]" aria-hidden>
          {HERO_CARDS.map((card, i) => (
            <motion.div
              key={card.name}
              initial={{ opacity: 0, y: 60, rotate: 0 }}
              animate={{ opacity: 1, y: card.y, x: card.x, rotate: card.tilt }}
              transition={{ type: 'spring', stiffness: 90, damping: 16, delay: 0.2 + i * 0.12 }}
              className="absolute top-6 left-1/2 -ml-[130px] h-[370px] w-[260px]"
              style={{ zIndex: i }}
            >
              <div
                className="relative size-full overflow-hidden rounded-[2rem] border border-line-strong shadow-card [container-type:inline-size] animate-float"
                style={{ animationDelay: `${i * -2.3}s` }}
              >
                <Photo src={photo(card.id)} name={card.name} eager className="size-full" />
                <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/10 to-transparent to-60%" />
                <span className="absolute top-3 right-3">
                  <CompatibilityRing value={card.score} size={46} />
                </span>
                <div className="absolute inset-x-0 bottom-0 p-5">
                  <p className="font-display text-4xl leading-none">
                    {card.name} <span className="text-cream/70">{card.age}</span>
                  </p>
                  <p className="mt-1.5 text-sm text-cream/80">{card.job}</p>
                </div>
              </div>
            </motion.div>
          ))}

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.9 }}
            className="glass absolute right-0 bottom-20 z-10 w-64 rounded-3xl rounded-br-md border border-line-strong p-4 shadow-card sm:-right-4"
          >
            <p className="text-xs font-semibold text-apricot">Maya</p>
            <p className="mt-1 text-sm leading-snug">Testing a cardamom bun recipe. I might need an honest taste tester…</p>
            <p className="mt-2 flex items-center justify-end gap-1 text-[11px] text-faint">
              9:41 <CheckCheck className="size-3.5 text-sky" />
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.1 }}
            className="absolute bottom-4 left-0 z-10 flex items-center gap-3 rounded-full bg-gradient-brand py-2.5 pr-5 pl-2.5 text-ink shadow-glow sm:-left-2"
          >
            <span className="grid size-9 place-items-center rounded-full bg-ink/15">
              <Heart className="size-4 fill-current" />
            </span>
            <span className="text-sm font-bold">It's a match!</span>
          </motion.div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 pb-24 sm:px-8 md:grid-cols-3">
        {[
          {
            icon: Sparkles,
            title: 'Matches that make sense',
            body: 'Every card shows a compatibility score built from shared interests, age and activity, and highlights what you have in common.',
          },
          {
            icon: MessageCircle,
            title: 'Chat that feels alive',
            body: 'WebSocket messaging with typing indicators, read receipts and presence, so you know when they are there.',
          },
          {
            icon: Wand2,
            title: 'Icebreakers, not small talk',
            body: 'Openers written from your overlap and their prompts. Tap one and the conversation has already started.',
          },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="card p-7">
            <span className="grid size-12 place-items-center rounded-2xl bg-coral/12 text-coral">
              <Icon className="size-6" />
            </span>
            <h2 className="mt-5 font-display text-3xl leading-tight">{title}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">{body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-line py-8 text-center text-sm text-faint">
        Kindred is a portfolio project built with FastAPI and React. Photos from Unsplash.
      </footer>
    </div>
  )
}
