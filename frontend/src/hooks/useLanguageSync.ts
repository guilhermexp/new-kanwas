import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getUserConfig } from '@/api/userConfig'
import { isAppLanguage, setAppLanguage } from '@/i18n'

/**
 * Applies the user's saved interface language once the user config loads.
 *
 * localStorage (via the i18next detector) already restores the last choice on
 * reload, so this only matters for the first load on a new device. Shares the
 * `['user-config']` query key, so it dedupes with the chat/settings reads.
 */
export function useLanguageSync(): void {
  const { data } = useQuery({
    queryKey: ['user-config'],
    queryFn: getUserConfig,
  })

  const language = data?.config.language

  useEffect(() => {
    if (isAppLanguage(language)) {
      setAppLanguage(language)
    }
  }, [language])
}
