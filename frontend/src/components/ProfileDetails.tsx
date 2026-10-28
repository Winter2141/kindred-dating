import { Briefcase, MapPin, Quote } from 'lucide-react'
import type { PublicProfile } from '@/lib/types'
import { lastSeen } from '@/lib/time'
import { InterestChip, useInterestEmoji } from './ui'

export function ProfileDetails({
  profile,
  shared = [],
  showHeader = true,
}: {
  profile: PublicProfile
  shared?: string[]
  showHeader?: boolean
}) {
  const emoji = useInterestEmoji()
  return (
    <div className="space-y-6">
      {showHeader && (
        <div>
          <h3 className="font-display text-4xl leading-none">
            {profile.name} <span className="text-muted">{profile.age}</span>
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
          {profile.city && (
            <span className="inline-flex items-center gap-2">
              <MapPin className="size-4 text-coral" /> {profile.city}
            </span>
          )}
        </div>
      )}

      {profile.bio && <p className="text-[15px] leading-relaxed text-cream/90">{profile.bio}</p>}

      {profile.prompts.map((prompt) => (
        <figure key={prompt.question} className="rounded-3xl border border-line bg-raised/60 p-5">
          <figcaption className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            <Quote className="size-3.5 text-coral" /> {prompt.question}
          </figcaption>
          <blockquote className="mt-2.5 font-display text-2xl leading-snug">{prompt.answer}</blockquote>
        </figure>
      ))}

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
