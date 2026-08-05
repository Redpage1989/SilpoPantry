'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './ui'

/**
 * Рядок «Хочу приготувати…».
 * Голосовий ввід — через Web Speech API там, де він є; це прогресивне
 * покращення, а не вимога: без нього поле лишається звичайним текстовим.
 */
export function DishRequestBar({ defaultValue = '' }: { defaultValue?: string }) {
  const router = useRouter()
  const [value, setValue] = useState(defaultValue)
  const [listening, setListening] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const q = value.trim()
    if (q.length < 2) return
    router.push(`/dish?query=${encodeURIComponent(q)}`)
  }

  function startVoice() {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) return
    const recognition = new Ctor()
    recognition.lang = 'uk-UA'
    recognition.interimResults = false
    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript
      if (text) setValue(text)
      setListening(false)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    setListening(true)
    recognition.start()
  }

  return (
    // action/method задані навмисно: до завершення гідратації форма має
    // працювати як звичайний GET на /dish, інакше перше натискання
    // «Знайти» просто перезавантажує головну.
    <form onSubmit={submit} action="/dish" method="get" className="space-y-2">
      <div className="flex items-center gap-2 rounded-2xl bg-white p-2 shadow-[0_2px_14px_rgba(34,31,28,0.06)]">
        <span className="pl-2 text-lg" aria-hidden>
          🔎
        </span>
        <input
          name="query"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Хочу приготувати тірамісу…"
          aria-label="Що ви хочете приготувати"
          className="min-h-[44px] flex-1 bg-transparent text-[15px] outline-none placeholder:text-graphite-300"
        />
        <button
          type="button"
          onClick={startVoice}
          aria-label="Сказати голосом"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-graphite-500 active:bg-cream-200"
        >
          {listening ? '🎙️' : '🎤'}
        </button>
      </div>
      <div className="flex gap-2">
        {['Тірамісу', 'Вечеря на двох', 'Паста'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setValue(s)}
            className="rounded-full bg-cream-200 px-3 py-1.5 text-[12px] font-medium text-graphite-700 active:bg-cream-300"
          >
            {s}
          </button>
        ))}
        <Button type="submit" className="ml-auto min-h-[36px] px-4 text-[13px]">
          Знайти
        </Button>
      </div>
    </form>
  )
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  onresult: (event: { results?: { [k: number]: { [k: number]: { transcript?: string } } } }) => void
  onerror: () => void
  onend: () => void
  start: () => void
}
