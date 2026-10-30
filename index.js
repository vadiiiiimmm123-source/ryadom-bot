
const { Telegraf, Markup } = require('telegraf');
const http = require('http');

const TOKEN = process.env.BOT_TOKEN;
const MOTHER_CODE = process.env.MOTHER_CODE;
const COURIER_CODE = process.env.COURIER_CODE;
const BASE_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;

if (!TOKEN || !MOTHER_CODE || !COURIER_CODE) {
  throw new Error('Добавь BOT_TOKEN, MOTHER_CODE и COURIER_CODE в Environment Variables');
}

const bot = new Telegraf(TOKEN);

const roles = new Map();
const carts = new Map();
const states = new Map();
const orders = new Map();

let nextOrderId = 1;

const catalog = {
  'Продукты': ['Молоко', 'Хлеб', 'Яйца', 'Сыр', 'Масло', 'Макароны'],
  'Аптека': ['Лекарство по запросу', 'Пластыри', 'Бинт'],
  'Напитки': ['Вода', 'Сок', 'Чай', 'Кофе'],
  'Бытовая химия': ['Порошок', 'Средство для посуды', 'Мыло'],
  'Овощи и фрукты': ['Картофель', 'Помидоры', 'Огурцы', 'Яблоки', 'Бананы']
};

const statuses = [
  'Новый заказ',
  'Заказ принят',
  'Еду за покупками',
  'Покупки собраны',
  'В пути',
  'Доставлено'
];

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🛍 Каталог', 'catalog')],
    [Markup.button.callback('🧺 Корзина', 'cart')],
    [Markup.button.callback('📦 Мои заказы', 'orders')],
    [Markup.button.callback('ℹ️ Помощь', 'help')]
  ]);
}

function categoryMenu() {
  const buttons = Object.keys(catalog).map(name =>
    [Markup.button.callback(name, 'cat:' + name)]
  );
  buttons.push([Markup.button.callback('✏️ Свой товар', 'custom')]);
  buttons.push([Markup.button.callback('⬅️ В меню', 'home')]);
  return Markup.inlineKeyboard(buttons);
}

function cartOf(id) {
  if (!carts.has(id)) carts.set(id, []);
  return carts.get(id);
}

function escapeText(value) {
  return String(value).replace(/[<>&]/g, '');
}

async function sendToMothers(message) {
  for (const [id, role] of roles) {
    if (role === 'mother') {
      await bot.telegram.sendMessage(id, message).catch(() => {});
    }
  }
}

bot.start(async ctx => {
  await ctx.reply(
    'Привет! Это семейный бот «Рядом» 🛍️\n\n' +
    'Чтобы подключиться, введи код:\n/pair ТВОЙ_КОД'
  );
});

bot.command('pair', async ctx => {
  const code = ctx.message.text.split(' ')[1];

  if (code === MOTHER_CODE) {
    roles.set(ctx.from.id, 'mother');
    return ctx.reply('👩 Ты подключена как мама!', mainMenu());
  }

  if (code === COURIER_CODE) {
    roles.set(ctx.from.id, 'courier');
    return ctx.reply('🚗 Ты подключён как курьер!', mainMenu());
  }

  return ctx.reply('❌ Неверный код. Проверь его и попробуй ещё раз.');
});

bot.command('help', ctx => ctx.reply(
  'Бот «Рядом» помогает создавать семейные списки покупок.\n\n' +
  'Команды:\n/start — начало\n/catalog — каталог\n/cart — корзина\n/orders — заказы\n/pair КОД — подключение'
));

bot.command('catalog', ctx => {
  if (roles.get(ctx.from.id) !== 'mother') {
    return ctx.reply('Каталог доступен после подключения мамы.');
  }
  return ctx.reply('Выбери категорию:', categoryMenu());
});

bot.command('cart', ctx => showCart(ctx));

bot.command('orders', ctx => showOrders(ctx));

bot.action('home', async ctx => {
  await ctx.answerCbQuery();
  await ctx.reply('Главное меню:', mainMenu());
});

bot.action('help', async ctx => {
  await ctx.answerCbQuery();
  await ctx.reply('Если ты мама — добавь покупки в корзину и оформи заказ. Курьер получит его в Telegram.');
});

bot.action('catalog', async ctx => {
  await ctx.answerCbQuery();
  if (roles.get(ctx.from.id) !== 'mother') {
    return ctx.reply('Эта функция доступна маме.');
  }
  await ctx.reply('Выбери категорию:', categoryMenu());
});

