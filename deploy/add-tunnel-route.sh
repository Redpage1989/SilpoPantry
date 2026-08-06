#!/usr/bin/env bash
# Публікує komora.im.pl.ua через тунель cloudflared.
# Патерн узятий з /home/im/apps/komunalka/add-tunnel-route.sh.
#
#   ssh -t server 'sudo bash /home/im/apps/silpo-pantry/deploy/add-tunnel-route.sh'
#
# ⚠ DNS цей скрипт НЕ змінює. CNAME створюється в панелі Cloudflare
#   (зона im.pl.ua):
#       komora  CNAME  <tunnel>.cfargotunnel.com   Proxied
set -euo pipefail

CONFIG=/etc/cloudflared/config.yml
SERVICE=http://127.0.0.1:8093
HOST=${1:-komora.im.pl.ua}

[[ $EUID -eq 0 ]] || { echo "Потрібен sudo: sudo bash $0"; exit 1; }
[[ -f $CONFIG ]] || { echo "Немає $CONFIG"; exit 1; }

if grep -q "hostname: $HOST\$" "$CONFIG"; then
    echo "Маршрут $HOST уже в конфізі — пропускаю."
else
    BACKUP="$CONFIG.bak-$(date +%s)-$HOST"
    cp -a "$CONFIG" "$BACKUP"
    echo "Копія конфіга: $BACKUP"

    # вставляємо перед catch-all правилом http_status:404
    awk -v host="$HOST" -v svc="$SERVICE" '
        !done_ && /^[[:space:]]*-[[:space:]]*service:[[:space:]]*http_status:404/ {
            print "  - hostname: " host
            print "    service: " svc
            done_ = 1
        }
        { print }
        END { if (!done_) exit 3 }
    ' "$BACKUP" > "$CONFIG" || {
        cp -a "$BACKUP" "$CONFIG"
        echo "Не знайшов правило http_status:404 — конфіг не змінено."; exit 1
    }

    if ! cloudflared --config "$CONFIG" tunnel ingress validate; then
        cp -a "$BACKUP" "$CONFIG"
        echo "Конфіг не пройшов валідацію — відкотив."; exit 1
    fi

    systemctl restart cloudflared
    echo "Маршрут $HOST → $SERVICE додано, cloudflared перезапущено."
fi

echo
echo "Локальна перевірка:"
curl -sS -o /dev/null -w "  127.0.0.1:8093 → HTTP %{http_code}\n" http://127.0.0.1:8093/login || echo "  застосунок не відповідає"

echo
if getent hosts "$HOST" >/dev/null 2>&1; then
    echo "DNS для $HOST вже резолвиться."
else
    echo "⚠ DNS для $HOST ще немає. Створіть у Cloudflare (зона im.pl.ua):"
    echo "     komora  CNAME  <tunnel-id>.cfargotunnel.com   Proxied"
fi
