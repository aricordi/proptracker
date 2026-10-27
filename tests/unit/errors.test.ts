import { describe, it, expect } from 'vitest'
import { friendlyError } from '../../src/lib/errors'

describe('friendlyError', () => {
  it('keeps our own server messages', () => {
    expect(friendlyError({ code: 'functions/failed-precondition', message: 'Too late to add props to this shoot.' })).toBe('Too late to add props to this shoot.')
  })
  it('keeps messages that contain a colon', () => {
    expect(friendlyError({ code: 'functions/failed-precondition', message: 'Not free: Rotary phone' })).toBe('Not free: Rotary phone')
  })
  it('turns "internal" into plain words', () => {
    expect(friendlyError({ code: 'functions/internal', message: 'internal' })).toMatch(/our side/)
  })
  it('no signal', () => {
    expect(friendlyError({ code: 'functions/unavailable', message: 'unavailable' })).toMatch(/signal/)
    expect(friendlyError(new TypeError('Failed to fetch'))).toMatch(/signal/)
  })
  it('permissions', () => {
    expect(friendlyError({ code: 'permission-denied', message: 'Missing or insufficient permissions.' })).toMatch(/not allowed/)
  })
  it('strips Firebase prefixes and suffixes', () => {
    expect(friendlyError({ code: 'storage/unknown', message: 'Firebase: Upload stopped (storage/unknown).' })).toBe('Upload stopped')
  })
  it('falls back', () => { expect(friendlyError(null, 'Nope')).toBe('Nope') })
})
