require('dotenv').config();
const { Bot, session, InlineKeyboard, Keyboard } = require('grammy');
const { createClient } = require('@supabase/supabase-js');

// =============================================
// CONFIG
// =============================================
const bot = new Bot(process.env.STAFF_BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const OWNER_ID = Number(process.env.OWNER_TELEGRAM_ID);

// =============================================
// SESSION
// =============================================
bot.use(session({
  initial: () => ({
    state: null,      // текущий шаг многоходовки
    data: {},         // временные данные
    employee: null,   // данные сотрудника из БД
    shift: null,      // текущая смена
  }),
}));

// =============================================
// КЛАВИАТУРЫ
// =============================================
const keyboards = {
  seller: new Keyboard()
    .text('📂 Открыть смену').text('📋 Поступившие заказы').row()
    .text('➕ Добавить продажу').text('💰 Пополнить ткоины').row()
    .text('↩️ Сделать возврат').text('📊 История сегодня').row()
    .text('💸 Доп траты').text('🎁 Товар себе').row()
    .text('📝 Задачи').text('🆘 SOS').row()
    .text('🔒 Закрыть смену')
    .resized(),

  editor: new Keyboard()
    .text('📦 Управление товарами').text('📋 Заявки на одобрение').row()
    .text('📊 Инвентарь').text('🔄 Перемещения').row()
    .text('📝 Задачи')
    .resized(),

  courier: new Keyboard()
    .text('🚗 Активные доставки').text('✅ Выполненные').row()
    .text('❌ Отменённые')
    .resized(),

  accountant: new Keyboard()
    .text('📊 Статистика продаж').text('💸 Удержания').row()
    .text('📈 Аналитика').text('📝 Отчёт за день')
    .resized(),

  owner: new Keyboard()
    .text('👥 Сотрудники').text('📊 Статистика').row()
    .text('💸 Удержания').text('📈 Аналитика').row()
    .text('📦 Товары').text('🏪 Точки').row()
    .text('📝 Задачи').text('➕ Добавить сотрудника')
    .resized(),
};

// =============================================
// ХЕЛПЕРЫ
// =============================================
async function getEmployee(telegramId) {
  const { data } = await supabase
    .from('сотрудники')
    .select('*, точки(название)')
    .eq('telegram_id', telegramId)
    .eq('активен', true)
    .single();
  return data;
}

async function getActiveShift(employeeId) {
  const { data } = await supabase
    .from('смены')
    .select('*')
    .eq('сотрудник_id', employeeId)
    .eq('статус', 'Открыта')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data;
}

async function getKeyboardForRole(role) {
  switch (role) {
    case 'Продавец': return keyboards.seller;
    case 'Курьер': return keyboards.courier;
    case 'Редактор': return keyboards.editor;
    case 'Бухгалтер': return keyboards.accountant;
    case 'Владелец': return keyboards.owner;
    default: return keyboards.seller;
  }
}

function today() {
  return new Date().toISOString().split('T')[0];
}

// =============================================
// /start — АВТОРИЗАЦИЯ
// =============================================
// /id — показать свой Telegram ID
bot.command('id', async (ctx) => {
  await ctx.reply(`Ваш Telegram ID: ${ctx.from.id}`);
});

bot.command('start', async (ctx) => {
  const telegramId = ctx.from.id;
  const emp = await getEmployee(telegramId);

  if (!emp) {
    // Проверяем — может это владелец хочет зарегистрироваться
    if (telegramId === OWNER_ID) {
      return ctx.reply(
        '👑 Вы владелец! Вас нет в базе.\n' +
        'Отправьте /register_owner чтобы добавить себя.'
      );
    }
    return ctx.reply(
      '⛔ Вы не зарегистрированы как сотрудник.\n' +
      'Обратитесь к руководству для добавления в систему.'
    );
  }

  ctx.session.employee = emp;
  ctx.session.state = null;
  ctx.session.data = {};

  // Проверяем активную смену для продавцов
  if (emp.роль === 'Продавец') {
    const shift = await getActiveShift(emp.id);
    ctx.session.shift = shift;
  }

  const kb = await getKeyboardForRole(emp.роль);
  const shiftStatus = ctx.session.shift ? '🟢 Смена открыта' : '⚪ Смена не открыта';
  const roleEmoji = { 'Продавец': '🏪', 'Курьер': '🚗', 'Редактор': '✏️', 'Бухгалтер': '📊', 'Владелец': '👑' };

  await ctx.reply(
    `${roleEmoji[emp.роль] || '👤'} Привет, ${emp.имя}!\n` +
    `Роль: ${emp.роль}\n` +
    `Точка: ${emp.точки?.название || 'Не назначена'}\n` +
    (emp.роль === 'Продавец' ? `${shiftStatus}\n` : '') +
    '\nВыберите действие:',
    { reply_markup: kb }
  );
});

// =============================================
// /register_owner — Самодобавление владельца
// =============================================
bot.command('register_owner', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) {
    return ctx.reply('⛔ Эта команда только для владельца.');
  }

  const existing = await getEmployee(ctx.from.id);
  if (existing) return ctx.reply('Вы уже в системе! Отправьте /start');

  const { data, error } = await supabase.from('сотрудники').insert({
    telegram_id: ctx.from.id,
    telegram_username: ctx.from.username ? `@${ctx.from.username}` : null,
    имя: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
    роль: 'Владелец',
    активен: true,
  }).select().single();

  if (error) return ctx.reply(`Ошибка: ${error.message}`);
  ctx.reply('✅ Вы добавлены как Владелец! Отправьте /start');
});

