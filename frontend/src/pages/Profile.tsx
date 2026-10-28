import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Camera, Check, ImagePlus, Star, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AgeRange, GENDER_LABELS, InterestPicker, PromptEditor, Segmented } from '@/components/ProfileFields'
import { Photo, Spinner, useMeta } from '@/components/ui'
import { api, type ProfileUpdate } from '@/lib/api'
import { keys } from '@/lib/cache'
import type { Gender, Me } from '@/lib/types'
import { useAuth } from '@/store/auth'
import { useToasts } from '@/store/live'

function formFrom(user: Me) {
  return {
    name: user.name,
    job_title: user.job_title,
    city: user.city,
    bio: user.bio,
    interests: user.interests,
    prompts: user.prompts,
    interested_in: user.interested_in,
    age_min: user.age_min,
    age_max: user.age_max,
  }
}

export function ProfilePage() {
  const user = useAuth((s) => s.user)
  if (!user) return null
  return <ProfileEditor user={user} />
}

function ProfileEditor({ user }: { user: Me }) {
  const queryClient = useQueryClient()
  const setUser = useAuth((s) => s.setUser)
  const [form, setForm] = useState(() => formFrom(user))
  const dirty = JSON.stringify(form) !== JSON.stringify(formFrom(user))

  const onSaved = (me: Me) => {
    setUser(me)
    queryClient.setQueryData(keys.me, me)
    void queryClient.invalidateQueries({ queryKey: keys.discover })
  }

  const save = useMutation({
    mutationFn: (data: ProfileUpdate) => api.updateMe(data),
    onSuccess: (me) => {
      onSaved(me)
      setForm(formFrom(me))
      useToasts.getState().push({ title: 'Profile saved', body: 'Looking good ✨', image: me.photos[0] })
    },
    onError: (error) => useToasts.getState().push({ title: "Couldn't save", body: (error as Error).message }),
  })

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-5 pb-28 sm:px-8 lg:pt-10">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-5xl leading-none">Your profile</h1>
          <p className="mt-2 text-sm text-muted">This is what people see when you show up in their deck.</p>
        </div>
      </header>

      <div className="grid gap-8 xl:grid-cols-[360px_minmax(0,1fr)]">
        <PhotoManager user={user} onChange={onSaved} />

        <form
          className="space-y-8"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate({
              ...form,
              prompts: form.prompts.filter((p) => p.answer.trim()),
            })
          }}
        >
          <section className="card space-y-5 p-6 sm:p-8">
            <h2 className="font-display text-3xl">About you</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="label">First name</span>
                <input className="field" value={form.name} maxLength={50} onChange={(e) => set('name', e.target.value)} required />
              </label>
              <label className="block">
                <span className="label">Work</span>
                <input className="field" value={form.job_title} maxLength={80} placeholder="What do you do?" onChange={(e) => set('job_title', e.target.value)} />
              </label>
              <label className="block sm:col-span-2">
                <span className="label">Neighbourhood</span>
                <input className="field" value={form.city} maxLength={80} placeholder="Brooklyn, NY" onChange={(e) => set('city', e.target.value)} />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-2 flex justify-between">
                  <span className="label mb-0">Bio</span>
                  <span className="text-xs text-faint">{form.bio.length}/500</span>
                </span>
                <textarea className="field min-h-28 resize-y" value={form.bio} maxLength={500} placeholder="A few lines that sound like you." onChange={(e) => set('bio', e.target.value)} />
              </label>
            </div>
          </section>

          <section className="card space-y-6 p-6 sm:p-8">
            <h2 className="font-display text-3xl">What you're into</h2>
            <InterestPicker value={form.interests} onChange={(v) => set('interests', v)} />
            <PromptEditor value={form.prompts} onChange={(v) => set('prompts', v)} />
          </section>

          <section className="card space-y-6 p-6 sm:p-8">
            <h2 className="font-display text-3xl">Who you'd like to meet</h2>
            <div>
              <span className="label">Show me</span>
              <Segmented<Gender>
                label="Show me"
                multiple
                value={form.interested_in}
                onChange={(v) => set('interested_in', v)}
                options={(Object.keys(GENDER_LABELS) as Gender[]).map((g) => ({ value: g, label: GENDER_LABELS[g] }))}
              />
            </div>
            <AgeRange
              min={form.age_min}
              max={form.age_max}
              onChange={(min, max) => setForm((f) => ({ ...f, age_min: min, age_max: max }))}
            />
          </section>

          <div
            className={clsx(
              'sticky bottom-24 z-20 flex items-center justify-end gap-3 transition lg:bottom-6',
              dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
            )}
          >
            <div className="glass flex items-center gap-3 rounded-full border border-line-strong p-2 pl-5 shadow-card">
              <span className="text-sm text-muted">Unsaved changes</span>
              <button type="button" className="btn-ghost py-2.5" onClick={() => setForm(formFrom(user))}>
                Discard
              </button>
              <button type="submit" className="btn-primary py-2.5" disabled={save.isPending}>
                {save.isPending ? <Spinner className="size-4" /> : <Check className="size-4" />} Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

