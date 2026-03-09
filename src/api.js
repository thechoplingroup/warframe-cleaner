const WFM_BASE = '/api/wfm/v2';

let itemsCache = null;

export async function fetchAllItems() {
  if (itemsCache) return itemsCache;

  const res = await fetch(`${WFM_BASE}/items`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Failed to fetch items: ${res.status}`);
  const json = await res.json();
  itemsCache = json.data.map((item) => ({
    id: item.id,
    slug: item.slug,
    name: item.i18n?.en?.name || item.slug,
    ducats: item.ducats || 0,
    tags: item.tags || [],
    icon: item.i18n?.en?.thumb
      ? `https://warframe.market/static/assets/${item.i18n.en.thumb}`
      : null,
  }));
  return itemsCache;
}

export async function fetchOrders(slug) {
  const res = await fetch(`${WFM_BASE}/orders/item/${slug}`, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'WarframeCleaner/1.0',
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch orders for ${slug}: ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

export function getTopOrders(orders, type = 'sell', count = 5) {
  const filtered = orders
    .filter(
      (o) =>
        o.type === type &&
        o.visible &&
        o.user?.status !== 'offline' &&
        o.user?.platform === 'pc'
    )
    .sort((a, b) =>
      type === 'sell' ? a.platinum - b.platinum : b.platinum - a.platinum
    );

  // If not enough online, include offline sellers too
  if (filtered.length < count) {
    const offline = orders
      .filter((o) => o.type === type && o.visible && o.user?.platform === 'pc')
      .sort((a, b) =>
        type === 'sell' ? a.platinum - b.platinum : b.platinum - a.platinum
      );
    return offline.slice(0, count);
  }

  return filtered.slice(0, count);
}

export function getMedianPrice(orders) {
  if (!orders.length) return 0;
  const prices = orders.map((o) => o.platinum).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
}

export function getRecommendation(platValue, ducatValue) {
  if (platValue >= 20) return { label: 'Sell for Plat 💰', priority: 0, type: 'sell' };
  if (ducatValue >= 45) return { label: 'Ducat worthy ⭐', priority: 1, type: 'ducat' };
  return { label: 'Junk / Delete 🗑️', priority: 2, type: 'junk' };
}