// =============================================
// MIDDLEWARE: проверка авторизации
// =============================================
bot.use(async (ctx, next) => {
  if (!ctx.session.employee && ctx.message?.text) {
    const emp = await getEmployee(ctx.from.id);
    if (!emp) return ctx.reply('⛔ Отправьте /start для авторизации');
    ctx.session.employee = emp;
    if (emp.роль === 'Продавец') {
      ctx.session.shift = await getActiveShift(emp.id);
    }
  }
  return next();
});

// =============================================
// 📂 ОТКРЫТЬ СМЕНУ
// =============================================
bot.hears('📂 Открыть смену', async (ctx) => {
  const emp = ctx.session.employee;
  if (emp.роль !== 'Продавец') return;

  if (ctx.session.shift) {
    return ctx.reply('⚠️ У вас уже открыта смена! Сначала закройте текущую.');
  }

  ctx.session.state = 'shift_open_cans';
  ctx.session.data = {};
  await ctx.reply('📂 Открытие смены\n\nСколько банок снюса на начало?', {
    reply_markup: { remove_keyboard: true }
  });
});

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'shift_open_cans',
  async (ctx) => {
    const num = parseInt(ctx.message.text);
    if (isNaN(num) || num < 0) return ctx.reply('Введите число банок:');
    ctx.session.data.банки = num;
    ctx.session.state = 'shift_open_soda';
    await ctx.reply('Сколько газировок на начало?');
  }
);

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'shift_open_soda',
  async (ctx) => {
    const num = parseInt(ctx.message.text);
    if (isNaN(num) || num < 0) return ctx.reply('Введите число газировок:');
    ctx.session.data.газировка = num;
    ctx.session.state = 'shift_open_cash';
    await ctx.reply('Сколько наличных в кассе?');
  }
);

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'shift_open_cash',
  async (ctx) => {
    const num = parseFloat(ctx.message.text);
    if (isNaN(num) || num < 0) return ctx.reply('Введите сумму наличных:');

    const emp = ctx.session.employee;
    const { data: shift, error } = await supabase.from('смены').insert({
      сотрудник_id: emp.id,
      точка_id: emp.точка_id,
      дата: today(),
      время_открытия: new Date().toISOString(),
      статус: 'Открыта',
      банки_начало: ctx.session.data.банки,
      газировка_начало: ctx.session.data.газировка,
      нал_начало: num,
    }).select().single();

    if (error) return ctx.reply(`❌ Ошибка: ${error.message}`);

    ctx.session.shift = shift;
    ctx.session.state = null;
    ctx.session.data = {};

    const kb = await getKeyboardForRole(emp.роль);
    await ctx.reply(
      `✅ Смена открыта!\n\n` +
      `📅 ${today()}\n` +
      `🏪 ${emp.точки?.название || ''}\n` +
      `📦 Банок: ${shift.банки_начало}\n` +
      `🥤 Газировок: ${shift.газировка_начало}\n` +
      `💵 Нал: ${num}₽\n` +
      `⏰ Время: ${new Date().toLocaleTimeString('ru-RU')}`,
      { reply_markup: kb }
    );
  }
);

// =============================================
// ➕ ДОБАВИТЬ ПРОДАЖУ
// =============================================
bot.hears('➕ Добавить продажу', async (ctx) => {
  if (!ctx.session.shift) {
    return ctx.reply('⚠️ Сначала откройте смену!');
  }

  ctx.session.state = 'sale_search';
  ctx.session.data = { items: [] };
  await ctx.reply(
    '🔍 Введите название товара (или часть):\n\n' +
    'Например: ARQA CLASSIC или Мята',
    { reply_markup: { remove_keyboard: true } }
  );
});

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'sale_search',
  async (ctx) => {
    const query = ctx.message.text.trim();

    const { data: products } = await supabase
      .from('товары')
      .select('id, название, цена_безнал, цена_нал')
      .ilike('название', `%${query}%`)
      .eq('активен', true)
      .limit(10);

    if (!products || products.length === 0) {
      return ctx.reply('❌ Ничего не найдено. Попробуйте другой запрос:');
    }

    const kb = new InlineKeyboard();
    products.forEach(p => {
      kb.text(`${p.название.substring(0, 35)}`, `sale_pick_${p.id}`).row();
    });
    kb.text('❌ Отмена', 'sale_cancel').row();

    await ctx.reply(`Найдено ${products.length} товаров:`, { reply_markup: kb });
  }
);

