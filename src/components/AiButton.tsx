// The ✦ AI button in the top corner of the creator screens. Opens the one AI chat (src/assistant.tsx).
import { useAssistant, type AssistantMode } from '../assistant'

export default function AiButton({ mode }: { mode?: AssistantMode }) {
  const { open, available } = useAssistant()
  if (!available) return null
  return (
    <button onClick={() => open(mode)} aria-label="Ask the AI" title="Ask the AI"
      className="shrink-0 h-11 rounded-full pl-3 pr-4 flex items-center gap-1.5 text-[14px] font-bold text-[#140f22] bg-[#BF9DFF] shadow-violet">
      <span className="text-[16px] leading-none">✦</span>AI
    </button>
  )
}
