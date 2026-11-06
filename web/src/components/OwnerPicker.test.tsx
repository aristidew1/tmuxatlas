import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountRoleContext, type AccountRole } from '../lib/accountContext'
import { OwnerPicker } from './OwnerPicker'

const show = (role: AccountRole | null, ownerName: string | null) =>
  render(
    <AccountRoleContext.Provider value={role}>
      <OwnerPicker hostId="h" session="travail" ownerName={ownerName} testId="badge" />
    </AccountRoleContext.Provider>,
  )

describe('OwnerPicker', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('donne la session au compte choisi dans le menu', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('directory')
        ? new Response(
            JSON.stringify([
              { id: 'a', username: 'alice' },
              { id: 'b', username: 'bob' },
            ]),
          )
        : new Response('{}'),
    )
    vi.stubGlobal('fetch', fetchMock)
    show('user', 'alice')
    fireEvent.click(screen.getByRole('button', { name: /Changer le propriétaire de travail/ }))
    expect(await screen.findByRole('menuitem', { name: 'alice' })).toBeDisabled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'bob' }))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    const claim = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/session/claim')) as unknown as [
      string,
      RequestInit,
    ]
    expect(JSON.parse(String(claim[1].body))).toEqual({ host_id: 'h', session: 'travail', owner: 'b' })
  })

  it('reste un simple badge hors du mode comptes', () => {
    show(null, 'alice')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByTestId('badge')).toHaveTextContent('alice')
  })

  it('permet à tout compte de reprendre une session libre', () => {
    show('user', null)
    expect(screen.getByTestId('badge')).toHaveTextContent('Libre')
  })
})