bot.callbackQuery(/^sale_pick_(\d+)$/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const { data: product } = await supabase
    .from('товары')
    .select('*')
    .eq('id', productId)
    .single();

  if (!product) return ctx.answerCallbackQuery('Товар не найден');

  ctx.session.data.currentProduct = product;
  ctx.session.state = 'sale_quantity';

  await ctx.editMessageText(
    `📦 ${product.название}\n` +
    `💳 Безнал: ${product.цена_безнал}₽\n` +
    `💵 Нал: ${product.цена_нал}₽\n\n` +
    `Введите количество:`
  );
  await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'sale_quantity',
  async (ctx) => {
    const qty = parseInt(ctx.message.text);
    if (isNaN(qty) || qty < 1) return ctx.reply('Введите число (минимум 1):');

    const product = ctx.session.data.currentProduct;
    ctx.session.data.currentQty = qty;
    ctx.session.state = 'sale_payment';

    const kb = new InlineKeyboard()
      .text(`💵 Нал (${product.цена_нал * qty}₽)`, 'sale_pay_cash')
      .text(`💳 Безнал (${product.цена_безнал * qty}₽)`, 'sale_pay_card');

    await ctx.reply(
      `${product.название} × ${qty}\n\nТип оплаты:`,
      { reply_markup: kb }
    );
  }
);

bot.callbackQuery(/^sale_pay_(cash|card)$/, async (ctx) => {
  const payType = ctx.match[1] === 'cash' ? 'Наличные' : 'Безналичные';
  const product = ctx.session.data.currentProduct;
  const qty = ctx.session.data.currentQty;
  const price = payType === 'Наличные' ? product.цена_нал : product.цена_безнал;
  const total = price * qty;

  ctx.session.data.items.push({
    product,
    qty,
    payType,
    price,
    total,
  });

  const kb = new InlineKeyboard()
    .text('➕ Добавить ещё товар', 'sale_more')
    .text('✅ Оформить', 'sale_finish');

  let itemsList = ctx.session.data.items.map((item, i) =>
    `${i + 1}. ${item.product.название.substring(0, 30)} × ${item.qty} = ${item.total}₽ (${item.payType === 'Наличные' ? 'нал' : 'безнал'})`
  ).join('\n');

  const grandTotal = ctx.session.data.items.reduce((s, i) => s + i.total, 0);

  await ctx.editMessageText(
    `🛒 Корзина:\n${itemsList}\n\n💰 Итого: ${grandTotal}₽`,
    { reply_markup: kb }
  );
  await ctx.answerCallbackQuery();
});

bot.callbackQuery('sale_more', async (ctx) => {
  ctx.session.state = 'sale_search';
  await ctx.editMessageText('🔍 Введите название следующего товара:');
  await ctx.answerCallbackQuery();
});

bot.callbackQuery('sale_finish', async (ctx) => {
  const emp = ctx.session.employee;
  const shift = ctx.session.shift;
  const items = ctx.session.data.items;
  const grandTotal = items.reduce((s, i) => s + i.total, 0);
  const totalCash = items.filter(i => i.payType === 'Наличные').reduce((s, i) => s + i.total, 0);
  const totalCard = items.filter(i => i.payType === 'Безналичные').reduce((s, i) => s + i.total, 0);
  const totalCans = items.reduce((s, i) => s + i.qty, 0);

  // Создаём заказ
  const { data: order, error } = await supabase.from('заказы').insert({
    клиент_id: null, // продажа без клиента из Mini App
    точка_id: emp.точка_id,
    статус: 'Завершён',
    тип_доставки: 'Самовывоз',
    тип_оплаты: items.length === 1 ? items[0].payType : 'Смешанная',
    сумма_товаров: grandTotal,
    итоговая_сумма: grandTotal,
    сумма_безнал: totalCard,
    сумма_нал: totalCash,
    продавец_id: emp.id,
    товары_json: JSON.stringify(items.map(i => ({
      id: i.product.id,
      name: i.product.название,
      qty: i.qty,
      price: i.price,
    }))),
  }).select().single();

  if (error) {
    await ctx.answerCallbackQuery();
    return ctx.editMessageText(`❌ Ошибка: ${error.message}`);
  }

  // Позиции в заказе
  for (const item of items) {
    await supabase.from('позиции_в_заказах').insert({
      заказ_id: order.id,
      товар_id: item.product.id,
      количество: item.qty,
      цена_за_единицу: item.price,
      тип_оплаты: item.payType,
    });

    // Уменьшаем инвентарь
    const { data: inv } = await supabase
      .from('инвентарь')
      .select('id, количество')
      .eq('товар_id', item.product.id)
      .eq('точка_id', emp.точка_id)
      .single();

    if (inv) {
      await supabase.from('инвентарь')
        .update({ количество: inv.количество - item.qty, последнее_обновление: new Date().toISOString() })
        .eq('id', inv.id);
    }
  }

  // Обновляем смену
  await supabase.from('смены').update({
    банок_продано: (shift.банок_продано || 0) + totalCans,
    выручка_общая: (shift.выручка_общая || 0) + grandTotal,
    выручка_безнал: (shift.выручка_безнал || 0) + totalCard,
    выручка_нал: (shift.выручка_нал_факт || 0) + totalCash,
  }).eq('id', shift.id);

  // Обновляем локальную смену
  shift.банок_продано = (shift.банок_продано || 0) + totalCans;
  shift.выручка_общая = (shift.выручка_общая || 0) + grandTotal;

  ctx.session.state = null;
  ctx.session.data = {};

  const kb = await getKeyboardForRole(emp.роль);
  await ctx.editMessageText(
    `✅ Продажа оформлена! #${order.номер_заказа}\n\n` +
    items.map(i => `• ${i.product.название.substring(0, 30)} × ${i.qty}`).join('\n') +
    `\n\n💰 Итого: ${grandTotal}₽` +
    (totalCash > 0 ? `\n💵 Нал: ${totalCash}₽` : '') +
    (totalCard > 0 ? `\n💳 Безнал: ${totalCard}₽` : '') +
    `\n📦 Банок за смену: ${shift.банок_продано}`
  );
  await ctx.answerCallbackQuery('✅ Продажа записана');
});

