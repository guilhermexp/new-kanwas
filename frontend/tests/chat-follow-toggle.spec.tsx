import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentFollowToggleButton } from '@/components/chat/AgentFollowToggleButton'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('AgentFollowToggleButton', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    document.body.innerHTML = ''
  })

  it('renders the Radix follow trigger and toggles without recursive updates', async () => {
    const onToggle = vi.fn()

    await act(async () => {
      root.render(
        <AgentFollowToggleButton
          enabled={false}
          copy={{
            ariaLabel: 'Enable agent follow',
            title: 'Click to enable agent follow',
          }}
          onToggle={onToggle}
        />
      )
    })

    const button = container.querySelector('button[aria-label="Enable agent follow"]') as HTMLButtonElement | null
    expect(button).not.toBeNull()
    expect(button?.getAttribute('aria-pressed')).toBe('false')

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onToggle).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.render(
        <AgentFollowToggleButton
          enabled
          copy={{
            ariaLabel: 'Disable agent follow',
            title: 'Click to disable agent follow',
          }}
          onToggle={onToggle}
        />
      )
    })

    const enabledButton = container.querySelector(
      'button[aria-label="Disable agent follow"]'
    ) as HTMLButtonElement | null
    expect(enabledButton).not.toBeNull()
    expect(enabledButton?.getAttribute('aria-pressed')).toBe('true')
  })
})
