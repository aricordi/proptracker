import { useState, useRef, useMemo } from 'react'
import { normalizeCharacter } from '../services/characters'
import type { Character } from '../types'

interface Props {
  value: string[]
  onChange: (labels: string[]) => void
  suggestions: Character[]
}

export default function CharacterInput({ value, onChange, suggestions }: Props) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    if (!input.trim()) {
      return [...suggestions]
        .sort((a, b) => b.usageCount - a.usageCount)
        .filter(c => !value.some(v => normalizeCharacter(v) === c.normalizedKey))
        .slice(0, 8)
    }
    const q = input.toLowerCase()
    return suggestions
      .filter(c => c.label.toLowerCase().includes(q) || c.normalizedKey.includes(normalizeCharacter(q)))
      .slice(0, 6)
  }, [input, suggestions, value])

  function addCharacter(raw: string) {
    const label = raw.trim().replace(/,$/, '')
    if (!label) return
    const key = normalizeCharacter(label)
    if (value.some(v => normalizeCharacter(v) === key)) { setInput(''); return }
    const master = suggestions.find(c => c.normalizedKey === key)
    onChange([...value, master ? master.label : label])
    setInput('')
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCharacter(input) }
    if (e.key === 'Backspace' && !input && value.length > 0) onChange(value.slice(0, -1))
  }

  return (
    <div className="relative">
      <div
        className="min-h-12 bg-pt-bg border border-pt-border rounded-xl p-2 flex flex-wrap gap-1.5 cursor-text focus-within:border-pt-accent"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map(char => (
          <span key={char} className="flex items-center gap-1 bg-pt-accent/20 text-pt-accent text-sm px-2.5 py-0.5 rounded-full">
            {char}
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onChange(value.filter(v => v !== char)) }}
              className="text-pt-accent/60 leading-none text-base"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true) }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={value.length === 0 ? 'Type a character name, press Enter' : ''}
          className="flex-1 min-w-32 bg-transparent text-pt-text placeholder-pt-muted text-sm focus:outline-none py-1 px-1"
        />
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-pt-surface border border-pt-border rounded-xl overflow-hidden z-20 shadow-xl">
          {filtered.map(char => (
            <button
              key={char.id}
              type="button"
              onMouseDown={() => addCharacter(char.label)}
              className="w-full text-left px-4 py-2.5 text-sm text-pt-text active:bg-pt-border flex items-center justify-between"
            >
              <span>{char.label}</span>
              <span className="text-pt-muted text-xs">{char.usageCount}×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
