import { describe, expect, it } from 'vitest'
import { passkeyError } from './useAuth'

describe('passkeyError', () => {
  it('explains common browser and setup errors in French', () => {
    expect(passkeyError(new Error('invalid setup token or session'), 'Erreur')).toBe(
      'Le jeton de configuration ou la session est invalide.',
    )
    expect(passkeyError(new DOMException('cancelled', 'NotAllowedError'), 'Erreur')).toBe(
      'La demande de passkey a été annulée ou a expiré.',
    )
    expect(passkeyError(new Error('This browser does not support passkeys'), 'Erreur')).toBe(
      'Ce navigateur ne prend pas en charge les passkeys.',
    )
    expect(passkeyError(new Error('untranslated server error'), 'Erreur')).toBe('Erreur')
  })
})
