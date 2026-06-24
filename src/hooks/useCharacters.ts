import { useState, useEffect } from 'react'
import { subscribeToCharacters } from '../services/characters'
import type { Character } from '../types'

export function useCharacters() {
  const [characters, setCharacters] = useState<Character[]>([])
  useEffect(() => subscribeToCharacters(setCharacters), [])
  return characters
}
