import { useTranslation } from 'react-i18next'

export function ConnectionsModalFooter() {
  const { t } = useTranslation()
  return (
    <div className="px-5 lg:px-6 py-3 border-t border-outline">
      <p className="text-xs text-foreground-muted text-center">{t('connections.footer')}</p>
    </div>
  )
}
