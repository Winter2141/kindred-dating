import clsx from 'clsx'
import { Briefcase, MapPin, Quote } from 'lucide-react'
import { LikePromptButton } from './LikeComment'
import { formatDistance } from '@/lib/distance'
import type { PublicProfile } from '@/lib/types'
import { lastSeen } from '@/lib/time'
import { AgreementPanel } from './Questions'
import { VisitingBadge } from './Travel'
import { VerifiedBadge } from './Verification'
import { InterestChip, useInterestEmoji } from './ui'

export function ProfileDetails({
  profile,
  shared = [],
  showHeader = true,
  onLikePrompt,
}: {
  profile: PublicProfile
  shared?: string[]
  showHeader?: boolean
  /** When set, each prompt gets a heart to like it with a comment. */
  onLikePrompt?: (prompt: PublicProfile['prompts'][number]) => void
}) {
  const emoji = useInterestEmoji()
  return (
    <div className="space-y-6">
      {showHeader && (
        <div>
          <h3 className="flex items-center gap-2 font-display text-4xl leading-none">
            {profile.name} <span className="text-muted">{profile.age}</span>
            {profile.verified && <VerifiedBadge className="size-6" />}
          </h3>
          <p className="mt-2 text-sm text-muted">{lastSeen(profile.last_active_at, profile.is_online)}</p>
        </div>
      )}

      {(profile.job_title || profile.city) && (
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-cream/85">
          {profile.job_title && (
            <span className="inline-flex items-center gap-2">
              <Briefcase className="size-4 text-coral" /> {profile.job_title}
            </span>
          )}
          {(profile.city || profile.distance_km != null) && (
            <span className="inline-flex items-center gap-2">
              <MapPin className="size-4 text-coral" />
              {[profile.city, formatDistance(profile.distance_km)].filter(Boolean).join(' · ')}
            </span>
          )}
          {profile.visiting && <VisitingBadge place={profile.visiting} />}
        </div>
      )}

      {profile.bio && <p className="text-[15px] leading-relaxed text-cream/90">{profile.bio}</p>}

      {profile.prompts.map((prompt) => (
        <figure key={prompt.question} className="relative rounded-3xl border border-line bg-raised/60 p-5">
          <figcaption className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            <Quote className="size-3.5 text-coral" /> {prompt.question}
          </figcaption>
          <blockquote className={clsx('mt-2.5 font-display text-2xl leading-snug', onLikePrompt && 'pr-10')}>
            {prompt.answer}
          </blockquote>
          {onLikePrompt && (
            <div className="absolute right-4 bottom-4">
              <LikePromptButton name={profile.name} onClick={() => onLikePrompt(prompt)} />
            </div>
          )}
        </figure>
      ))}

      <AgreementPanel userId={profile.id} />

      {profile.interests.length > 0 && (
        <div>
          <p className="label">Interests</p>
          <div className="flex flex-wrap gap-2">
            {profile.interests.map((interest) => (
              <InterestChip
                key={interest}
                name={interest}
                emoji={emoji(interest)}
                shared={shared.includes(interest)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