function PhotoManager({ user, onChange }: { user: Me; onChange: (me: Me) => void }) {
  const { data: meta } = useMeta()
  const input = useRef<HTMLInputElement>(null)
  const max = meta?.max_photos ?? 6
  const [error, setError] = useState<string | null>(null)

  const upload = useMutation({
    mutationFn: api.uploadPhoto,
    onSuccess: onChange,
    onError: (e) => setError((e as Error).message),
  })
  const remove = useMutation({ mutationFn: api.deletePhoto, onSuccess: onChange })
  const reorder = useMutation({
    mutationFn: (photos: string[]) => api.updateMe({ photos }),
    onSuccess: onChange,
  })

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 4000)
    return () => clearTimeout(timer)
  }, [error])

  const slots = Array.from({ length: max }, (_, i) => user.photos[i])
  return (
    <section className="w-full max-w-md xl:sticky xl:top-10 xl:max-w-none xl:self-start">
      <div className="grid grid-cols-3 gap-3">
        {slots.map((photo, index) =>
          photo ? (
            <div
              key={photo}
              className={clsx(
                'group relative overflow-hidden rounded-3xl border border-line bg-surface [container-type:inline-size]',
                index === 0 ? 'col-span-2 row-span-2 aspect-[3/4]' : 'aspect-[3/4]',
              )}
            >
              <Photo src={photo} name={user.name} className="size-full" />
              {index === 0 && (
                <span className="absolute bottom-3 left-3 rounded-full bg-ink/70 px-2.5 py-1 text-[11px] font-bold tracking-wide backdrop-blur">
                  MAIN PHOTO
                </span>
              )}
              <div className="absolute top-2 right-2 flex gap-1.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => reorder.mutate([photo, ...user.photos.filter((p) => p !== photo)])}
                    className="glass grid size-8 place-items-center rounded-full border border-line-strong text-apricot"
                    aria-label="Make main photo"
                    title="Make main photo"
                  >
                    <Star className="size-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove.mutate(photo)}
                  className="glass grid size-8 place-items-center rounded-full border border-line-strong text-rose"
                  aria-label="Remove photo"
                  title="Remove photo"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
          ) : (
            <button
              key={`empty-${index}`}
              type="button"
              onClick={() => input.current?.click()}
              disabled={upload.isPending}
              className={clsx(
                'grid place-items-center rounded-3xl border-2 border-dashed border-line-strong bg-surface/50 text-faint transition hover:border-coral/60 hover:text-coral',
                index === 0 ? 'col-span-2 row-span-2 aspect-[3/4]' : 'aspect-[3/4]',
              )}
              aria-label="Add a photo"
            >
              {upload.isPending && index === user.photos.length ? (
                <Spinner className="text-coral" />
              ) : index === 0 ? (
                <span className="flex flex-col items-center gap-3 text-sm font-semibold">
                  <Camera className="size-9" /> Add your best photo
                </span>
              ) : (
                <ImagePlus className="size-6" />
              )}
            </button>
          ),
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/heic"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) upload.mutate(file)
          e.target.value = ''
        }}
      />
      <p className={clsx('mt-4 text-sm', error ? 'text-danger' : 'text-faint')}>
        {error ?? 'Lead with a clear photo of your face. Uploads are resized and converted to WebP on the server.'}
      </p>
    </section>
  )
}
