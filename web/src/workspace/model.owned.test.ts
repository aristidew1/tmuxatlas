import { describe, expect, it } from 'vitest'
import { workspaceOwnedBy, type WorkspaceSession, type WorkspaceViewModel } from './model'

const session = (key: string, ownerName: string | null) => ({ key, ownerName }) as WorkspaceSession

describe('workspaceOwnedBy', () => {
  it('ne garde que les sessions du compte', () => {
    const mine = session('h/a', 'aris')
    const other = session('h/b', 'admin')
    const free = session('h/c', null)
    const all = [mine, other, free]
    const workspace = {
      sessions: all,
      byTarget: new Map(all.map(item => [item.key, item])),
      hosts: [{ id: 'h', sessions: all }],
    } as unknown as WorkspaceViewModel

    const result = workspaceOwnedBy(workspace, 'aris')

    expect(result.sessions).toEqual([mine])
    expect([...result.byTarget.keys()]).toEqual(['h/a'])
    expect(result.hosts[0].sessions).toEqual([mine])
  })
})