bot.callbackQuery('sale_cancel', async (ctx) => {
  ctx.session.state = null;
  ctx.session.data = {};
  const kb = await getKeyboardForRole(ctx.session.employee.роль);
  await ctx.editMessageText('❌ Продажа отменена');
  await ctx.answerCallbackQuery();
});

// =============================================
// 💰 ПОПОЛНИТЬ ТКОИНЫ
// =============================================
bot.hears('💰 Пополнить ткоины', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.state = 'tcoins_phone';
  await ctx.reply('Введите Telegram ID или username клиента:', {
    reply_markup: { remove_keyboard: true }
  });
});

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'tcoins_phone',
  async (ctx) => {
    const input = ctx.message.text.trim();
    let client;

    if (input.startsWith('@')) {
      const { data } = await supabase.from('клиенты')
        .select('*').eq('telegram_username', input).single();
      client = data;
    } else {
      const { data } = await supabase.from('клиенты')
        .select('*').eq('telegram_id', parseInt(input)).single();
      client = data;
    }

    if (!client) return ctx.reply('❌ Клиент не найден. Введите ID или @username:');

    ctx.session.data.client = client;
    ctx.session.state = 'tcoins_amount';
    await ctx.reply(
      `👤 ${client.имя || 'Без имени'} (${client.telegram_username || client.telegram_id})\n` +
      `💎 Текущий баланс: ${client.баланс_ткоинов} ткоинов\n\n` +
      `Введите сумму пополнения:`
    );
  }
);

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'tcoins_amount',
  async (ctx) => {
    const amount = parseInt(ctx.message.text);
    if (isNaN(amount) || amount <= 0) return ctx.reply('Введите положительное число:');

    const client = ctx.session.data.client;
    const emp = ctx.session.employee;
    const newBalance = (client.баланс_ткоинов || 0) + amount;

    // Записываем транзакцию
    await supabase.from('транзакции_ткоинов').insert({
      клиент_id: client.id,
      тип: 'Пополнение',
      сумма: amount,
      баланс_до: client.баланс_ткоинов || 0,
      баланс_после: newBalance,
      причина: `Пополнение продавцом ${emp.имя}`,
      сотрудник_id: emp.id,
    });

    // Обновляем баланс
    await supabase.from('клиенты')
      .update({ баланс_ткоинов: newBalance })
      .eq('id', client.id);

    ctx.session.state = null;
    ctx.session.data = {};

    const kb = await getKeyboardForRole(emp.роль);
    await ctx.reply(
      `✅ Пополнено!\n\n` +
      `👤 ${client.имя || client.telegram_username}\n` +
      `➕ ${amount} ткоинов\n` +
      `💎 Новый баланс: ${newBalance}`,
      { reply_markup: kb }
    );
  }
);

// =============================================
// 📊 ИСТОРИЯ СЕГОДНЯ
// =============================================
bot.hears('📊 История сегодня', async (ctx) => {
  const emp = ctx.session.employee;

  const { data: orders } = await supabase
    .from('заказы')
    .select('*, позиции_в_заказах(количество, цена_за_единицу, товары(название))')
    .eq('продавец_id', emp.id)
    .gte('дата_создания', today() + 'T00:00:00')
    .order('дата_создания', { ascending: false });

  if (!orders || orders.length === 0) {
    return ctx.reply('📊 Сегодня продаж нет');
  }

  const totalSum = orders.reduce((s, o) => s + (o.итоговая_сумма || 0), 0);
  const totalCans = orders.reduce((s, o) =>
    s + (o.позиции_в_заказах || []).reduce((ss, p) => ss + (p.количество || 0), 0), 0
  );

  let text = `📊 Сегодня: ${orders.length} продаж\n`;
  text += `💰 Выручка: ${totalSum}₽\n`;
  text += `📦 Банок: ${totalCans}\n\n`;

  orders.slice(0, 10).forEach((o, i) => {
    const time = new Date(o.дата_создания).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    text += `${i + 1}. ${time} — ${o.итоговая_сумма}₽ (${o.тип_оплаты === 'Наличные' ? 'нал' : 'безнал'})\n`;
  });

  if (orders.length > 10) text += `\n...и ещё ${orders.length - 10}`;

  await ctx.reply(text);
});

