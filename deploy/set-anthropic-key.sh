#!/usr/bin/env bash
# Додає ANTHROPIC_API_KEY у .env і перезапускає застосунок.
#
#   ssh -t server 'bash /home/im/apps/silpo-pantry/deploy/set-anthropic-key.sh'
#
# Ключ вводиться інтерактивно й НЕ потрапляє:
#   · у історію команд (не є аргументом),
#   · у вивід термінала (read -s),
#   · у логи docker (передається через .env, а не через command line).
#
# Перевірити стан без зміни:  bash set-anthropic-key.sh --status
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"

[[ -f $ENV_FILE ]] || { echo "Немає $ENV_FILE — спершу розгорніть застосунок."; exit 1; }

current_state() {
    local line
    line=$(grep -E '^ANTHROPIC_API_KEY=' "$ENV_FILE" || true)
    if [[ -z $line || $line == 'ANTHROPIC_API_KEY=' ]]; then
        echo "порожній — розпізнавання фото працює в demo-режимі"
    else
        # показуємо лише довжину й хвіст, ніколи не сам ключ
        local value=${line#ANTHROPIC_API_KEY=}
        echo "заданий (${#value} символів, …${value: -4})"
    fi
}

if [[ ${1:-} == --status ]]; then
    echo "ANTHROPIC_API_KEY: $(current_state)"
    exit 0
fi

echo "Поточний стан: $(current_state)"
echo
echo "Вставте ключ Anthropic (введення не відображається, Enter — підтвердити)."
echo "Порожній рядок — скасувати."
printf 'ANTHROPIC_API_KEY: '
read -rs KEY
echo

[[ -n $KEY ]] || { echo "Скасовано, нічого не змінено."; exit 0; }

if [[ ! $KEY =~ ^sk-ant- ]]; then
    echo "⚠ Ключ не починається з «sk-ant-». Схоже, це не ключ Anthropic."
    printf 'Усе одно записати? [y/N] '
    read -r CONFIRM
    [[ $CONFIRM == [yY] ]] || { echo "Скасовано."; exit 0; }
fi

BACKUP="$ENV_FILE.bak-$(date +%s)"
cp -a "$ENV_FILE" "$BACKUP"
chmod 600 "$BACKUP"

# Замінюємо рядок цілком; python, а не sed, щоб спецсимволи в ключі
# не інтерпретувалися як частина шаблону заміни.
KEY="$KEY" python3 - "$ENV_FILE" <<'PY'
import os, sys, pathlib
path = pathlib.Path(sys.argv[1])
key = os.environ['KEY']
lines = path.read_text().splitlines()
out, replaced = [], False
for line in lines:
    if line.startswith('ANTHROPIC_API_KEY='):
        out.append(f'ANTHROPIC_API_KEY={key}')
        replaced = True
    else:
        out.append(line)
if not replaced:
    out.append(f'ANTHROPIC_API_KEY={key}')
path.write_text('\n'.join(out) + '\n')
PY
unset KEY
chmod 600 "$ENV_FILE"

echo "Записано. Копія попереднього .env: $BACKUP"
echo
echo "Перезапускаю контейнер…"
cd "$APP_DIR/deploy"
docker compose up -d --force-recreate >/dev/null 2>&1
sleep 8

echo "Стан: $(docker ps --filter name=silpo-pantry --format '{{.Status}}')"
# перевіряємо лише НАЯВНІСТЬ змінної в контейнері, не значення
if docker exec silpo-pantry sh -c '[ -n "$ANTHROPIC_API_KEY" ]' 2>/dev/null; then
    echo "✅ Ключ видно всередині контейнера — розпізнавання фото працюватиме через Claude."
else
    echo "⚠ Змінна в контейнері порожня. Перевірте docker compose logs."
fi
curl -sS -o /dev/null -w "Перевірка: /login → HTTP %{http_code}\n" http://127.0.0.1:8093/login || true
