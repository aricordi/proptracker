import { describe, it, expect } from 'vitest'
import { cleanPlace, fileIdFrom, tidyList, joinLists, listEntries, withSize } from '../../functions/src/importList'
import { cleanSize, matchInList } from '../../functions/src/gemini'

describe('import: closet spot + inventory list', () => {
  it('tidies the spot name', () => {
    expect(cleanPlace('  Wardrobe\n closet ')).toBe('Wardrobe closet')
    expect(cleanPlace(42)).toBe('')
    expect(cleanPlace('x'.repeat(60))).toHaveLength(40)
  })

  it('reads file ids from Docs, Sheets and Drive links, never folders', () => {
    expect(fileIdFrom('https://docs.google.com/document/d/1-QAJtWtGqlaXYgMN3oiXvKK6RkQfagY0ooPJ2Vixh1A/edit?usp=sharing')).toBe('1-QAJtWtGqlaXYgMN3oiXvKK6RkQfagY0ooPJ2Vixh1A')
    expect(fileIdFrom('https://docs.google.com/spreadsheets/d/abcdefghijklmnop123/edit')).toBe('abcdefghijklmnop123')
    expect(fileIdFrom('https://drive.google.com/file/d/abcdefghijklmnop123/view')).toBe('abcdefghijklmnop123')
    expect(fileIdFrom('https://drive.google.com/drive/folders/1IUQ3pFf4HWkwFtAmxtaHaFj0RzAxCT2d')).toBe('')
    expect(fileIdFrom('nope')).toBe('')
  })

  it('tidies and joins lists, counts entries', () => {
    const t = tidyList('8 gas masks\r\n\r\n\r\n11 hazmat suits  \n​\n  1 safety vest')
    expect(t).toBe('8 gas masks\n11 hazmat suits\n1 safety vest')
    const j = joinLists([{ name: 'WR List', text: t }, { name: 'Empty', text: '  ' }])
    expect(j.startsWith('# WR List\n')).toBe(true)
    expect(listEntries(j)).toBe(3)
  })

  it('adds the size to the description once', () => {
    expect(withSize('Wool coat', 'XL')).toBe('Wool coat. Size XL.')
    expect(withSize('Wool coat. Size XL.', 'XL')).toBe('Wool coat. Size XL.')
    expect(withSize('', '38R')).toBe('Size 38R.')
    expect(withSize('Wool coat', null)).toBe('Wool coat')
  })

  it('keeps only sizes that look like sizes, and list matches that are really in the list', () => {
    expect(cleanSize('Size: XL')).toBe('XL')
    expect(cleanSize('unknown')).toBeNull()
    expect(cleanSize(null)).toBeNull()
    const list = '# WR List\n1 black peacoat (xl)\n3 white lab coat (OS)'
    expect(matchInList('1 Black Peacoat (XL)', list)).toBe('1 black peacoat (xl)')
    expect(matchInList('white lab coat', list)).toBe('3 white lab coat (OS)')
    expect(matchInList('1 purple dinosaur suit', list)).toBeNull()
    expect(matchInList('WR List', list)).toBeNull()
  })
})