// =============================================
// 🆘 SOS
// =============================================
bot.hears('🆘 SOS', async (ctx) => {
  const emp = ctx.session.employee;

  // Создаём SOS
  await supabase.from('sos_сигналы').insert({
    сотрудник_id: emp.id,
    точка_id: emp.точка_id,
    тип: 'Проверка',
    сообщение: `SOS от ${emp.имя} (${emp.точки?.название || 'Без точки'})`,
  });

  // Уведомляем владельца
  if (OWNER_ID) {
    try {
      await bot.api.sendMessage(OWNER_ID,
        `🚨🚨🚨 SOS!\n\n` +
        `👤 ${emp.имя}\n` +
        `🏪 ${emp.точки?.название || '???'}\n` +
        `⏰ ${new Date().toLocaleTimeString('ru-RU')}\n\n` +
        `ВОЗМОЖНА ПРОВЕРКА!`
      );
    } catch (e) { console.error('SOS notify error:', e); }
  }

  // Уведомляем всех редакторов и владельцев
  const { data: managers } = await supabase
    .from('сотрудники')
    .select('telegram_id')
    .in('роль', ['Редактор', 'Владелец'])
    .eq('активен', true);

  if (managers) {
    for (const m of managers) {
      if (m.telegram_id && m.telegram_id !== OWNER_ID) {
        try {
          await bot.api.sendMessage(m.telegram_id,
            `🚨 SOS от ${emp.имя} на ${emp.точки?.название || '???'}!`
          );
        } catch (e) { /* ignore */ }
      }
    }
  }

  await ctx.reply(
    '🚨 SOS ОТПРАВЛЕН!\n\n' +
    'Руководство уведомлено.\n' +
    'Действуйте по инструкции.'
  );
});