bot.action(/^cat:(.+)$/, async ctx => {
  await ctx.answerCbQuery();
  if (roles.get(ctx.from.id) !== 'mother') return;

  const category = ctx.match[1];
  const products = catalog[category] || [];

  const buttons = products.map((name, i) => [
    Markup.button.callback('➕ ' + name, 'add:' + category + ':' + i)
  ]);
  buttons.push([Markup.button.callback('⬅️ Категории', 'catalog')]);

  await ctx.reply('Категория: ' + category, Markup.inlineKeyboard(buttons));
});

bot.action(/^add:(.+):(\d+)$/, async ctx => {
  await ctx.answerCbQuery('Добавлено!');
  if (roles.get(ctx.from.id) !== 'mother') return;

  const category = ctx.match[1];
  const name = catalog[category]?.[Number(ctx.match[2])];
  if (!name) return;

  const cart = cartOf(ctx.from.id);
  const item = cart.find(x => x.name === name);
  if (item) item.qty++;
  else cart.push({ name, qty: 1 });

  await ctx.reply('✅ ' + name + ' добавлено. Количество: ' +
    cart.find(x => x.name === name).qty);
});

bot.action('custom', async ctx => {
  await ctx.answerCbQuery();
  if (roles.get(ctx.from.id) !== 'mother') return;
  states.set(ctx.from.id, { step: 'custom' });
  await ctx.reply('Напиши название товара и количество, например:\n' +
    'Йогурт, 2 штуки');
});

bot.action('cart', async ctx => {
  await ctx.answerCbQuery();
  await showCart(ctx);
});

async function showCart(ctx) {
  if (roles.get(ctx.from.id) !== 'mother') {
    return ctx.reply('Корзина доступна маме.');
  }

  const cart = cartOf(ctx.from.id);
  if (!cart.length) return ctx.reply('🧺 Корзина пока пустая.');

  const text = cart.map((x, i) =>
    `${i + 1}. ${escapeText(x.name)} — ${x.qty} шт.`
  ).join('\n');

  const buttons = cart.map((x, i) => [
    Markup.button.callback('➖ ' + x.name, 'minus:' + i),
    Markup.button.callback('➕', 'plus:' + i),
    Markup.button.callback('🗑', 'remove:' + i)
  ]);

  buttons.push([Markup.button.callback('🛍 Продолжить покупки', 'catalog')]);
  buttons.push([Markup.button.callback('✅ Оформить заказ', 'checkout')]);

  await ctx.reply('🧺 Твоя корзина:\n\n' + text, Markup.inlineKeyboard(buttons));
}

bot.action(/^(plus|minus|remove):(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  if (roles.get(ctx.from.id) !== 'mother') return;

  const cart = cartOf(ctx.from.id);
  const index = Number(ctx.match[2]);
  const action = ctx.match[1];

  if (!cart[index]) return;

  if (action === 'plus') cart[index].qty++;
  if (action === 'minus') cart[index].qty--;
  if (action === 'remove' || cart[index].qty <= 0) cart.splice(index, 1);

  await showCart(ctx);
});

bot.action('checkout', async ctx => {
  await ctx.answerCbQuery();
  if (roles.get(ctx.from.id) !== 'mother') return;

  const cart = cartOf(ctx.from.id);
  if (!cart.length) return ctx.reply('Сначала добавь товары.');

  states.set(ctx.from.id, {
    step: 'store',
    items: cart.map(x => ({ ...x }))
  });

  await ctx.reply('🏪 Напиши магазин или аптеку, где купить товары.');
});

