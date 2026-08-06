import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { NewRecipeForm } from './NewRecipeForm'

export const dynamic = 'force-dynamic'

export default async function NewRecipePage() {
  const userId = await getUserId()
  if (!userId) redirect('/login')

  return (
    <main className="safe-top px-4 pb-6 pt-4">
      <header className="mb-4">
        <h1 className="text-[22px] font-bold tracking-tight">Свій рецепт</h1>
        <p className="text-[13px] text-graphite-500">
          Поділіться сімейною стравою. Поради цінуються більше за самі кроки.
        </p>
      </header>

      <NewRecipeForm />
    </main>
  )
}