// =============================================
// 💸 ДОП ТРАТЫ
// =============================================
bot.hears('💸 Доп траты', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.state = 'expense_desc';
  await ctx.reply('Опишите расход:', { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'expense_desc',
  async (ctx) => {
    ctx.session.data.expenseDesc = ctx.message.text;
    ctx.session.state = 'expense_amount';
    await ctx.reply('Сумма расхода (₽):');
  }
);

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'expense_amount',
  async (ctx) => {
    const amount = parseFloat(ctx.message.text);
    if (isNaN(amount) || amount <= 0) return ctx.reply('Введите сумму:');

    const emp = ctx.session.employee;
    const desc = ctx.session.data.expenseDesc;

    await supabase.from('расходы').insert({
      точка_id: emp.точка_id,
      категория: 'Доп траты',
      сумма: amount,
      описание: desc,
      сотрудник_id: emp.id,
      смена_id: ctx.session.shift?.id,
    });

    // Обновляем доп траты в смене
    if (ctx.session.shift) {
      await supabase.from('смены').update({
        доп_траты: (ctx.session.shift.доп_траты || 0) + amount,
      }).eq('id', ctx.session.shift.id);
    }

    ctx.session.state = null;
    ctx.session.data = {};

    const kb = await getKeyboardForRole(emp.роль);
    await ctx.reply(`✅ Расход записан: ${amount}₽ — ${desc}`, { reply_markup: kb });
  }
);

// =============================================
// 🎁 ТОВАР СЕБЕ
// =============================================
bot.hears('🎁 Товар себе', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.state = 'self_product';
  await ctx.reply('Какой товар взяли себе?', { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'self_product',
  async (ctx) => {
    const emp = ctx.session.employee;

    await supabase.from('смены').update({
      товар_себе: ctx.message.text,
    }).eq('id', ctx.session.shift.id);

    ctx.session.state = null;
    const kb = await getKeyboardForRole(emp.роль);
    await ctx.reply(`✅ Записано: ${ctx.message.text}`, { reply_markup: kb });
  }
);

// =============================================
// 📝 ЗАДАЧИ
// =============================================
bot.hears('📝 Задачи', async (ctx) => {
  const emp = ctx.session.employee;

  const { data: tasks } = await supabase
    .from('задачи')
    .select('*')
    .eq('исполнитель_id', emp.id)
    .in('статус', ['Новая', 'В работе'])
    .order('срок', { ascending: true });

  if (!tasks || tasks.length === 0) {
    return ctx.reply('✅ Нет активных задач!');
  }

  let text = `📝 Активные задачи (${tasks.length}):\n\n`;
  tasks.forEach((t, i) => {
    const deadline = t.срок ? new Date(t.срок).toLocaleDateString('ru-RU') : 'Без срока';
    const statusIcon = t.статус === 'Новая' ? '🆕' : '🔄';
    text += `${statusIcon} ${i + 1}. ${t.описание}\n   Срок: ${deadline}\n\n`;
  });

  await ctx.reply(text);
});

// =============================================
// 🔒 ЗАКРЫТЬ СМЕНУ
// =============================================
bot.hears('🔒 Закрыть смену', async (ctx) => {
  const emp = ctx.session.employee;
  if (!ctx.session.shift) return ctx.reply('⚠️ Смена не открыта!');

  ctx.session.state = 'shift_close_cans';
  await ctx.reply(
    '🔒 Закрытие смены\n\nСколько банок снюса на конец?',
    { reply_markup: { remove_keyboard: true } }
  );
});

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'shift_close_cans',
  async (ctx) => {
    const num = parseInt(ctx.message.text);
    if (isNaN(num) || num < 0) return ctx.reply('Введите число:');
    ctx.session.data.банки_конец = num;
    ctx.session.state = 'shift_close_soda';
    await ctx.reply('Сколько газировок на конец?');
  }
);

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'shift_close_soda',
  async (ctx) => {
    const num = parseInt(ctx.message.text);
    if (isNaN(num) || num < 0) return ctx.reply('Введите число:');
    ctx.session.data.газировка_конец = num;
    ctx.session.state = 'shift_close_cash';
    await ctx.reply('Сколько наличных в кассе?');
  }
);

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'shift_close_cash',
  async (ctx) => {
    const num = parseFloat(ctx.message.text);
    if (isNaN(num) || num < 0) return ctx.reply('Введите сумму:');
    ctx.session.data.нал_конец = num;
    ctx.session.state = 'shift_close_terminal';
    await ctx.reply('Сумма по терминалу за смену?');
  }
);

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'shift_close_terminal',
  async (ctx) => {
    const num = parseFloat(ctx.message.text);
    if (isNaN(num) || num < 0) return ctx.reply('Введите сумму:');
    ctx.session.data.терминал = num;
    ctx.session.state = 'shift_close_clean';

    const kb = new InlineKeyboard()
      .text('✅ Да', 'clean_yes')
      .text('❌ Нет', 'clean_no');
    await ctx.reply('Уборка выполнена?', { reply_markup: kb });
  }
);

bot.callbackQuery(/^clean_(yes|no)$/, async (ctx) => {
  const cleaned = ctx.match[1] === 'yes';
  const emp = ctx.session.employee;
  const shift = ctx.session.shift;
  const d = ctx.session.data;

  const банокПродано = (shift.банки_начало || 0) - d.банки_конец;
  const недостачаБанки = банокПродано - (shift.банок_продано || 0);
  const процентЗП = calcSalaryPercent(shift.банок_продано || 0);
  const зпЗаСмену = 2000 + ((shift.выручка_общая || 0) * процентЗП / 100);

  const { error } = await supabase.from('смены').update({
    время_закрытия: new Date().toISOString(),
    время_закрытия_факт: new Date().toISOString(),
    статус: 'Закрыта',
    банки_конец: d.банки_конец,
    газировка_конец: d.газировка_конец,
    нал_конец: d.нал_конец,
    терминал_сумма: d.терминал,
    уборка_выполнена: cleaned,
    недостача_банки: Math.max(0, недостачаБанки),
    банок_продано: shift.банок_продано || 0,
    процент_зп: процентЗП,
    зп_за_смену: Math.round(зпЗаСмену),
  }).eq('id', shift.id);

  if (error) {
    await ctx.answerCallbackQuery();
    return ctx.editMessageText(`❌ Ошибка: ${error.message}`);
  }

  ctx.session.shift = null;
  ctx.session.state = null;
  ctx.session.data = {};

  const kb = await getKeyboardForRole(emp.роль);

  let report = `🔒 Смена закрыта!\n\n`;
  report += `📅 ${today()}\n`;
  report += `📦 Банок продано: ${shift.банок_продано || 0}\n`;
  report += `💰 Выручка: ${shift.выручка_общая || 0}₽\n`;
  report += `💳 Безнал: ${shift.выручка_безнал || 0}₽\n`;
  report += `💵 Нал: ${d.нал_конец}₽\n`;
  report += `🏧 Терминал: ${d.терминал}₽\n`;
  if (недостачаБанки > 0) report += `⚠️ Недостача банок: ${недостачаБанки}\n`;
  report += `\n📊 ЗП за смену: ${Math.round(зпЗаСмену)}₽`;
  report += `\n  База: 2000₽ + ${процентЗП}% от выручки`;
  report += `\n🧹 Уборка: ${cleaned ? '✅' : '❌'}`;

  await ctx.editMessageText(report);

  // Уведомляем владельца
  if (OWNER_ID) {
    try {
      await bot.api.sendMessage(OWNER_ID,
        `📋 Отчёт за смену\n\n` +
        `👤 ${emp.имя} (${emp.точки?.название || ''})\n` + report
      );
    } catch (e) { /* ignore */ }
  }

  await ctx.answerCallbackQuery('Смена закрыта');
});

