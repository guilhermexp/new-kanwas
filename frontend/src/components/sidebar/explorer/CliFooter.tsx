import * as Tooltip from '@radix-ui/react-tooltip'
import { useTranslation } from 'react-i18next'

const CLI_DOCS_URL = 'https://github.com/kanwas-ai/kanwas/tree/master/cli'

export function CliFooter() {
  const { t } = useTranslation()
  return (
    <Tooltip.Provider delayDuration={300} skipDelayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <a
            href={CLI_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group block w-full cursor-pointer select-none"
            aria-label={t('explorer.installCli')}
          >
            <div className="flex items-center font-medium h-[32px] mx-1 px-3 rounded-[var(--chat-radius)] hover:bg-sidebar-hover transition-colors">
              <i className="fa-solid fa-terminal shrink-0 text-[12px] text-sidebar-icon" aria-hidden="true" />
              <span className="text-sm text-sidebar-item-text ml-1.5">{t('explorer.cliTool')}</span>
              <i
                className="fa-solid fa-arrow-up-right-from-square ml-auto text-[10px] text-sidebar-icon opacity-70 group-hover:text-foreground transition-colors"
                aria-hidden="true"
              />
            </div>
          </a>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="z-[70] max-w-[240px] rounded-lg bg-[var(--palette-tooltip)] px-3 py-2 text-xs leading-relaxed text-white shadow-lg"
            side="top"
            align="center"
            sideOffset={8}
          >
            {t('explorer.cliTooltip')}
            <Tooltip.Arrow className="fill-[var(--palette-tooltip)]" width={8} height={4} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
