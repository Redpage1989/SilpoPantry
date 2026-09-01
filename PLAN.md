# PLAN.md — «Сільпо: Сімейна комора»

> Хакатон «Сільпо» AI Factory. Прототип. Не є офіційним продуктом ТОВ «Сільпо».
> Реєстрація до 31.08.2026 · розробка 01–14.09.2026 · фінал 30.09.2026.

## 0. Аналіз репозиторію (baseline)

`~/Developer` — не git-репозиторій верхнього рівня, а набір незалежних проєктів
(`SvitloPlus`, `Komunalka`, `AutoJournal`, `Svyata`, `AbetkaUA`, …). Спільного
монорепо, спільних пакетів або shared-конфігів немає.

Що з цього переносимо як перевірені патерни (без копіювання коду):

| Джерело | Патерн, який переносимо |
|---|---|
| `Komunalka`, `SvitloPlus` | Next.js 15 App Router + Prisma, mobile-first PWA, українська локаль |
| `AutoJournal` | offline-first UI-каркас + серверний API лише для AI-сканів |
| `Komunalka` | сканування документів/чеків через власний бекенд, а не з клієнта |

Висновок: **новий ізольований проєкт** `~/Developer/SilpoPantry`, власний git,
без залежностей від сусідніх проєктів.

## 1. Що вже перевірено на живому MCP (факти, не припущення)

```
POST https://mcp.silpo.ua/mcp                 → 401 invalid_token
                                                 WWW-Authenticate: Bearer realm="OAuth",
                                                 resource_metadata=.../oauth-protected-resource/mcp
GET  /.well-known/oauth-protected-resource/mcp → {"resource":"https://mcp.silpo.ua/mcp",
                                                  "authorization_servers":["https://mcp.silpo.ua"]}
GET  /.well-known/oauth-authorization-server   → authorization_endpoint /authorize
                                                 token_endpoint         /token
                                                 registration_endpoint  /register   ← DCR є
                                                 code_challenge_methods ["plain","S256"]
                                                 grant_types ["authorization_code","refresh_token"]
                                                 token_endpoint_auth_methods ["client_secret_basic",
                                                                              "client_secret_post","none"]
```

Наслідки для архітектури:

1. MCP закритий Bearer-токеном → **жодного MCP-виклику з браузера**. Тільки сервер.
2. Є Dynamic Client Registration → застосунок реєструє себе сам, `SILPO_CLIENT_ID`
   не треба зашивати в репозиторій. Це прямо задовольняє вимогу «без секретів у git».
3. `tools/list` теж під токеном → **список і схеми 39 інструментів отримуємо в рантаймі**
   і кешуємо у `.silpo-cache/tools.json` (в `.gitignore`). Аргументи tools ніколи
   не вигадуємо: перед кожним викликом валідуємо payload проти схеми з `tools/list`.

## 2. Позиціонування (впливає на пріоритети коду)

Ваги журі: інноваційність 25% · вплив на Гостя 25% · реалістичність 20% ·
презентація 15% · технічна складова 15%.

Головна теза: **це не «сфотографуй холодильник → рецепт», а цифрова сімейна комора,
яка наповнюється з історії чеків «Сільпо» і лише уточнюється фотографіями.**

Тому пріоритет №1 у коді — `receipts → pantry` (inference із `silpo_get_my_offline_orders`
та `silpo_get_my_online_orders`), а фото — вторинне джерело з нижчим пріоритетом злиття.
METRO та інші мережі — поза скоупом конкурсної версії.

## 3. Стек

| Шар | Рішення |
|---|---|
| UI | Next.js 15 App Router, TS strict, Tailwind v4, власна легка UI-система, mobile-first 390×844 |
| Стан | TanStack Query, React Hook Form + Zod |
| PWA | manifest + service worker, standalone, safe-area |
| API | Next Route Handlers, Zod-валідація на вході й виході |
| БД | Prisma; SQLite локально, PostgreSQL у prod (один `schema.prisma`, `provider` з env) |
| AI | Claude multimodal (`claude-opus-5` / `claude-sonnet-5`) + structured output через Zod→JSON Schema |
| MCP | власний Streamable HTTP клієнт + OAuth 2.1 AC+PKCE+DCR, адаптер mock ⇄ live |
| Тести | Vitest (unit), Playwright (E2E) |

## 4. Архітектура (шари)

```
app/(screens)            — 5 табів + онбординг + авторизація
  └─ api/*               — Route Handlers, єдина точка входу для клієнта
       └─ lib/agent      — FamilyFoodAgent: планувальник + 15 типізованих tools
            ├─ lib/domain   — чиста логіка: normalize, scoring, missing, pricing, cook-vs-ready
            ├─ lib/ai       — Claude vision + recipe generation, structured output
            ├─ lib/mcp      — SilpoMcpAdapter (live | mock), OAuth store, schema guard
            └─ lib/db       — Prisma
```

Клієнт **ніколи** не тримає токен і не звертається до `mcp.silpo.ua`.
Токени — httpOnly secure cookie (session id) + серверне сховище.

## 5. Модель даних