function calcSalaryPercent(cans) {
  if (cans >= 120) return 6.5;
  if (cans >= 110) return 6.0;
  if (cans >= 100) return 5.5;
  if (cans >= 90) return 5.0;
  if (cans >= 80) return 4.5;
  if (cans >= 70) return 4.0;
  if (cans >= 55) return 3.5;
  if (cans >= 40) return 2.5;
  return 0;
}

// =============================================
// 📋 ПОСТУПИВШИЕ ЗАКАЗЫ (из Mini App)
// =============================================
bot.hears('📋 Поступившие заказы', async (ctx) => {
  const emp = ctx.session.employee;

  const { data: orders } = await supabase
    .from('заказы')
    .select('*, клиенты(имя, telegram_username)')
    .eq('точка_id', emp.точка_id)
    .in('статус', ['Новый', 'Подтверждён', 'Готов'])
    .order('дата_создания', { ascending: true });

  if (!orders || orders.length === 0) {
    return ctx.reply('✅ Нет активных заказов');
  }

  for (const order of orders.slice(0, 5)) {
    const client = order.клиенты;
    const kb = new InlineKeyboard()
      .text('✅ Готов', `order_ready_${order.id}`)
      .text('🤝 Выдан', `order_done_${order.id}`)
      .row()
      .text('❌ Отменить', `order_cancel_${order.id}`);

    await ctx.reply(
      `📋 Заказ ${order.номер_заказа}\n` +
      `👤 ${client?.имя || 'Аноним'} ${client?.telegram_username || ''}\n` +
      `💰 ${order.итоговая_сумма}₽ (${order.тип_оплаты})\n` +
      `📦 ${order.тип_доставки}\n` +
      `⏰ ${new Date(order.дата_создания).toLocaleTimeString('ru-RU')}`,
      { reply_markup: kb }
    );
  }
});

bot.callbackQuery(/^order_(ready|done|cancel)_(\d+)$/, async (ctx) => {
  const action = ctx.match[1];
  const orderId = parseInt(ctx.match[2]);
  const statusMap = { ready: 'Готов', done: 'Завершён', cancel: 'Отменён' };
  const newStatus = statusMap[action];

  const update = { статус: newStatus };
  if (action === 'done') update.время_выдачи = new Date().toISOString();

  await supabase.from('заказы').update(update).eq('id', orderId);

  const emojiMap = { ready: '✅', done: '🤝', cancel: '❌' };
  await ctx.editMessageText(ctx.msg.text + `\n\n${emojiMap[action]} Статус: ${newStatus}`);
  await ctx.answerCallbackQuery(`Статус: ${newStatus}`);
});

