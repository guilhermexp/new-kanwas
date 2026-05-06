import * as Tooltip from '@radix-ui/react-tooltip'

const HEADER_TOOLTIP_CLASS =
  'z-[70] max-w-[260px] rounded-lg bg-[var(--palette-tooltip)] px-3 py-2 text-xs leading-relaxed text-white shadow-lg'

export interface AgentFollowToggleButtonCopy {
  ariaLabel: string
  title: string
}

interface AgentFollowToggleButtonProps {
  enabled: boolean
  copy: AgentFollowToggleButtonCopy
  onToggle: () => void
}

export function AgentFollowToggleButton({ enabled, copy, onToggle }: AgentFollowToggleButtonProps) {
  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger
          type="button"
          onClick={onToggle}
          aria-label={copy.ariaLabel}
          aria-pressed={enabled}
          className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-chat-link/60 active:scale-95 ${
            enabled
              ? 'border-chat-link/30 bg-chat-pill text-chat-link shadow-chat-pill hover:border-chat-link/50 hover:bg-chat-pill/80'
              : 'border-chat-pill-border bg-transparent text-foreground-muted hover:border-outline hover:bg-chat-pill hover:text-chat-link'
          }`}
        >
          <i className="fa-solid fa-location-arrow text-[9px]" aria-hidden="true" />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className={HEADER_TOOLTIP_CLASS} side="bottom" align="center" sideOffset={8}>
            {copy.title}
            <Tooltip.Arrow className="fill-[var(--palette-tooltip)]" width={8} height={4} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
