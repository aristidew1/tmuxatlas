import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TopBar } from './TopBar'

function renderTopBar(sidebarHidden: boolean) {
  render(
    <TopBar
      currentView="overview"
      sidebarHidden={sidebarHidden}
      onToggleCollapse={vi.fn()}
      onOverview={vi.fn()}
      onMonitoring={vi.fn()}
      onWall={vi.fn()}
      onOpenPalette={vi.fn()}
      onSettings={vi.fn()}
      events={[]}
      onJumpToSession={vi.fn()}
      onDismiss={vi.fn()}
      onDismissAll={vi.fn()}
    />,
  )
  return screen.getByRole('button', { name: 'Afficher la barre latérale' })
}

describe('TopBar sidebar toggle', () => {
  afterEach(cleanup)

  it('reste réservé aux écrans où la barre latérale ne peut pas le porter', () => {
    expect(renderTopBar(false)).toHaveClass('lg:hidden')
  })

  it('reste disponible sur grand écran quand la barre latérale est masquée', () => {
    expect(renderTopBar(true)).not.toHaveClass('lg:hidden')
  })
})