// =============================================
// ↩️ ВОЗВРАТ
// =============================================
bot.hears('↩️ Сделать возврат', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.state = 'return_reason';
  ctx.session.data = {};
  await ctx.reply('Причина возврата:', { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'return_reason',
  async (ctx) => {
    ctx.session.data.reason = ctx.message.text;
    ctx.session.state = 'return_photo1';
    await ctx.reply('📷 Отправьте фото упаковки (1 из 3):');
  }
);

bot.on('message:photo').filter(
  (ctx) => ['return_photo1', 'return_photo2', 'return_photo3'].includes(ctx.session.state),
  async (ctx) => {
    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

    if (ctx.session.state === 'return_photo1') {
      ctx.session.data.photo1 = photoId;
      ctx.session.state = 'return_photo2';
      await ctx.reply('📷 Фото содержимого (2 из 3):');
    } else if (ctx.session.state === 'return_photo2') {
      ctx.session.data.photo2 = photoId;
      ctx.session.state = 'return_photo3';
      await ctx.reply('📷 Дополнительное фото (3 из 3):');
    } else {
      ctx.session.data.photo3 = photoId;

      const emp = ctx.session.employee;
      const { data: ret, error } = await supabase.from('возвраты').insert({
        причина: ctx.session.data.reason,
        фото_упаковки: ctx.session.data.photo1,
        фото_содержимого: ctx.session.data.photo2,
        фото_дополнительное: ctx.session.data.photo3,
        статус: 'На рассмотрении',
        продавец_id: emp.id,
      }).select().single();

      // Уведомляем редакторов
      const { data: editors } = await supabase
        .from('сотрудники')
        .select('telegram_id')
        .in('роль', ['Редактор', 'Владелец'])
        .eq('активен', true);

      if (editors) {
        for (const e of editors) {
          try {
            await bot.api.sendMessage(e.telegram_id,
              `↩️ Новый возврат!\n\n` +
              `👤 Продавец: ${emp.имя}\n` +
              `🏪 ${emp.точки?.название || ''}\n` +
              `📝 Причина: ${ctx.session.data.reason}\n\n` +
              `Проверьте фото и одобрите.`
            );
          } catch (err) { /* ignore */ }
        }
      }

      ctx.session.state = null;
      ctx.session.data = {};
      const kb = await getKeyboardForRole(emp.роль);
      await ctx.reply('✅ Возврат отправлен на рассмотрение редактору!', { reply_markup: kb });
    }
  }
);

// =============================================
// 👥 ДОБАВИТЬ СОТРУДНИКА (Владелец)
// =============================================
bot.hears('➕ Добавить сотрудника', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;
  ctx.session.state = 'add_emp_tg';
  await ctx.reply('Telegram ID нового сотрудника:', { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'add_emp_tg',
  async (ctx) => {
    const tgId = parseInt(ctx.message.text);
    if (isNaN(tgId)) return ctx.reply('Введите числовой Telegram ID:');
    ctx.session.data.newEmpTg = tgId;
    ctx.session.state = 'add_emp_name';
    await ctx.reply('Имя сотрудника:');
  }
);

bot.on('message:text').filter(
  (ctx) => ctx.session.state === 'add_emp_name',
  async (ctx) => {
    ctx.session.data.newEmpName = ctx.message.text;
    ctx.session.state = 'add_emp_role';

    const kb = new InlineKeyboard()
      .text('🏪 Продавец', 'role_Продавец')
      .text('🚗 Курьер', 'role_Курьер').row()
      .text('✏️ Редактор', 'role_Редактор')
      .text('📊 Бухгалтер', 'role_Бухгалтер');
    await ctx.reply('Роль:', { reply_markup: kb });
  }
);

bot.callbackQuery(/^role_(.+)$/, async (ctx) => {
  ctx.session.data.newEmpRole = ctx.match[1];
  ctx.session.state = 'add_emp_point';

  const { data: points } = await supabase.from('точки').select('id, название').eq('активна', true);
  const kb = new InlineKeyboard();
  (points || []).forEach(p => {
    kb.text(p.название, `point_${p.id}`).row();
  });
  kb.text('Без точки', 'point_0');

  await ctx.editMessageText(`Роль: ${ctx.match[1]}\nТочка:`);
  await ctx.reply('Выберите точку:', { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^point_(\d+)$/, async (ctx) => {
  const pointId = parseInt(ctx.match[1]) || null;
  const d = ctx.session.data;

  const { data: emp, error } = await supabase.from('сотрудники').insert({
    telegram_id: d.newEmpTg,
    имя: d.newEmpName,
    роль: d.newEmpRole,
    точка_id: pointId,
    активен: true,
    зп_база: 2000,
  }).select().single();

  if (error) {
    await ctx.answerCallbackQuery();
    return ctx.editMessageText(`❌ Ошибка: ${error.message}`);
  }

  ctx.session.state = null;
  ctx.session.data = {};

  const kb = await getKeyboardForRole(ctx.session.employee.роль);
  await ctx.editMessageText(
    `✅ Сотрудник добавлен!\n\n` +
    `👤 ${d.newEmpName}\n` +
    `🔑 Telegram ID: ${d.newEmpTg}\n` +
    `📋 Роль: ${d.newEmpRole}\n\n` +
    `Теперь этот человек может открыть бот и нажать /start`
  );
  await ctx.answerCallbackQuery('Добавлен!');
});

// =============================================
// 👥 СОТРУДНИКИ (просмотр — владелец)
// =============================================
bot.hears('👥 Сотрудники', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;

  const { data: emps } = await supabase
    .from('сотрудники')
    .select('*, точки(название)')
    .eq('активен', true)
    .order('роль');

  if (!emps || emps.length === 0) return ctx.reply('Нет сотрудников');

  let text = `👥 Сотрудники (${emps.length}):\n\n`;
  emps.forEach(e => {
    const roleEmoji = { 'Продавец': '🏪', 'Курьер': '🚗', 'Редактор': '✏️', 'Бухгалтер': '📊', 'Владелец': '👑' };
    text += `${roleEmoji[e.роль] || '👤'} ${e.имя} — ${e.роль}\n`;
    text += `   🏪 ${e.точки?.название || 'Без точки'} | TG: ${e.telegram_id}\n\n`;
  });

  await ctx.reply(text);
});

// =============================================
// FALLBACK — неизвестные текстовые сообщения
// =============================================
bot.on('message:text', async (ctx) => {
  // Если есть активный state — игнорируем (обработчик не сработал)
  if (ctx.session.state) {
    return ctx.reply('⚠️ Неверный ввод. Введите /start чтобы начать заново.');
  }
});

// =============================================
// ЗАПУСК
// =============================================
bot.catch((err) => {
  console.error('Bot error:', err);
});

bot.start({
  onStart: () => console.log('🤖 TTS Staff Bot запущен!'),
});
