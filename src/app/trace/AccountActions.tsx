'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card } from '@/components/ui'
import { apiPost, ApiError } from '@/lib/client'

/**
 * Керування доступом і даними.
 *
 * Три дії навмисно розділені, бо означають різне:
 *   · «Вийти» — про цей браузер, дані лишаються;
 *   · «Відвʼязати «Сільпо»» — про доступ до вашого акаунта в магазині;
 *   · «Видалити всі дані» — незворотне.
 * Раніше жодної з них не було: токен «Сільпо» неможливо було прибрати
 * через інтерфейс узагалі.
 */
export function AccountActions({ linked }: { linked: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmErase, setConfirmErase] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(action: string, url: string, after: () => void) {
    setBusy(action)
    setError(null)
    try {
      await apiPost(url)
      after()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося виконати')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="mb-4">
      <h2 className="mb-1 text-[15px] font-semibold">Доступ і дані</h2>
      <p className="mb-3 text-[12px] leading-relaxed text-graphite-500">
        Токени «Сільпо» зберігаються на сервері. Ви можете відкликати доступ або
        стерти все, що застосунок про вас знає.
      </p>

      {message && (
        <div className="mb-3 rounded-2xl bg-success-50 p-3 text-[13px] text-[#1f6b3a]">{message}</div>
      )}
      {error && <div className="mb-3 rounded-2xl bg-danger-50 p-3 text-[13px] text-danger-700">{error}</div>}

      <div className="space-y-2">
        {linked && (
          <Button
            full
            variant="secondary"
            disabled={busy !== null}
            onClick={() =>
              run('unlink', '/api/auth/unlink', () => {
                setMessage('Доступ до «Сільпо» відкликано. Комора й раціон лишились на місці.')
                router.refresh()
              })
            }
          >
            {busy === 'unlink' ? 'Відвʼязую…' : '🔓 Відвʼязати «Сільпо»'}
          </Button>
        )}

        <Button
          full
          variant="secondary"
          disabled={busy !== null}
          onClick={() =>
            run('logout', '/api/auth/logout', () => {
              router.push('/login')
              router.refresh()
            })
          }
        >
          {busy === 'logout' ? 'Виходжу…' : '↪ Вийти'}
        </Button>

        {!confirmErase ? (
          <Button full variant="danger" disabled={busy !== null} onClick={() => setConfirmErase(true)}>
            🗑 Видалити всі мої дані
          </Button>
        ) : (
          <div className="rounded-2xl bg-danger-50 p-3">
            <p className="text-[13px] font-medium text-danger-700">
              Буде видалено назавжди: комора, раціон, історія розпізнавань, пропозиції кошика
              й токени «Сільпо». Кошик у самому «Сільпо» не змінюється.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setConfirmErase(false)}>
                Скасувати
              </Button>
              <Button
                variant="danger"
                disabled={busy !== null}
                onClick={() =>
                  run('erase', '/api/account/erase', () => {
                    setConfirmErase(false)
                    setMessage('Дані видалено.')
                    router.push('/login')
                    router.refresh()
                  })
                }
              >
                {busy === 'erase' ? 'Видаляю…' : 'Так, видалити'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
