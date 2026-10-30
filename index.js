const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

const users = new Map();
const carts = new Map();
const states = new Map();
const orders = new Map();

const products = {
  'Продукты': ['Молоко', 'Хлеб', 'Яйца', 'Сыр', 'Масло', 'Макароны', 'Рис', 'Крупа'],
  'Аптека': ['Лекарство (указать название)', 'Пластыри', 'Бинт', 'Витамины (указать название)'],
  'Напитки': ['Вода', 'Сок', 'Чай', 'Кофе'],
  'Бытовая химия': ['Средство для посуды', 'Порошок', 'Мыло', 'Средство для уборки'],
  'Овощи и фрукты': ['Картофель', 'Помидоры', 'Огурцы', 'Яблоки', 'Бананы'],
};

function menu() {
  return Markup.inlineKeyboard([
    ['Продукты', 'Аптека'],
    ['Напитки', 'Бытовая химия'],
    ['Овощи и фрукты', 'Свой товар'],
    ['🧺 Корзина']
  ].map(row => row.map(x => Markup.button.callback(x, x === '🧺 Корзина' ? 'cart' : 'cat:' + x))));
}

function role(id) {
  return users.get(id)?.role;
}

async function tellMother(order, message) {
  const mother = [...users.entries()].find(([, u]) => u.role === 'mother');
  if (mother) {
    await bot.telegram.sendMessage(mother[0], message);
  }
}

bot.start(async ctx => {
  await ctx.reply(
    'Привет! Это семейный помощник «Рядом» 🛍️\n\n' +
    'Для подключения введи команду:\n' +
    '/pair КОД\n\n' +
    'Код для мамы и курьера будет настроен отдельно.'
  );
});

bot.command('pair', async ctx => {
  const code = ctx.message.text.split(' ')[1];

  if (code && code === process.env.MOTHER_CODE) {
    users.set(ctx.chat.id, { role: 'mother' });
    carts.set(ctx.chat.id, {});
    return ctx.reply('Ты подключена как мама! ❤️\nВыбирай товары:', menu());
  }

  if (code && code === process.env.COURIER_CODE) {
    users.set(ctx.chat.id, { role: 'courier' });
    return ctx.reply('Ты подключён как курьер! 🚗\nЗдесь будут появляться заказы.');
  }

  return ctx.reply('Код не подошёл. Проверь его и попробуй ещё раз.');
});

bot.command('help', ctx => ctx.reply(
  'Команды:\n/start — запуск\n/pair КОД — подключение\n/cancel — отмена текущего действия\n/cart — корзина'
));

bot.command('cancel', ctx => {
  states.delete(ctx.chat.id);
  ctx.reply('Действие отменено.', menu());
});

bot.command('cart', async ctx => showCart(ctx));

function showCart(ctx) {
  const cart = carts.get(ctx.chat.id) || {};
  const entries = Object.entries(cart);

  if (!entries.length) {
    return ctx.reply('Корзина пока пустая 🧺', menu());
  }

  const text = entries.map(([name, qty]) => `• ${name} × ${qty}`).join('\n');

  return ctx.reply(
    '🧺 Твоя корзина:\n\n' + text,
    Markup.inlineKeyboard([
      [Markup.button.callback('➕ Добавить товары', 'back')],
      [Markup.button.callback('🗑 Очистить корзину', 'clear')],
      [Markup.button.callback('✅ Оформить заказ', 'checkout')]
    ])
  );
}

bot.action(/^cat:(.+)$/, async ctx => {
  await ctx.answerCbQuery();

  if (role(ctx.chat.id) !== 'mother') {
    return ctx.reply('Этот раздел доступен маме.');
  }

  const category = ctx.match[1];
  const list = products[category] || [];

  const buttons = list.map(name => [
    Markup.button.callback('➕ ' + name, 'add:' + name)
  ]);

  buttons.push([Markup.button.callback('⬅️ Назад', 'back')]);

  await ctx.reply('Выбери товар из раздела «' + category + '»:', Markup.inlineKeyboard(buttons));
});

bot.action(/^add:(.+)$/, async ctx => {
  await ctx.answerCbQuery('Добавлено!');

  if (role(ctx.chat.id) !== 'mother') return;

  const name = ctx.match[1];
  const cart = carts.get(ctx.chat.id) || {};

  cart[name] = (cart[name] || 0) + 1;
  carts.set(ctx.chat.id, cart);

  await ctx.reply(name + ' добавлено. Количество: ' + cart[name], menu());
});

bot.action('back', async ctx => {
  await ctx.answerCbQuery();
  await ctx.reply('Выбирай следующий раздел:', menu());
});

bot.action('cart', async ctx => {
  await ctx.answerCbQuery();
  await showCart(ctx);
});

bot.action('clear', async ctx => {
  await ctx.answerCbQuery();
  carts.set(ctx.chat.id, {});
  await ctx.reply('Корзина очищена.', menu());
});

