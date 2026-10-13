import { describe, it, expect } from 'vitest'
import { folderIdFrom, resourceKeyFrom } from '../../functions/src/drive'

describe('Drive folder links', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'
  it('finds the folder ID in the usual link shapes', () => {
    expect(folderIdFrom(`https://drive.google.com/drive/folders/${id}?usp=sharing`)).toBe(id)
    expect(folderIdFrom(`https://drive.google.com/drive/u/1/folders/${id}`)).toBe(id)
    expect(folderIdFrom(`https://drive.google.com/open?id=${id}`)).toBe(id)
    expect(folderIdFrom(id)).toBe(id)
    expect(folderIdFrom('https://example.com/nope')).toBeNull()
  })
  it('keeps the security code that older shared links carry', () => {
    expect(resourceKeyFrom(`https://drive.google.com/drive/folders/${id}?resourcekey=0-AbC_123&usp=sharing`)).toBe('0-AbC_123')
    expect(resourceKeyFrom(`https://drive.google.com/drive/folders/${id}?usp=sharing`)).toBeUndefined()
  })
})
