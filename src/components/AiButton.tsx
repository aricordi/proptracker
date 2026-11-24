// The ✦ AI button in the top corner of the screens. People who film (and Props-only creators) get the ChatGPT / Claude
// launcher (owner, Nov 24, option A); the team gets the app's own "how do I…" chat.
import { useAssistant, type AssistantMode } from '../assistant'
import { useSession } from '../auth'
import { openAiLauncher } from './AiLauncher'

export default function AiButton({ mode }: { mode?: AssistantMode }) {
  const { open, available } = useAssistant()
  const { canBook, demo } = useSession()
  if (!available) return null
  const launch = canBook || demo
  return (
    <button onClick={() => launch ? openAiLauncher(mode === 'time' ? 'Using Prime Capitol, help me find a time to film.' : mode === 'props' ? 'Using Prime Capitol, help me find props from the closet for my next video.' : '') : open(mode)}
      aria-label={launch ? 'Open ChatGPT or Claude' : 'Ask how the app works'} title={launch ? 'Open ChatGPT or Claude' : 'Ask how the app works'}
      className="shrink-0 h-11 rounded-full pl-3 pr-4 flex items-center gap-1.5 text-[14px] font-bold text-[#140f22] bg-[#BF9DFF] shadow-violet">
      <span className="text-[16px] leading-none">✦</span>AI
    </button>
  )
}