`User`, `HouseholdMember`, `FoodRestriction`, `PantryItem`, `RecognitionJob`,
`Recipe`, `MealPlan`, `ShoppingProposal`, `AgentRun` — точно за ТЗ, плюс
`McpSession` (токени, серверно) і `ReceiptImport` (журнал інференсу з чеків),
бо без них сценарій «комора з чеків» недоказовий.

`User.fulfillment` — спосіб отримання замовлення (доставка / самовивіз /
купівля в магазині). Свідомо поле ЗАСТОСУНКУ, а не виклик MCP: серед
інструментів «Сільпо» немає такого, що перемикає спосіб отримання, тому
вибір лише перераховує підсумки й попередження на екрані кошика. Щойно
такий інструмент зʼявиться в `tools/list` — вибір поїде в нього.

## 6. Агент

`FamilyFoodAgent` будує план і виконує типізовані tools:

getHouseholdContext · getFoodRestrictions · analyzePantryPhotos · getPantryInventory ·
updatePantryInventory · findExpiringProducts · importPantryFromReceipts ·
generateRecipeOptions · calculateMissingIngredients · searchSilpoProducts ·
compareProductOptions · compareCookVsReadyMeal · createShoppingProposal ·
addConfirmedItemsToCart · getCartSummary · recordCookedMeal

Кожен tool: Zod-схема входу/виходу, запис у `safeTrace` з маскуванням PII.
Усі write-tools (`addConfirmedItemsToCart`, `updatePantryInventory`) —
тільки після явного `confirmationToken` від користувача.

## 7. Scoring (прозорий, пояснюваний)

```
score = pantryCoverage*0.30 + expiryRescue*0.25 + restrictionMatch*0.20
      + budgetMatch*0.10 + timeMatch*0.10 + preferenceMatch*0.05
```
`restrictionMatch = 0` при алергені → страва відсіюється, а не просто падає в рейтингу.
Кожен фактор повертає `explanation` українською для UI.

## 8. Етапи виконання

- [x] E0 Аналіз репозиторію, probe MCP discovery, PLAN.md
- [x] E1 Каркас: Next 15, Tailwind, UI-кіт, PWA, бренд-токени
- [x] E2 Prisma-схема + seed (родина Антона, 9 продуктів, шпинат «до завтра»)
- [x] E3 Домейн-логіка + unit-тести (normalize, scoring, missing, pricing, cook-vs-ready, списання)
- [x] E4 MCP-шар: OAuth DCR+PKCE, Streamable HTTP, schema guard, mock⇄live адаптер
- [x] E5 AI-шар: Claude vision → JSON items з confidence; генерація рецептів
- [x] E6 Агент: планувальник, 16 tools, safeTrace
- [x] E7 Екрани: Авторизація, Онбординг, Головна, Сканування+Підтвердження, Комора, Рецепти, Рецепт, Тірамісу, Кошик, Agent Trace
- [x] E8 Тести: Vitest + Playwright E2E (повний demo-сценарій)
- [x] E9 Документація: README, ARCHITECTURE(+Mermaid), SUBMISSION, DEMO_SCRIPT, .env.example
- [x] E10 lint → typecheck → unit → e2e → звіт «що live, що demo»

Додано поза початковим планом:

- [x] E11 Тижневий раціон на 1–14 днів із симуляцією споживання й одним списком покупок
- [x] E12 Сканування штрихкоду (EAN-13/EAN-8 із перевіркою контрольної цифри)
- [x] E13 30 рецептів і 92 кулінарні поради замість початкових 12
- [x] E14 Імпорт комори з історії чеків «Сільпо» з кривою споживання
- [x] E15 Деплой: Docker + Cloudflare Tunnel → https://komora.im.pl.ua
- [x] E16 Керування акаунтом: вихід, відвʼязка «Сільпо» без втрати даних, повне видалення
- [x] E17 Рецепти спільноти, голосування за рецепт тижня, заявка на приз переможцю

Стан: 180 unit-тестів, 8 наскрізних E2E, увесь сценарій пройдено на живому MCP.

## 9. Ризики та чесні межі

| Ризик | Рішення |
|---|---|
| MCP потребує інтерактивного OAuth; поточна сесія неінтерактивна | Флоу реалізовано повністю; live-виклик виконує користувач у браузері одним кліком, результат зберігається у `docs/live-mcp-proof/` |
| Точні назви/схеми 39 tools наперед невідомі | `tools/list` у рантаймі + `SchemaGuard`: якщо очікуваного tool немає — деградуємо в demo і кажемо про це в UI |
| Фото не дає ваги, вмісту закритої упаковки, терміну придатності | `confidence` + обов'язковий екран підтвердження + статус `needsConfirmation` |
| Алергії | окреме червоне попередження, перевірка складу через product details, без медичних гарантій |
| Немає `ANTHROPIC_API_KEY` | vision деградує у detерміністичний demo-аналізатор із чесним бейджем DEMO |

## 10. Definition of Done

Запуск однією командою · працює на 390×844 · demo mode без жодного ключа ·
фото → підтвердження → комора · ≥3 рецепти · сценарій «Хочу тірамісу» з трьома
ціновими варіантами і порівнянням «готувати vs купити» · MCP-адаптер із
живим OAuth · усі write-операції з підтвердженням · lint/typecheck/unit/e2e зелені ·
жодних секретів, токенів і PII у git.