bot.action('checkout', async ctx => {
  await ctx.answerCbQuery();

  if (role(ctx.chat.id) !== 'mother') return;

  const cart = carts.get(ctx.chat.id) || {};
  if (!Object.keys(cart).length) return ctx.reply('Сначала добавь товары.');

  states.set(ctx.chat.id, { step: 'store', data: {} });
  await ctx.reply('🏪 Напиши название магазина или аптеки:');
});

bot.on('text', async ctx => {
  const id = ctx.chat.id;
  const state = states.get(id);

  if (!state) {
    if (role(id) === 'mother') {
      return ctx.reply('Выбирай товары в меню:', menu());
    }
    return;
  }

  const value = ctx.message.text.trim();
  if (value.startsWith('/')) return;

  if (state.step === 'custom') {
    const cart = carts.get(id) || {};
    cart[value] = (cart[value] || 0) + 1;
    carts.set(id, cart);
    states.delete(id);
    return ctx.reply('Добавлено: ' + value, menu());
  }

  if (state.step === 'store') {
    state.data.store = value;
    state.step = 'address';
    return ctx.reply('📍 Напиши адрес магазина или адрес доставки:');
  }

  if (state.step === 'address') {
    state.data.address = value;
    state.step = 'comment';
    return ctx.reply('💬 Комментарий к заказу? Если комментария нет, напиши «Нет».');
  }

  if (state.step === 'comment') {
    const cart = carts.get(id) || {};
    const mother = users.get(id);

    const order = {
      id: Date.now().toString(),
      items: { ...cart },
      store: state.data.store,
      address: state.data.address,
      comment: value,
      motherId: id,
      status: 'Новый заказ'
    };

    orders.set(order.id, order);
    carts.set(id, {});
    states.delete(id);

    const courier = [...users.entries()].find(([, u]) => u.role === 'courier');

    if (!courier) {
      return ctx.reply('Заказ сохранён, но курьер ещё не подключён. Сообщи ему, чтобы он ввёл свой код /pair.');
    }

    const list = Object.entries(order.items)
      .map(([name, qty]) => `• ${name} × ${qty}`).join('\n');

    await bot.telegram.sendMessage(
      courier[0],
      `🛍️ НОВЫЙ ЗАКАЗ №${order.id}\n\n${list}\n\n🏪 Магазин: ${order.store}\n📍 Адрес: ${order.address}\n💬 Комментарий: ${order.comment}`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Принять', 'accept:' + order.id)],
        [Markup.button.callback('❌ Отклонить', 'reject:' + order.id)]
      ])
    );

    return ctx.reply('✅ Заказ отправлен курьеру! Я сообщу, когда он его примет.');
  }
});

bot.action(/^accept:(.+)$/, async ctx => {
  const order = orders.get(ctx.match[1]);
  if (!order || role(ctx.chat.id) !== 'courier') return ctx.answerCbQuery('Заказ не найден.');

  order.status = 'Заказ принят';
  await ctx.answerCbQuery('Заказ принят!');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  await tellMother(order, '✅ Курьер принял заказ №' + order.id);

  await ctx.reply('Выбирай следующий этап:', Markup.inlineKeyboard([
    [Markup.button.callback('🛒 Еду за покупками', 'status:' + order.id + ':Еду за покупками')],
    [Markup.button.callback('📦 Покупки собраны', 'status:' + order.id + ':Покупки собраны')],
    [Markup.button.callback('🚗 В пути', 'status:' + order.id + ':В пути')],
    [Markup.button.callback('🏁 Доставлено', 'status:' + order.id + ':Доставлено')]
  ]));
});

bot.action(/^reject:(.+)$/, async ctx => {
  const order = orders.get(ctx.match[1]);
  if (!order || role(ctx.chat.id) !== 'courier') return ctx.answerCbQuery('Заказ не найден.');

  await ctx.answerCbQuery('Заказ отклонён');
  await tellMother(order, '❌ Курьер отклонил заказ №' + order.id);
  orders.delete(order.id);
  await ctx.reply('Заказ отклонён.');
});

bot.action(/^status:(.+):(.+)$/, async ctx => {
  const order = orders.get(ctx.match[1]);
  if (!order || role(ctx.chat.id) !== 'courier') return ctx.answerCbQuery('Заказ не найден.');

  order.status = ctx.match[2];
  await ctx.answerCbQuery('Статус обновлён');
  await tellMother(order, '📦 Заказ №' + order.id + '\nНовый статус: ' + order.status);

  if (order.status === 'Доставлено') {
    await ctx.reply('🎉 Заказ доставлен!');
    orders.delete(order.id);
  }
});

bot.catch((err, ctx) => {
  console.error('Ошибка бота:', err);
});

bot.launch().then(() => console.log('Рядом запущен!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