bot.on('text', async ctx => {
  const id = ctx.from.id;
  const state = states.get(id);
  if (!state) return;

  const value = ctx.message.text.trim();

  if (state.step === 'custom') {
    const parts = value.split(',');
    const name = parts[0].trim();
    const qty = Math.max(1, parseInt(parts[1]) || 1);

    if (!name) return ctx.reply('Напиши название товара.');

    const cart = cartOf(id);
    const existing = cart.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (existing) existing.qty += qty;
    else cart.push({ name, qty });

    states.delete(id);
    return ctx.reply('✅ Добавлено: ' + name + ' — ' + qty + ' шт.', mainMenu());
  }

  if (state.step === 'store') {
    state.store = value;
    state.step = 'address';
    return ctx.reply('📍 Теперь напиши адрес доставки.');
  }

  if (state.step === 'address') {
    state.address = value;
    state.step = 'comment';
    return ctx.reply('💬 Напиши комментарий к заказу или отправь точку: — если комментария нет.');
  }

  if (state.step === 'comment') {
    state.comment = value === '—' ? '' : value;

    const order = {
      id: nextOrderId++,
      motherId: id,
      items: state.items,
      store: state.store,
      address: state.address,
      comment: state.comment,
      status: 0,
      created: new Date().toLocaleString('ru-RU')
    };

    orders.set(order.id, order);
    carts.set(id, []);
    states.delete(id);

    await ctx.reply('✅ Заказ №' + order.id + ' создан! Курьер получит его.', mainMenu());

    const message =
      `🛍 НОВЫЙ ЗАКАЗ №${order.id}\n\n` +
      `🏪 Магазин: ${escapeText(order.store)}\n` +
      `📍 Адрес доставки: ${escapeText(order.address)}\n\n` +
      order.items.map(x => `• ${escapeText(x.name)} — ${x.qty} шт.`).join('\n') +
      (order.comment ? `\n\n💬 Комментарий: ${escapeText(order.comment)}` : '') +
      `\n\nСтатус: ${statuses[0]}`;

    let sent = false;
    for (const [courierId, role] of roles) {
      if (role === 'courier') {
        await bot.telegram.sendMessage(courierId, message, Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ Принять', 'accept:' + order.id),
            Markup.button.callback('❌ Отклонить', 'reject:' + order.id)
          ]
        ])).then(() => { sent = true; }).catch(() => {});
      }
    }

    if (!sent) {
      await ctx.reply('⚠️ Курьер ещё не подключён. Заказ сохранён до перезапуска бота.');
    }
  }
});

bot.action(/^accept:(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  if (roles.get(ctx.from.id) !== 'courier') return;

  const order = orders.get(Number(ctx.match[1]));
  if (!order) return ctx.reply('Заказ не найден.');

  order.status = 1;
  await ctx.reply('✅ Заказ принят!');
  await bot.telegram.sendMessage(order.motherId, '✅ Курьер принял заказ №' + order.id);
});

bot.action(/^reject:(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  if (roles.get(ctx.from.id) !== 'courier') return;

  const order = orders.get(Number(ctx.match[1]));
  if (!order) return;

  await bot.telegram.sendMessage(order.motherId, '❌ Курьер отклонил заказ №' + order.id);
  await ctx.reply('Заказ отклонён.');
});

bot.action(/^status:(\d+)$/, async ctx => {
  await ctx.answerCbQuery();
  if (roles.get(ctx.from.id) !== 'courier') return;

  const order = orders.get(Number(ctx.match[1]));
  if (!order) return;

  order.status = Math.min(order.status + 1, statuses.length - 1);
  await bot.telegram.sendMessage(order.motherId,
    `📦 Заказ №${order.id}: ${statuses[order.status]}`);
  await ctx.reply('Статус обновлён: ' + statuses[order.status]);
});

async function showOrders(ctx) {
  const role = roles.get(ctx.from.id);
  if (!role) return ctx.reply('Сначала подключись командой /pair КОД.');

  const list = [...orders.values()].filter(o =>
    role === 'mother' ? o.motherId === ctx.from.id : true
  );

  if (!list.length) return ctx.reply('Пока заказов нет.');

  for (const order of list) {
    const text =
      `📦 Заказ №${order.id}\n` +
      `Статус: ${statuses[order.status]}\n` +
      `Магазин: ${escapeText(order.store)}\n` +
      `Адрес: ${escapeText(order.address)}\n\n` +
      order.items.map(x => `${escapeText(x.name)} — ${x.qty} шт.`).join('\n');

    if (role === 'courier') {
      await ctx.reply(text, Markup.inlineKeyboard([
        [Markup.button.callback('➡️ Следующий статус', 'status:' + order.id)]
      ]));
    } else {
      await ctx.reply(text);
    }
  }
}

if (!BASE_URL) {
  throw new Error('Render не передал RENDER_EXTERNAL_URL');
}

const webhookSecret = (process.env.WEBHOOK_SECRET || TOKEN.slice(0, 32))
  .replace(/[^A-Za-z0-9_-]/g, 'x');
const webhookPath = '/telegram-webhook';
const webhookHandler = bot.webhookCallback(webhookPath, {
  secretToken: webhookSecret
});

const server = http.createServer((req, res) => {
  if (req.url === webhookPath && req.method === 'POST') {
    return webhookHandler(req, res);
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Ryadom bot is running');
});

server.listen(PORT, '0.0.0.0', async () => {
  try {
    await bot.telegram.setWebhook(BASE_URL + webhookPath, {
      secret_token: webhookSecret
    });
    console.log('Рядом запущен. Webhook установлен.');
  } catch (error) {
    console.error('Ошибка установки webhook:', error);
  }
});
