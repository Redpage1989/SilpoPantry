'use client'

import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Card } from './ui'
import { apiPost, ApiError } from '@/lib/client'
import { formatQuantity } from '@/lib/domain/units'
import type { PantryUnit } from '@/lib/domain/types'

/**
 * Сканування штрихкоду.
 *
 * Використовує вбудований у браузер BarcodeDetector там, де він є
 * (Chrome на Android і десктопі). Це прогресивне покращення, а не вимога:
 * якщо API немає — лишається ручне введення коду, і сценарій працює.
 * Тягнути 200 КБ JS-декодера в прототип заради решти браузерів не варто.
 */

interface FoundItem {
  originalName: string
  normalizedName: string
  category: string
  storageLocation: string
  quantity: number
  unit: PantryUnit
  confidence: number
  productId?: string
}

interface LookupResponse {
  ok: boolean
  reason?: 'invalid_checksum' | 'not_found'
  message?: string
  mode?: 'live' | 'mock'
  barcode?: { code: string; format: string; countryHint?: string }
  item?: FoundItem
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>
}

type DetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

function getDetectorCtor(): DetectorCtor | null {
  const w = window as unknown as { BarcodeDetector?: DetectorCtor }
  return w.BarcodeDetector ?? null
}

export function BarcodeScanner({ onFound }: { onFound: (item: FoundItem) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [supported, setSupported] = useState<boolean | null>(null)
  const [scanning, setScanning] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [result, setResult] = useState<LookupResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSupported(getDetectorCtor() !== null)
    // камеру треба відпустити, коли компонент зникає з екрана
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setScanning(false)
  }

  async function lookup(code: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await apiPost<LookupResponse>('/api/barcode', { code })
      setResult(res)
      if (res.ok && res.item) stopCamera()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося перевірити код')
    } finally {
      setBusy(false)
    }
  }

  async function startCamera() {
    const Ctor = getDetectorCtor()
    if (!Ctor) return
    setError(null)
    setResult(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setScanning(true)

      const detector = new Ctor({ formats: ['ean_13', 'ean_8'] })
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return
        try {
          const codes = await detector.detect(videoRef.current)
          if (codes.length > 0) {
            await lookup(codes[0].rawValue)
            return
          }
        } catch {
          // окремий невдалий кадр — не привід зупиняти сканування
        }
        if (streamRef.current) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    } catch {
      setError('Не вдалося отримати доступ до камери. Введіть код вручну.')
      setScanning(false)
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Штрихкод</h3>
        {supported === false && <Badge tone="neutral">камера недоступна</Badge>}
      </div>

      {scanning && (
        <div className="mb-3 overflow-hidden rounded-2xl bg-black">
                  <video ref={videoRef} className="h-48 w-full object-cover" playsInline muted />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {supported && !scanning && (
          <Button variant="secondary" onClick={startCamera} disabled={busy}>
            📷 Сканувати
          </Button>
        )}
        {scanning && (
          <Button variant="ghost" onClick={stopCamera}>
            Зупинити
          </Button>
        )}
        <div className={supported && !scanning ? '' : 'col-span-2'}>
          <div className="flex gap-2">
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              inputMode="numeric"
              placeholder="Код вручну"
              aria-label="Штрихкод вручну"
              className="min-h-[48px] flex-1 rounded-2xl bg-cream-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent-300"
            />
            <Button onClick={() => lookup(manualCode)} disabled={busy || manualCode.length < 6}>
              {busy ? '…' : 'Знайти'}
            </Button>
          </div>
        </div>
      </div>

      {error && <div className="mt-3 rounded-2xl bg-danger-50 p-3 text-[13px] text-danger-700">{error}</div>}

      {result && !result.ok && (
        <div className="mt-3 rounded-2xl bg-warn-50 p-3 text-[13px] text-[#8a6200]">
          {result.message}
          {result.barcode && (
            <div className="mt-1 font-mono text-[11px]">
              {result.barcode.code} · {result.barcode.format}
              {result.barcode.countryHint && ` · ${result.barcode.countryHint}`}
            </div>
          )}
        </div>
      )}

      {result?.ok && result.item && (
        <div className="mt-3 rounded-2xl bg-success-50 p-3">
          <div className="text-[14px] font-semibold text-graphite-900">{result.item.originalName}</div>
          <div className="mt-0.5 text-[12px] text-graphite-500">
            {formatQuantity(result.item.quantity, result.item.unit)} · {result.item.category}
            {result.barcode?.countryHint && ` · ${result.barcode.countryHint}`}
          </div>
          <Button
            full
            className="mt-3"
            onClick={() => {
              onFound(result.item!)
              setResult(null)
              setManualCode('')
            }}
          >
            Додати до підтвердження
          </Button>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-graphite-300">
        Контрольна сума коду перевіряється до звернення до каталогу — камера часто
        видає майже-правильні цифри, і шукати їх безглуздо.
        {supported === false && ' Ваш браузер не має вбудованого сканера, тому доступне лише ручне введення.'}
      </p>
    </Card>
  )
}
