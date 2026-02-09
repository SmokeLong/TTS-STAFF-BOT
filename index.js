require('dotenv').config();
const { Bot, session, InlineKeyboard, Keyboard } = require('grammy');
const { createClient } = require('@supabase/supabase-js');

const bot = new Bot(process.env.STAFF_BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const OWNER_ID = Number(process.env.OWNER_TELEGRAM_ID);

// =============================================
// SESSION
// =============================================
bot.use(session({
  initial: () => ({ state: null, data: {}, employee: null, shift: null }),
}));

// =============================================
// КЛАВИАТУРЫ
// =============================================
function sellerKB(hasShift) {
  if (!hasShift) {
    return new Keyboard()
      .text('📂 Открыть смену').row()
      .text('📋 Завершённые').text('📝 Задачи')
      .resized();
  }
  return new Keyboard()
    .text('➕ Продажа').text('📋 Заказы').row()
    .text('💰 Ткоины').text('↩️ Возврат').row()
    .text('💸 Расход').text('🎁 Себе').row()
    .text('📊 Сегодня').text('📋 Завершённые').row()
    .text('💼 Инкассация').text('🆘 SOS').row()
    .text('📝 Задачи').text('🔒 Закрыть смену')
    .resized();
}

function ownerKB(hasShift) {
  const kb = new Keyboard();
  if (!hasShift) {
    kb.text('📂 Открыть смену').row();
  } else {
    kb.text('➕ Продажа').text('📋 Заказы').row()
      .text('💰 Ткоины').text('↩️ Возврат').row()
      .text('💸 Расход').text('🎁 Себе').row()
      .text('💼 Инкассация').text('🔒 Закрыть смену').row();
  }
  kb.text('─── Управление ───').row()
    .text('📈 Топ продаж').text('📊 Статистика').row()
    .text('📋 Завершённые').text('📊 Сегодня').row()
    .text('👥 Сотрудники').text('➕👤 Сотрудник').row()
    .text('💸 Удержания').text('📦 Поступление').row()
    .text('🔄 Перемещение').text('📝 Задачи').row()
    .text('🆘 SOS')
    .resized();
  return kb;
}

function getKB(emp, shift) {
  if (emp.роль === 'Владелец') return ownerKB(!!shift);
  if (emp.роль === 'Редактор') return new Keyboard()
    .text('📦 Поступление').text('🔄 Перемещение').row()
    .text('📋 Заказы').text('📋 Завершённые').row()
    .text('📊 Сегодня').text('📝 Задачи').resized();
  if (emp.роль === 'Курьер') return new Keyboard()
    .text('🚗 Активные').text('✅ Выполненные').row().text('❌ Отменённые').resized();
  return sellerKB(!!shift);
}

function mainMenu(ctx) {
  return ctx.reply('🏠', { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
}

// =============================================
// ХЕЛПЕРЫ
// =============================================
async function getEmployee(tgId) {
  const { data } = await supabase.from('сотрудники').select('*, точки(название)')
    .eq('telegram_id', tgId).eq('активен', true).single();
  return data;
}
async function getActiveShift(empId) {
  const { data } = await supabase.from('смены').select('*')
    .eq('сотрудник_id', empId).eq('статус', 'Открыта')
    .order('created_at', { ascending: false }).limit(1).single();
  return data;
}
function today() { return new Date().toISOString().split('T')[0]; }
function now() { return new Date().toISOString(); }
function timeStr() { return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function isSeller(e) { return ['Продавец','Владелец'].includes(e?.роль); }
function isManager(e) { return ['Владелец','Редактор'].includes(e?.роль); }

function calcSalaryPercent(cans) {
  if (cans >= 120) return 6.5; if (cans >= 110) return 6; if (cans >= 100) return 5.5;
  if (cans >= 90) return 5; if (cans >= 80) return 4.5; if (cans >= 70) return 4;
  if (cans >= 55) return 3.5; if (cans >= 40) return 2.5; return 0;
}

// Скидочные карты: 100% = 400₽ макс
const DISCOUNT_CARDS = [
  { label: '🏷 10%', value: 10 },
  { label: '🏷 25%', value: 25 },
  { label: '🏷 50%', value: 50 },
  { label: '🏷 100% (макс 400₽)', value: 100, maxDiscount: 400 },
];

// =============================================
// /start, /id, /register_owner
// =============================================
bot.command('id', (ctx) => ctx.reply(`Ваш Telegram ID: \`${ctx.from.id}\``, { parse_mode: 'Markdown' }));

bot.command('start', async (ctx) => {
  const emp = await getEmployee(ctx.from.id);
  if (!emp) {
    if (ctx.from.id === OWNER_ID) return ctx.reply('👑 Отправьте /register_owner');
    return ctx.reply('⛔ Вы не зарегистрированы. Обратитесь к руководству.');
  }
  ctx.session.employee = emp; ctx.session.state = null; ctx.session.data = {};
  if (isSeller(emp)) ctx.session.shift = await getActiveShift(emp.id);

  const em = {'Продавец':'🏪','Курьер':'🚗','Редактор':'✏️','Бухгалтер':'📊','Владелец':'👑'};
  const sh = isSeller(emp) ? (ctx.session.shift ? '\n🟢 Смена открыта' : '\n⚪ Смена закрыта') : '';
  await ctx.reply(`${em[emp.роль]||'👤'} ${emp.имя}\n${emp.роль} • ${emp.точки?.название||'—'}${sh}`,
    { reply_markup: getKB(emp, ctx.session.shift) });
});

bot.command('register_owner', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return ctx.reply('⛔');
  const ex = await getEmployee(ctx.from.id);
  if (ex) return ctx.reply('Уже в системе! /start');
  await supabase.from('сотрудники').insert({
    telegram_id: ctx.from.id,
    telegram_username: ctx.from.username ? `@${ctx.from.username}` : null,
    имя: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ''),
    роль: 'Владелец', активен: true, зп_база: 0,
  });
  ctx.reply('✅ Владелец! /start');
});

// =============================================
// MIDDLEWARE
// =============================================
bot.use(async (ctx, next) => {
  if (!ctx.session.employee && (ctx.message?.text || ctx.callbackQuery)) {
    const emp = await getEmployee(ctx.from.id);
    if (!emp) { if (ctx.message?.text) return ctx.reply('⛔ /start'); return; }
    ctx.session.employee = emp;
    if (isSeller(emp)) ctx.session.shift = await getActiveShift(emp.id);
  }
  return next();
});

// =============================================
// 📂 ОТКРЫТЬ СМЕНУ
// =============================================
bot.hears('📂 Открыть смену', async (ctx) => {
  const emp = ctx.session.employee;
  if (!isSeller(emp)) return;
  if (ctx.session.shift) return ctx.reply('⚠️ Смена уже открыта!');
  if (!emp.точка_id) {
    const { data: pts } = await supabase.from('точки').select('id, название').eq('активна', true);
    const kb = new InlineKeyboard();
    (pts||[]).forEach(p => kb.text(`🏪 ${p.название}`, `shpt_${p.id}`).row());
    return ctx.reply('Выберите точку:', { reply_markup: kb });
  }
  ctx.session.state = 'sh_cans'; ctx.session.data = {};
  await ctx.reply('📂 Открытие смены\n\n📦 Банок снюса на начало?', { reply_markup: { remove_keyboard: true } });
});

bot.callbackQuery(/^shpt_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  const { data: pt } = await supabase.from('точки').select('название').eq('id', id).single();
  ctx.session.employee.точка_id = id; ctx.session.employee.точки = pt;
  ctx.session.state = 'sh_cans'; ctx.session.data = {};
  await ctx.editMessageText(`🏪 ${pt?.название}\n\n📦 Банок снюса на начало?`);
  await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'sh_cans', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('📦 Введите число:');
  ctx.session.data.cans = n; ctx.session.state = 'sh_soda';
  await ctx.reply('🥤 Газировок на начало?');
});
bot.on('message:text').filter(c => c.session.state === 'sh_soda', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('🥤 Число:');
  ctx.session.data.soda = n; ctx.session.state = 'sh_cash';
  await ctx.reply('💵 Наличных в кассе?');
});
bot.on('message:text').filter(c => c.session.state === 'sh_cash', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('💵 Сумма:');
  const emp = ctx.session.employee;
  const { data: shift, error } = await supabase.from('смены').insert({
    сотрудник_id: emp.id, точка_id: emp.точка_id, дата: today(),
    время_открытия: now(), статус: 'Открыта',
    банки_начало: ctx.session.data.cans, газировка_начало: ctx.session.data.soda, нал_начало: n,
  }).select().single();
  if (error) return ctx.reply(`❌ ${error.message}`);
  ctx.session.shift = shift; ctx.session.state = null; ctx.session.data = {};
  await ctx.reply(
    `✅ Смена открыта!\n\n📅 ${today()} ${timeStr()}\n🏪 ${emp.точки?.название||''}\n📦 ${shift.банки_начало} банок\n🥤 ${shift.газировка_начало} газ\n💵 ${n}₽`,
    { reply_markup: getKB(emp, shift) });
});

// =============================================
// ➕ ПРОДАЖА — Марка → Линейка → Вкус → Кол-во → Скидка → Клиент
// =============================================
bot.hears('➕ Продажа', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.data = { items: [] };
  await showBrands(ctx, 's');
});

async function showBrands(ctx, p) {
  const { data } = await supabase.from('товары').select('бренд').eq('активен', true);
  const brands = [...new Set((data||[]).map(x => x.бренд).filter(Boolean))].sort();
  ctx.session.data.brands = brands;
  const kb = new InlineKeyboard();
  brands.forEach((b) => { kb.text(`📦 ${b}`, `${p}b_${encodeURIComponent(b)}`).row(); });
  kb.text('❌ Отмена', `${p}_cx`);
  const title = p === 'ts' ? '🎁 Выберите марку:' : '🛒 Выберите марку:';
  if (ctx.callbackQuery) { try { await ctx.editMessageText(title, { reply_markup: kb }); } catch { await ctx.reply(title, { reply_markup: kb }); } await ctx.answerCallbackQuery(); }
  else await ctx.reply(title, { reply_markup: kb });
}

bot.callbackQuery(/^(s|ts)b_(.+)$/, async (ctx) => {
  const p = ctx.match[1];
  const brand = decodeURIComponent(ctx.match[2]);
  ctx.session.data.brand = brand;
  const { data } = await supabase.from('товары').select('линейка')
    .eq('бренд', brand).eq('активен', true);
  const lines = [...new Set((data||[]).map(x => x.линейка).filter(Boolean))].sort();
  ctx.session.data.lines = lines;
  const kb = new InlineKeyboard();
  lines.forEach(l => { kb.text(`📋 ${l}`, `${p}l_${encodeURIComponent(l)}`).row(); });
  kb.text('⬅️ Назад к маркам', `${p}_tobr`).row();
  kb.text('❌ Отмена', `${p}_cx`);
  await ctx.editMessageText(`📦 ${brand}\n\nВыберите линейку:`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^(s|ts)l_(.+)$/, async (ctx) => {
  const p = ctx.match[1];
  const line = decodeURIComponent(ctx.match[2]);
  ctx.session.data.line = line;
  await showFlavors(ctx, p);
});

async function showFlavors(ctx, p) {
  const { brand, line } = ctx.session.data;
  const { data: products } = await supabase.from('товары')
    .select('id, вкус, название, цена_безнал')
    .eq('бренд', brand).eq('линейка', line).eq('активен', true).order('вкус');
  ctx.session.data.flavors = products || [];
  const kb = new InlineKeyboard();
  (products||[]).forEach(pr => {
    const name = (pr.вкус || pr.название || '???').substring(0, 40);
    kb.text(`🔹 ${name} — ${pr.цена_безнал}₽`, `${p}f_${pr.id}`).row();
  });
  kb.text('⬅️ Линейки', `${p}_toln`).text('⬅️ Марки', `${p}_tobr`).row();
  kb.text('🏠 Меню', `${p}_mn`).text('❌ Отмена', `${p}_cx`);
  try { await ctx.editMessageText(`📦 ${brand} • ${line}\n\nВыберите вкус:`, { reply_markup: kb }); }
  catch { await ctx.reply(`📦 ${brand} • ${line}\n\nВыберите вкус:`, { reply_markup: kb }); }
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

bot.callbackQuery(/^(s|ts)f_(\d+)$/, async (ctx) => {
  const p = ctx.match[1];
  const id = parseInt(ctx.match[2]);
  const { data: product } = await supabase.from('товары').select('*').eq('id', id).single();
  if (!product) return ctx.answerCallbackQuery('Не найден');
  ctx.session.data.curProduct = product;

  if (p === 'ts') {
    // Товар себе
    const shift = ctx.session.shift;
    const val = shift?.товар_себе ? `${shift.товар_себе}, ${product.название}` : product.название;
    await supabase.from('смены').update({ товар_себе: val }).eq('id', shift.id);
    shift.товар_себе = val;
    const kb = new InlineKeyboard().text('🎁 Ещё', 'ts_tobr').text('🏠 Меню', 'ts_mn');
    await ctx.editMessageText(`✅ ${product.название}\n\nВсего себе: ${val}`, { reply_markup: kb });
    return ctx.answerCallbackQuery('Записано!');
  }

  // Продажа — количество
  const kb = new InlineKeyboard();
  for (let i = 1; i <= 5; i++) kb.text(`${i}`, `sq_${i}`);
  kb.row();
  for (let i = 6; i <= 10; i++) kb.text(`${i}`, `sq_${i}`);
  kb.row();
  kb.text('⬅️ Вкусы', `s_tofl`).text('⬅️ Марки', `s_tobr`).row();
  kb.text('❌ Отмена', `s_cx`);
  await ctx.editMessageText(
    `📦 ${product.название}\n💰 ${product.цена_безнал}₽\n\nКоличество:`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

// Количество → в корзину → обратно к вкусам
bot.callbackQuery(/^sq_(\d+)$/, async (ctx) => {
  const qty = parseInt(ctx.match[1]);
  const pr = ctx.session.data.curProduct;
  if (!pr) return ctx.answerCallbackQuery('Ошибка');
  const price = pr.цена_безнал;
  const total = price * qty;

  ctx.session.data.items.push({
    product: pr, qty, price, total,
    time: timeStr(),
  });

  await showCart(ctx);
  await ctx.answerCallbackQuery('✅ Добавлено!');
});

async function showCart(ctx) {
  const items = ctx.session.data.items;
  const sum = items.reduce((s, i) => s + i.total, 0);

  let cart = items.map((it, i) =>
    `${i+1}. ${(it.product.вкус||it.product.название).substring(0,30)} ×${it.qty} = ${it.total}₽ (${it.time})`
  ).join('\n');

  const kb = new InlineKeyboard()
    .text('➕ Ещё (эта линейка)', 's_tofl').row()
    .text('⬅️ Линейки', 's_toln').text('⬅️ Марки', 's_tobr').row()
    .text('✅ Оформить', 'sale_go').row()
    .text('🗑 Удалить последний', 'sale_dellast').row()
    .text('❌ Отменить заказ', 's_cx');

  try { await ctx.editMessageText(`🛒 Корзина:\n${cart}\n\n💰 Итого: ${sum}₽`, { reply_markup: kb }); }
  catch { await ctx.reply(`🛒 Корзина:\n${cart}\n\n💰 Итого: ${sum}₽`, { reply_markup: kb }); }
}

// Удалить последний товар из корзины
bot.callbackQuery('sale_dellast', async (ctx) => {
  if (ctx.session.data.items?.length) ctx.session.data.items.pop();
  if (!ctx.session.data.items?.length) {
    await ctx.editMessageText('🛒 Корзина пуста');
    await showBrands(ctx, 's');
  } else {
    await showCart(ctx);
  }
  await ctx.answerCallbackQuery('Удалено');
});

// =============================================
// ОФОРМЛЕНИЕ: скидочная карта → клиент → оплата
// =============================================
bot.callbackQuery('sale_go', async (ctx) => {
  // Спрашиваем про скидочную карту
  const kb = new InlineKeyboard()
    .text('🏷 10%', 'sdc_10').text('🏷 25%', 'sdc_25').row()
    .text('🏷 50%', 'sdc_50').text('🏷 100% (400₽)', 'sdc_100').row()
    .text('⏩ Без скидки', 'sdc_0');
  await ctx.editMessageText('🏷 Скидочная карта клиента?', { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^sdc_(\d+)$/, async (ctx) => {
  const discount = parseInt(ctx.match[1]);
  ctx.session.data.discountCard = discount;

  // Пересчитываем с учётом скидки
  if (discount > 0) {
    const items = ctx.session.data.items;
    const rawTotal = items.reduce((s, i) => s + i.total, 0);
    let discountAmount;
    if (discount === 100) {
      discountAmount = Math.min(400, rawTotal); // 100% = макс 400₽
    } else {
      discountAmount = Math.round(rawTotal * discount / 100);
    }
    ctx.session.data.discountAmount = discountAmount;
    const finalTotal = rawTotal - discountAmount;

    await ctx.editMessageText(
      `🏷 Скидка ${discount}%${discount===100?' (макс 400₽)':''}\n` +
      `💰 Было: ${rawTotal}₽\n🏷 Скидка: -${discountAmount}₽\n💰 Итого: ${finalTotal}₽\n\n` +
      `Тип оплаты:`,
      { reply_markup: new InlineKeyboard()
        .text(`💵 Нал ${finalTotal}₽`, 'spay_cash')
        .text(`💳 Безнал ${finalTotal}₽`, 'spay_card').row()
        .text('⬅️ Назад', 'sale_go') }
    );
  } else {
    ctx.session.data.discountAmount = 0;
    const total = ctx.session.data.items.reduce((s, i) => s + i.total, 0);
    await ctx.editMessageText(
      `💰 Итого: ${total}₽\n\nТип оплаты:`,
      { reply_markup: new InlineKeyboard()
        .text(`💵 Нал ${total}₽`, 'spay_cash')
        .text(`💳 Безнал ${total}₽`, 'spay_card').row()
        .text('⬅️ Назад', 'sale_go') }
    );
  }
  await ctx.answerCallbackQuery();
});

// Тип оплаты → клиент
bot.callbackQuery(/^spay_(cash|card)$/, async (ctx) => {
  ctx.session.data.payType = ctx.match[1] === 'cash' ? 'Наличные' : 'Безналичные';
  ctx.session.state = 'sale_client';
  const kb = new InlineKeyboard().text('⏩ Без клиента', 'sale_nocl');
  await ctx.editMessageText('👤 Код клиента (4 цифры + буква):', { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery('sale_nocl', async (ctx) => {
  ctx.session.data.client = null;
  await finishSale(ctx);
  await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'sale_client', async (ctx) => {
  const code = ctx.message.text.trim().toUpperCase();
  const { data: cl } = await supabase.from('клиенты').select('*').eq('уникальный_номер', code).single();
  if (!cl) {
    const kb = new InlineKeyboard().text('⏩ Без клиента', 'sale_nocl');
    return ctx.reply(`❌ "${code}" не найден.\nЕщё раз:`, { reply_markup: kb });
  }
  ctx.session.data.client = cl;
  await ctx.reply(`✅ ${cl.имя||code} | 💎 ${cl.баланс_ткоинов||0} тк`);
  await finishSale(ctx);
});

async function finishSale(ctx) {
  const emp = ctx.session.employee, shift = ctx.session.shift;
  const items = ctx.session.data.items, client = ctx.session.data.client;
  const payType = ctx.session.data.payType || 'Безналичные';
  const rawTotal = items.reduce((s, i) => s + i.total, 0);
  const discountAmt = ctx.session.data.discountAmount || 0;
  const discountCard = ctx.session.data.discountCard || 0;
  const grand = rawTotal - discountAmt;
  const cash = payType === 'Наличные' ? grand : 0;
  const card = payType === 'Безналичные' ? grand : 0;
  const cans = items.reduce((s, i) => s + i.qty, 0);

  const { data: order, error } = await supabase.from('заказы').insert({
    клиент_id: client?.id || null, точка_id: emp.точка_id, статус: 'Завершён',
    тип_доставки: 'Самовывоз', тип_оплаты: payType,
    сумма_товаров: rawTotal, скидка_сумма: discountAmt, итоговая_сумма: grand,
    сумма_безнал: card, сумма_нал: cash, продавец_id: emp.id,
    товары_json: JSON.stringify(items.map(i => ({ id: i.product.id, name: i.product.название, qty: i.qty, price: i.price, time: i.time }))),
    комментарий: discountCard ? `Скид.карта ${discountCard}%` : null,
  }).select().single();

  if (error) { ctx.session.state = null; return ctx.reply(`❌ ${error.message}`, { reply_markup: getKB(emp, shift) }); }

  for (const item of items) {
    await supabase.from('позиции_в_заказах').insert({
      заказ_id: order.id, товар_id: item.product.id, количество: item.qty,
      цена_за_единицу: item.price, тип_оплаты: payType,
    });
    const { data: inv } = await supabase.from('инвентарь').select('id, количество')
      .eq('товар_id', item.product.id).eq('точка_id', emp.точка_id).single();
    if (inv) await supabase.from('инвентарь')
      .update({ количество: Math.max(0, inv.количество - item.qty), последнее_обновление: now() }).eq('id', inv.id);
  }

  const nc = (shift.банок_продано||0) + cans;
  const nr = (shift.выручка_общая||0) + grand;
  await supabase.from('смены').update({
    банок_продано: nc, выручка_общая: nr,
    выручка_безнал: (shift.выручка_безнал||0) + card,
    выручка_нал_факт: (shift.выручка_нал_факт||0) + cash,
  }).eq('id', shift.id);
  shift.банок_продано = nc; shift.выручка_общая = nr;
  shift.выручка_безнал = (shift.выручка_безнал||0) + card;
  shift.выручка_нал_факт = (shift.выручка_нал_факт||0) + cash;

  // Ткоины за нал
  if (client && cash > 0) {
    const tc = Math.floor(cash);
    if (tc > 0) {
      const nb = (client.баланс_ткоинов||0) + tc;
      await supabase.from('клиенты').update({ баланс_ткоинов: nb }).eq('id', client.id);
      await supabase.from('транзакции_ткоинов').insert({
        клиент_id: client.id, тип: 'Начисление', сумма: tc,
        баланс_до: client.баланс_ткоинов||0, баланс_после: nb,
        причина: `Покупка ${order.номер_заказа}`, сотрудник_id: emp.id,
      });
    }
  }

  ctx.session.state = null; ctx.session.data = {};
  await ctx.reply(
    `✅ ${order.номер_заказа} | ⏰ ${timeStr()}\n\n` +
    items.map(i => `• ${i.product.название.substring(0,35)} ×${i.qty} = ${i.total}₽`).join('\n') +
    (discountAmt > 0 ? `\n\n🏷 Скидка ${discountCard}%: -${discountAmt}₽` : '') +
    `\n\n💰 ${grand}₽ ${payType === 'Наличные' ? '💵' : '💳'}` +
    (client ? `\n👤 ${client.имя||client.уникальный_номер}` : '') +
    `\n📦 За смену: ${nc} банок`,
    { reply_markup: getKB(emp, shift) });
}

// =============================================
// НАВИГАЦИЯ
// =============================================
bot.callbackQuery(/^(s|ts)_tobr$/, async (ctx) => { await showBrands(ctx, ctx.match[1]); });
bot.callbackQuery(/^(s|ts)_toln$/, async (ctx) => {
  const p = ctx.match[1]; const brand = ctx.session.data.brand;
  if (!brand) return showBrands(ctx, p);
  const { data } = await supabase.from('товары').select('линейка').eq('бренд', brand).eq('активен', true);
  const lines = [...new Set((data||[]).map(x => x.линейка).filter(Boolean))].sort();
  ctx.session.data.lines = lines;
  const kb = new InlineKeyboard();
  lines.forEach(l => { kb.text(`📋 ${l}`, `${p}l_${encodeURIComponent(l)}`).row(); });
  kb.text('⬅️ Марки', `${p}_tobr`).row().text('❌ Отмена', `${p}_cx`);
  await ctx.editMessageText(`📦 ${brand}\nЛинейка:`, { reply_markup: kb }); await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^(s|ts)_tofl$/, async (ctx) => {
  const p = ctx.match[1];
  if (!ctx.session.data.brand || !ctx.session.data.line) return showBrands(ctx, p);
  await showFlavors(ctx, p);
});
bot.callbackQuery(/^(s|ts)_mn$/, async (ctx) => {
  ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText('🏠 Меню'); await ctx.answerCallbackQuery();
  await mainMenu(ctx);
});
bot.callbackQuery(/^(s|ts)_cx$/, async (ctx) => {
  const p = ctx.match[1]; const items = ctx.session.data.items || [];
  if (!items.length) {
    ctx.session.state = null; ctx.session.data = {};
    await ctx.editMessageText('❌ Отменено'); return ctx.answerCallbackQuery();
  }
  const kb = new InlineKeyboard()
    .text('✅ Да, отменить', `${p}_cxy`).text('↩️ Нет', `${p}_tobr`);
  await ctx.editMessageText(`⚠️ В корзине ${items.length} товаров. Точно?`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^(s|ts)_cxy$/, async (ctx) => {
  ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText('❌ Отменено'); await ctx.answerCallbackQuery();
  await mainMenu(ctx);
});

// =============================================
// 🎁 СЕБЕ
// =============================================
bot.hears('🎁 Себе', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.data = { items: [] };
  await showBrands(ctx, 'ts');
});

// =============================================
// 📋 ЗАВЕРШЁННЫЕ ЗАКАЗЫ (с редактированием)
// =============================================
bot.hears('📋 Завершённые', async (ctx) => {
  const emp = ctx.session.employee;
  const filter = emp.точка_id && emp.роль !== 'Владелец' ? { точка_id: emp.точка_id } : {};

  const { data: orders } = await supabase.from('заказы')
    .select('*, точки(название)')
    .match(filter).eq('статус', 'Завершён')
    .gte('дата_создания', today()+'T00:00:00')
    .order('дата_создания', { ascending: false }).limit(20);

  if (!orders?.length) return ctx.reply('📋 Нет завершённых заказов за сегодня');

  for (const o of orders.slice(0, 10)) {
    const time = new Date(o.дата_создания).toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    let items = '';
    try { const j = JSON.parse(o.товары_json); items = j.map(i => `${i.name?.substring(0,25)||'?'} ×${i.qty}`).join(', '); } catch {}

    const kb = new InlineKeyboard()
      .text('✏️ Изменить', `oedit_${o.id}`).text('🗑 Удалить', `odel_${o.id}`);

    await ctx.reply(
      `📋 ${o.номер_заказа} | ${time}\n🏪 ${o.точки?.название||''}\n` +
      `${items}\n💰 ${o.итоговая_сумма}₽ ${o.тип_оплаты}` +
      (o.комментарий ? `\n📝 ${o.комментарий}` : ''),
      { reply_markup: kb });
  }
  if (orders.length > 10) await ctx.reply(`...и ещё ${orders.length - 10}`);
});

bot.callbackQuery(/^odel_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  const kb = new InlineKeyboard()
    .text('✅ Да, удалить', `odelc_${id}`).text('↩️ Нет', `odeln_${id}`);
  await ctx.editMessageText(ctx.msg.text + '\n\n⚠️ Точно удалить?', { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^odelc_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  await supabase.from('позиции_в_заказах').delete().eq('заказ_id', id);
  await supabase.from('заказы').update({ статус: 'Удалён' }).eq('id', id);
  await ctx.editMessageText('🗑 Заказ удалён');
  await ctx.answerCallbackQuery('Удалён');
});

bot.callbackQuery(/^odeln_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery('Отменено');
});

bot.callbackQuery(/^oedit_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  const kb = new InlineKeyboard()
    .text('💰 Изменить сумму', `oechg_${id}`).row()
    .text('💳↔️💵 Тип оплаты', `oepay_${id}`).row()
    .text('📝 Комментарий', `oecom_${id}`).row()
    .text('⬅️ Назад', `oeback_${id}`);
  await ctx.editMessageText(ctx.msg.text + '\n\n✏️ Что изменить?', { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^oepay_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  const { data: o } = await supabase.from('заказы').select('тип_оплаты').eq('id', id).single();
  const newType = o?.тип_оплаты === 'Наличные' ? 'Безналичные' : 'Наличные';
  await supabase.from('заказы').update({ тип_оплаты: newType }).eq('id', id);
  await ctx.editMessageText(`✅ Оплата: ${newType}`);
  await ctx.answerCallbackQuery('Изменено');
});

bot.callbackQuery(/^oechg_(\d+)$/, async (ctx) => {
  ctx.session.state = 'oe_sum'; ctx.session.data.editOrderId = parseInt(ctx.match[1]);
  await ctx.editMessageText('Новая сумма (₽):');
  await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'oe_sum', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<=0) return ctx.reply('Сумма:');
  await supabase.from('заказы').update({ итоговая_сумма: n }).eq('id', ctx.session.data.editOrderId);
  ctx.session.state = null;
  await ctx.reply(`✅ Сумма: ${n}₽`, { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
});

bot.callbackQuery(/^oecom_(\d+)$/, async (ctx) => {
  ctx.session.state = 'oe_com'; ctx.session.data.editOrderId = parseInt(ctx.match[1]);
  await ctx.editMessageText('Комментарий:'); await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'oe_com', async (ctx) => {
  await supabase.from('заказы').update({ комментарий: ctx.message.text }).eq('id', ctx.session.data.editOrderId);
  ctx.session.state = null;
  await ctx.reply('✅ Комментарий сохранён', { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
});

bot.callbackQuery(/^oeback_(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery(); // просто закрываем
});

// =============================================
// 💰 ТКОИНЫ
// =============================================
bot.hears('💰 Ткоины', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.state = 'tc_code';
  await ctx.reply('👤 Код клиента (4 цифры + буква):', { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(c => c.session.state === 'tc_code', async (ctx) => {
  const code = ctx.message.text.trim().toUpperCase();
  const { data: cl } = await supabase.from('клиенты').select('*').eq('уникальный_номер', code).single();
  if (!cl) return ctx.reply(`❌ "${code}" не найден. Ещё:`);
  ctx.session.data.client = cl; ctx.session.state = 'tc_amt';
  await ctx.reply(`👤 ${cl.имя||code}\n💎 ${cl.баланс_ткоинов||0} тк\n\nСумма:`);
});

bot.on('message:text').filter(c => c.session.state === 'tc_amt', async (ctx) => {
  const amt = parseInt(ctx.message.text); if (isNaN(amt)||amt<=0) return ctx.reply('Число:');
  const cl = ctx.session.data.client, emp = ctx.session.employee;
  const nb = (cl.баланс_ткоинов||0) + amt;
  await supabase.from('транзакции_ткоинов').insert({
    клиент_id: cl.id, тип: 'Пополнение', сумма: amt,
    баланс_до: cl.баланс_ткоинов||0, баланс_после: nb, причина: `${emp.имя}`, сотрудник_id: emp.id,
  });
  await supabase.from('клиенты').update({ баланс_ткоинов: nb }).eq('id', cl.id);
  ctx.session.state = null; ctx.session.data = {};
  await ctx.reply(`✅ +${amt} тк | 💎 ${nb}`, { reply_markup: getKB(emp, ctx.session.shift) });
});

// =============================================
// 📊 СЕГОДНЯ
// =============================================
bot.hears('📊 Сегодня', async (ctx) => {
  const emp = ctx.session.employee;
  const filter = emp.точка_id && emp.роль !== 'Владелец' ? { продавец_id: emp.id } : {};
  const { data: orders } = await supabase.from('заказы')
    .select('итоговая_сумма, сумма_нал, сумма_безнал, позиции_в_заказах(количество)')
    .match(filter).eq('статус', 'Завершён').gte('дата_создания', today()+'T00:00:00');
  if (!orders?.length) return ctx.reply('📊 Нет продаж');
  const t = orders.reduce((s,o)=>s+(o.итоговая_сумма||0),0);
  const cn = orders.reduce((s,o)=>s+(o.позиции_в_заказах||[]).reduce((ss,p)=>ss+(p.количество||0),0),0);
  const ca = orders.reduce((s,o)=>s+(o.сумма_нал||0),0);
  const cd = orders.reduce((s,o)=>s+(o.сумма_безнал||0),0);
  await ctx.reply(`📊 Сегодня: ${orders.length} продаж\n📦 ${cn} банок\n💰 ${t}₽\n💵 ${ca}₽ | 💳 ${cd}₽`);
});

// =============================================
// 💼 ИНКАССАЦИЯ
// =============================================
bot.hears('💼 Инкассация', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.state = 'inc_sum';
  const shift = ctx.session.shift;

  // Показываем текущую сводку
  const totalCash = (shift.нал_начало||0) + (shift.выручка_нал_факт||0) - (shift.доп_траты||0);

  await ctx.reply(
    `💼 Инкассация\n\n` +
    `💵 Нал на начало: ${shift.нал_начало||0}₽\n` +
    `💵 Приход нал за смену: ${shift.выручка_нал_факт||0}₽\n` +
    `💸 Расходы: ${shift.доп_траты||0}₽\n` +
    `💰 Должно быть: ${totalCash}₽\n\n` +
    `Сколько забираете?`,
    { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(c => c.session.state === 'inc_sum', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<=0) return ctx.reply('Сумма:');
  const emp = ctx.session.employee, shift = ctx.session.shift;

  // Записываем инкассацию
  await supabase.from('расходы').insert({
    точка_id: emp.точка_id, категория: 'Инкассация', сумма: n,
    описание: `Инкассация ${timeStr()}`, сотрудник_id: emp.id, смена_id: shift.id,
  });

  // Обновляем смену
  const totalCollected = (shift.инкассация||0) + n;
  await supabase.from('смены').update({ инкассация: totalCollected }).eq('id', shift.id);
  shift.инкассация = totalCollected;

  ctx.session.state = null;
  await ctx.reply(`✅ Инкассация: ${n}₽\n💼 Всего за смену: ${totalCollected}₽`,
    { reply_markup: getKB(emp, shift) });
});

// =============================================
// 🆘 SOS
// =============================================
bot.hears('🆘 SOS', async (ctx) => {
  const emp = ctx.session.employee;
  await supabase.from('sos_сигналы').insert({ сотрудник_id: emp.id, точка_id: emp.точка_id, тип: 'Проверка', сообщение: `SOS ${emp.имя}` });
  const { data: mgrs } = await supabase.from('сотрудники').select('telegram_id').in('роль', ['Редактор','Владелец']).eq('активен', true);
  for (const m of (mgrs||[])) { try { await bot.api.sendMessage(m.telegram_id, `🚨🚨🚨 SOS!\n${emp.имя} • ${emp.точки?.название||'?'}\n⏰ ${timeStr()}`); } catch {} }
  await ctx.reply('🚨 SOS отправлен!');
});

// =============================================
// 💸 РАСХОД
// =============================================
bot.hears('💸 Расход', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.state = 'ex_desc';
  await ctx.reply('📝 Описание расхода:', { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(c => c.session.state === 'ex_desc', async (ctx) => {
  ctx.session.data.exDesc = ctx.message.text; ctx.session.state = 'ex_sum';
  await ctx.reply('💰 Сумма (₽):');
});

bot.on('message:text').filter(c => c.session.state === 'ex_sum', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<=0) return ctx.reply('Сумма:');
  const emp = ctx.session.employee, desc = ctx.session.data.exDesc;
  await supabase.from('расходы').insert({
    точка_id: emp.точка_id, категория: 'Доп траты', сумма: n,
    описание: desc, сотрудник_id: emp.id, смена_id: ctx.session.shift?.id,
  });
  if (ctx.session.shift) {
    await supabase.from('смены').update({ доп_траты: (ctx.session.shift.доп_траты||0)+n }).eq('id', ctx.session.shift.id);
    ctx.session.shift.доп_траты = (ctx.session.shift.доп_траты||0)+n;
  }
  ctx.session.state = null; ctx.session.data = {};
  await ctx.reply(`✅ ${n}₽ — ${desc}`, { reply_markup: getKB(emp, ctx.session.shift) });
});

// =============================================
// ↩️ ВОЗВРАТ
// =============================================
bot.hears('↩️ Возврат', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.state = 'rt_reason'; ctx.session.data = {};
  await ctx.reply('📝 Причина возврата:', { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(c => c.session.state === 'rt_reason', async (ctx) => {
  ctx.session.data.rtReason = ctx.message.text; ctx.session.state = 'rt_ph1';
  await ctx.reply('📷 Фото упаковки (1/3):');
});

bot.on('message:photo').filter(c => ['rt_ph1','rt_ph2','rt_ph3'].includes(c.session.state), async (ctx) => {
  const fid = ctx.message.photo.at(-1).file_id;
  if (ctx.session.state === 'rt_ph1') { ctx.session.data.ph1 = fid; ctx.session.state = 'rt_ph2'; return ctx.reply('📷 Содержимое (2/3):'); }
  if (ctx.session.state === 'rt_ph2') { ctx.session.data.ph2 = fid; ctx.session.state = 'rt_ph3'; return ctx.reply('📷 Доп фото (3/3):'); }
  const emp = ctx.session.employee;
  await supabase.from('возвраты').insert({
    причина: ctx.session.data.rtReason, фото_упаковки: ctx.session.data.ph1,
    фото_содержимого: ctx.session.data.ph2, фото_дополнительное: fid,
    статус: 'На рассмотрении', продавец_id: emp.id,
  });
  const { data: mgrs } = await supabase.from('сотрудники').select('telegram_id').in('роль', ['Редактор','Владелец']).eq('активен', true);
  for (const m of (mgrs||[])) { try { await bot.api.sendMessage(m.telegram_id, `↩️ Возврат от ${emp.имя}\n${ctx.session.data.rtReason}`); } catch {} }
  ctx.session.state = null; ctx.session.data = {};
  await ctx.reply('✅ Возврат на рассмотрении!', { reply_markup: getKB(emp, ctx.session.shift) });
});

// =============================================
// 🔒 ЗАКРЫТЬ СМЕНУ (+ 2 фото чеков + инвент + разница)
// =============================================
bot.hears('🔒 Закрыть смену', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Смена не открыта!');
  ctx.session.state = 'sc_cans'; ctx.session.data = {};
  await ctx.reply('🔒 Закрытие смены\n\n📦 Банок на конец?', { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(c => c.session.state === 'sc_cans', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('Число:');
  ctx.session.data.ecans = n; ctx.session.state = 'sc_soda';
  await ctx.reply('🥤 Газировок на конец?');
});

bot.on('message:text').filter(c => c.session.state === 'sc_soda', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('Число:');
  ctx.session.data.esoda = n; ctx.session.state = 'sc_cash';
  await ctx.reply('💵 Наличных в кассе?');
});

bot.on('message:text').filter(c => c.session.state === 'sc_cash', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('Сумма:');
  ctx.session.data.ecash = n; ctx.session.state = 'sc_term';
  await ctx.reply('🏧 Сумма по терминалу?');
});

bot.on('message:text').filter(c => c.session.state === 'sc_term', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('Сумма:');
  ctx.session.data.eterm = n; ctx.session.state = 'sc_photo1';
  await ctx.reply('📷 Фото чека терминала (1/2):');
});

bot.on('message:photo').filter(c => c.session.state === 'sc_photo1', async (ctx) => {
  ctx.session.data.termPhoto1 = ctx.message.photo.at(-1).file_id;
  ctx.session.state = 'sc_photo2';
  await ctx.reply('📷 Фото чека терминала (2/2):');
});

bot.on('message:photo').filter(c => c.session.state === 'sc_photo2', async (ctx) => {
  ctx.session.data.termPhoto2 = ctx.message.photo.at(-1).file_id;
  const kb = new InlineKeyboard().text('✅ Да', 'cl_y').text('❌ Нет', 'cl_n');
  await ctx.reply('🧹 Уборка выполнена?', { reply_markup: kb });
});

bot.callbackQuery(/^cl_(y|n)$/, async (ctx) => {
  const cleaned = ctx.match[1] === 'y';
  const emp = ctx.session.employee, sh = ctx.session.shift, d = ctx.session.data;

  // Расчёты
  const cansUsed = (sh.банки_начало||0) - d.ecans;
  const shortage = cansUsed - (sh.банок_продано||0);

  const sodaUsed = (sh.газировка_начало||0) - d.esoda;

  // Нал: начало + приход нал - расходы - инкассация = ожидаемый. Разница = факт - ожидаемый
  const expectedCash = (sh.нал_начало||0) + (sh.выручка_нал_факт||0) - (sh.доп_траты||0) - (sh.инкассация||0);
  const cashDiff = d.ecash - expectedCash;

  const pct = calcSalaryPercent(sh.банок_продано||0);
  const sal = Math.round((emp.зп_база||2000) + ((sh.выручка_общая||0)*pct/100));

  await supabase.from('смены').update({
    время_закрытия: now(), время_закрытия_факт: now(),
    статус: 'Закрыта', банки_конец: d.ecans, газировка_конец: d.esoda,
    нал_конец: d.ecash, терминал_сумма: d.eterm,
    фото_чека_терминал: `${d.termPhoto1}|${d.termPhoto2}`,
    уборка_выполнена: cleaned,
    недостача_банки: Math.max(0, shortage),
    недостача_нал: cashDiff < 0 ? Math.abs(cashDiff) : 0,
    процент_зп: pct, зп_за_смену: sal,
    выручка_нал_факт: d.ecash, // факт нала в кассе
  }).eq('id', sh.id);

  let report =
    `🔒 Смена закрыта! ${timeStr()}\n\n` +
    `📅 ${today()}\n🏪 ${emp.точки?.название||''}\n\n` +
    `📦 Банки: ${sh.банки_начало} → ${d.ecans} (продано ${sh.банок_продано||0})`;

  if (shortage > 0) report += `\n⚠️ Недостача банок: ${shortage}`;
  else if (shortage < 0) report += `\n✅ Лишних банок: ${Math.abs(shortage)}`;

  report += `\n🥤 Газировки: ${sh.газировка_начало} → ${d.esoda} (ушло ${sodaUsed})`;
  report += `\n\n💰 Выручка: ${sh.выручка_общая||0}₽`;
  report += `\n💳 Безнал: ${sh.выручка_безнал||0}₽`;
  report += `\n💵 Нал в кассе: ${d.ecash}₽ (ожид: ${expectedCash}₽)`;

  if (cashDiff > 0) report += `\n✅ Излишек нала: +${cashDiff}₽`;
  else if (cashDiff < 0) report += `\n⚠️ Недостача нала: ${Math.abs(cashDiff)}₽`;

  report += `\n🏧 Терминал: ${d.eterm}₽`;
  if (sh.инкассация) report += `\n💼 Инкассация: ${sh.инкассация}₽`;
  report += `\n\n💵 ЗП: ${sal}₽ (${emp.зп_база||2000} + ${pct}%)`;
  report += `\n🧹 Уборка: ${cleaned?'✅':'❌'}`;

  ctx.session.shift = null; ctx.session.state = null; ctx.session.data = {};

  await ctx.editMessageText(report);

  // Показываем меню после закрытия
  await ctx.reply('Смена закрыта. Выберите:', { reply_markup: getKB(emp, null) });

  // Уведомляем владельца
  if (OWNER_ID && emp.telegram_id !== OWNER_ID) {
    try { await bot.api.sendMessage(OWNER_ID, `📋 ${emp.имя} (${emp.точки?.название||'?'})\n${report}`); } catch {}
  }
  await ctx.answerCallbackQuery('Закрыта');
});

// =============================================
// 📈 ТОП ПРОДАЖ
// =============================================
bot.hears('📈 Топ продаж', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;
  const weekAgo = new Date(Date.now()-7*86400000).toISOString().split('T')[0];

  const { data: dayD } = await supabase.from('позиции_в_заказах')
    .select('количество, товары(название), заказы!inner(дата_создания,статус)')
    .gte('заказы.дата_создания', today()+'T00:00:00').eq('заказы.статус', 'Завершён');
  const { data: weekD } = await supabase.from('позиции_в_заказах')
    .select('количество, товары(название), заказы!inner(дата_создания,статус)')
    .gte('заказы.дата_создания', weekAgo+'T00:00:00').eq('заказы.статус', 'Завершён');

  function top(rows) {
    const m = {}; (rows||[]).forEach(r => { const n = r.товары?.название||'?'; m[n]=(m[n]||0)+(r.количество||0); });
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,10);
  }
  const dt = top(dayD), wt = top(weekD);
  let t = '📈 ТОП ПРОДАЖ (все точки)\n\n📅 Сегодня:\n';
  if (dt.length) dt.forEach(([n,c],i)=>{t+=`${i+1}. ${n.substring(0,30)} — ${c} шт\n`;});
  else t+='Нет данных\n';
  t += '\n📅 За неделю:\n';
  if (wt.length) wt.forEach(([n,c],i)=>{t+=`${i+1}. ${n.substring(0,30)} — ${c} шт\n`;});
  else t+='Нет данных\n';
  await ctx.reply(t);
});

// =============================================
// 📊 СТАТИСТИКА
// =============================================
bot.hears('📊 Статистика', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;
  const { data: orders } = await supabase.from('заказы')
    .select('итоговая_сумма, сумма_нал, сумма_безнал, точки(название)')
    .eq('статус', 'Завершён').gte('дата_создания', today()+'T00:00:00');
  const { data: shifts } = await supabase.from('смены')
    .select('статус, банок_продано, выручка_общая, сотрудники(имя), точки(название)').eq('дата', today());

  const rev=(orders||[]).reduce((s,o)=>s+(o.итоговая_сумма||0),0);
  const ca=(orders||[]).reduce((s,o)=>s+(o.сумма_нал||0),0);
  const cd=(orders||[]).reduce((s,o)=>s+(o.сумма_безнал||0),0);
  const byPt={};
  (orders||[]).forEach(o=>{const p=o.точки?.название||'?';byPt[p]=(byPt[p]||0)+(o.итоговая_сумма||0);});

  let t=`📊 ${today()}\n\n💰 ${rev}₽ (💵${ca} / 💳${cd})\n📋 ${(orders||[]).length} заказов\n\n🏪 По точкам:\n`;
  Object.entries(byPt).sort((a,b)=>b[1]-a[1]).forEach(([p,s])=>{t+=`  ${p}: ${s}₽\n`;});
  t+='\n👥 Смены:\n';
  (shifts||[]).forEach(s=>{
    t+=`  ${s.сотрудники?.имя||'?'} (${s.точки?.название||'?'}) ${s.статус}`;
    if(s.банок_продано) t+=` | ${s.банок_продано} бан | ${s.выручка_общая||0}₽`;
    t+='\n';
  });
  await ctx.reply(t);
});

// =============================================
// 💸 УДЕРЖАНИЯ
// =============================================
bot.hears('💸 Удержания', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;
  const kb = new InlineKeyboard().text('📋 Активные', 'ud_list').text('➕ Создать', 'ud_new');
  await ctx.reply('💸 Удержания:', { reply_markup: kb });
});

bot.callbackQuery('ud_list', async (ctx) => {
  const { data: uds } = await supabase.from('удержания')
    .select('*, сотрудники!удержания_сотрудник_id_fkey(имя)').eq('статус', 'Активно');
  if (!uds?.length) { await ctx.editMessageText('Нет активных'); return ctx.answerCallbackQuery(); }
  let t='💸 Активные:\n\n';
  uds.forEach(u=>{const left=(u.сумма_общая||u.сумма)-((u.сумма_за_смену||0)*(u.погашено_смен||0));
    t+=`👤 ${u.сотрудники?.имя||'?'} | ${u.причина}\n   ${u.сумма_общая||u.сумма}₽ → ост: ${left}₽\n\n`;});
  await ctx.editMessageText(t); await ctx.answerCallbackQuery();
});

bot.callbackQuery('ud_new', async (ctx) => {
  const { data: emps } = await supabase.from('сотрудники').select('id, имя').eq('активен', true).neq('роль', 'Владелец');
  const kb = new InlineKeyboard();
  (emps||[]).forEach(e=>kb.text(e.имя, `ude_${e.id}`).row());
  await ctx.editMessageText('На кого?', { reply_markup: kb }); await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^ude_(\d+)$/, async (ctx) => {
  ctx.session.data.udEmp = parseInt(ctx.match[1]); ctx.session.state = 'ud_reason';
  await ctx.editMessageText('Причина:'); await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c=>c.session.state==='ud_reason', async (ctx) => {
  ctx.session.data.udReason = ctx.message.text; ctx.session.state = 'ud_sum';
  await ctx.reply('Сумма (₽):');
});

bot.on('message:text').filter(c=>c.session.state==='ud_sum', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<=0) return ctx.reply('Сумма:');
  ctx.session.data.udSum = n; ctx.session.state = 'ud_shifts';
  await ctx.reply('За сколько смен?');
});

bot.on('message:text').filter(c=>c.session.state==='ud_shifts', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n)||n<1) return ctx.reply('Число:');
  const d = ctx.session.data;
  await supabase.from('удержания').insert({
    сотрудник_id: d.udEmp, причина: d.udReason, сумма: d.udSum, сумма_общая: d.udSum,
    смен_для_погашения: n, сумма_за_смену: Math.ceil(d.udSum/n), погашено_смен: 0,
    статус: 'Активно', назначил_id: ctx.session.employee.id,
  });
  ctx.session.state = null; ctx.session.data = {};
  await ctx.reply(`✅ ${d.udSum}₽ за ${n} смен`, { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
});

// =============================================
// 📦 ПОСТУПЛЕНИЕ (через каталог: марка → линейка → вкус → кол-во)
// =============================================
bot.hears('📦 Поступление', async (ctx) => {
  if (!isManager(ctx.session.employee)) return;
  const { data: pts } = await supabase.from('точки').select('id, название').eq('активна', true);
  const kb = new InlineKeyboard();
  (pts||[]).forEach(p => kb.text(`🏪 ${p.название}`, `rcpt_${p.id}`).row());
  ctx.session.data = { recvItems: [] };
  await ctx.reply('📦 Поступление — на какую точку?', { reply_markup: kb });
});

bot.callbackQuery(/^rcpt_(\d+)$/, async (ctx) => {
  ctx.session.data.rcPt = parseInt(ctx.match[1]);
  const { data: pt } = await supabase.from('точки').select('название').eq('id', ctx.session.data.rcPt).single();
  ctx.session.data.rcPtName = pt?.название;
  // Показываем марки для выбора
  await showBrandsReceive(ctx);
  await ctx.answerCallbackQuery();
});

async function showBrandsReceive(ctx) {
  const { data } = await supabase.from('товары').select('бренд').eq('активен', true);
  const brands = [...new Set((data||[]).map(x => x.бренд).filter(Boolean))].sort();
  ctx.session.data.rcBrands = brands;
  const kb = new InlineKeyboard();
  brands.forEach(b => { kb.text(`📦 ${b}`, `rcb_${encodeURIComponent(b)}`).row(); });
  kb.text('✅ Завершить', 'rc_done');
  const pt = ctx.session.data.rcPtName;
  try { await ctx.editMessageText(`📦 → ${pt}\n\nВыберите марку:`, { reply_markup: kb }); }
  catch { await ctx.reply(`📦 → ${pt}\n\nВыберите марку:`, { reply_markup: kb }); }
}

bot.callbackQuery(/^rcb_(.+)$/, async (ctx) => {
  const brand = decodeURIComponent(ctx.match[1]);
  ctx.session.data.rcBrand = brand;
  const { data } = await supabase.from('товары').select('линейка').eq('бренд', brand).eq('активен', true);
  const lines = [...new Set((data||[]).map(x => x.линейка).filter(Boolean))].sort();
  ctx.session.data.rcLines = lines;
  const kb = new InlineKeyboard();
  lines.forEach(l => { kb.text(`📋 ${l}`, `rcl_${encodeURIComponent(l)}`).row(); });
  kb.text('⬅️ Марки', 'rc_tobr').row().text('✅ Завершить', 'rc_done');
  await ctx.editMessageText(`📦 ${brand}\nЛинейка:`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^rcl_(.+)$/, async (ctx) => {
  const line = decodeURIComponent(ctx.match[1]);
  ctx.session.data.rcLine = line;
  const brand = ctx.session.data.rcBrand;
  const { data: products } = await supabase.from('товары')
    .select('id, вкус, название').eq('бренд', brand).eq('линейка', line).eq('активен', true).order('вкус');
  const kb = new InlineKeyboard();
  (products||[]).forEach(p => {
    kb.text(`🔹 ${(p.вкус||p.название).substring(0,40)}`, `rcf_${p.id}`).row();
  });
  kb.text('⬅️ Линейки', `rcbl_${encodeURIComponent(brand)}`).text('⬅️ Марки', 'rc_tobr').row();
  kb.text('✅ Завершить', 'rc_done');
  await ctx.editMessageText(`📦 ${brand} • ${line}\nВкус:`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^rcf_(\d+)$/, async (ctx) => {
  ctx.session.data.rcProd = parseInt(ctx.match[1]);
  const { data: p } = await supabase.from('товары').select('название').eq('id', ctx.session.data.rcProd).single();
  ctx.session.data.rcProdName = p?.название;
  ctx.session.state = 'rc_qty';
  await ctx.editMessageText(`📦 ${p?.название}\n\nКоличество:`);
  await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c=>c.session.state==='rc_qty', async (ctx) => {
  const qty = parseInt(ctx.message.text); if (isNaN(qty)||qty<1) return ctx.reply('Число:');
  const d = ctx.session.data;
  const { data: inv } = await supabase.from('инвентарь').select('id, количество')
    .eq('товар_id', d.rcProd).eq('точка_id', d.rcPt).single();
  if (inv) await supabase.from('инвентарь').update({ количество: inv.количество+qty, последнее_обновление: now() }).eq('id', inv.id);
  else await supabase.from('инвентарь').insert({ товар_id: d.rcProd, точка_id: d.rcPt, количество: qty });

  await supabase.from('движения').insert({
    товар_id: d.rcProd, точка_куда_id: d.rcPt, тип_операции: 'Поступление',
    количество: qty, сотрудник_id: ctx.session.employee.id, комментарий: `→ ${d.rcPtName}`,
  });
  d.recvItems.push({ name: d.rcProdName, qty });
  ctx.session.state = null;
  await ctx.reply(`✅ +${qty} ${d.rcProdName}`);
  // Обратно к маркам
  await showBrandsReceive(ctx);
});

bot.callbackQuery('rc_tobr', async (ctx) => { await showBrandsReceive(ctx); await ctx.answerCallbackQuery(); });

bot.callbackQuery(/^rcbl_(.+)$/, async (ctx) => {
  const brand = decodeURIComponent(ctx.match[1]);
  ctx.session.data.rcBrand = brand;
  const { data } = await supabase.from('товары').select('линейка').eq('бренд', brand).eq('активен', true);
  const lines = [...new Set((data||[]).map(x => x.линейка).filter(Boolean))].sort();
  const kb = new InlineKeyboard();
  lines.forEach(l => { kb.text(`📋 ${l}`, `rcl_${encodeURIComponent(l)}`).row(); });
  kb.text('⬅️ Марки', 'rc_tobr').row().text('✅ Завершить', 'rc_done');
  await ctx.editMessageText(`📦 ${brand}\nЛинейка:`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery('rc_done', async (ctx) => {
  const items = ctx.session.data.recvItems||[];
  let t = `📦 Поступление на ${ctx.session.data.rcPtName||'?'}:\n\n`;
  items.forEach(i=>{t+=`✅ ${i.name.substring(0,30)} — ${i.qty} шт\n`;});
  if (!items.length) t += 'Пусто';
  ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText(t); await ctx.answerCallbackQuery();
  await mainMenu(ctx);
});

// =============================================
// 🔄 ПЕРЕМЕЩЕНИЕ
// =============================================
bot.hears('🔄 Перемещение', async (ctx) => {
  if (!isManager(ctx.session.employee)) return;
  const { data: pts } = await supabase.from('точки').select('id, название').eq('активна', true);
  const kb = new InlineKeyboard();
  (pts||[]).forEach(p => kb.text(`🏪 ${p.название}`, `mvf_${p.id}`).row());
  ctx.session.data = { mvItems: [] };
  await ctx.reply('🔄 ОТКУДА?', { reply_markup: kb });
});

bot.callbackQuery(/^mvf_(\d+)$/, async (ctx) => {
  ctx.session.data.mvFrom = parseInt(ctx.match[1]);
  const { data: pt } = await supabase.from('точки').select('название').eq('id', ctx.session.data.mvFrom).single();
  ctx.session.data.mvFromName = pt?.название;
  const { data: pts } = await supabase.from('точки').select('id, название').eq('активна', true).neq('id', ctx.session.data.mvFrom);
  const kb = new InlineKeyboard();
  (pts||[]).forEach(p => kb.text(`🏪 ${p.название}`, `mvt_${p.id}`).row());
  await ctx.editMessageText(`${pt?.название} → ?\n\nКУДА?`, { reply_markup: kb }); await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^mvt_(\d+)$/, async (ctx) => {
  ctx.session.data.mvTo = parseInt(ctx.match[1]);
  const { data: pt } = await supabase.from('точки').select('название').eq('id', ctx.session.data.mvTo).single();
  ctx.session.data.mvToName = pt?.название;
  ctx.session.state = 'mv_search';
  await ctx.editMessageText(`🔄 ${ctx.session.data.mvFromName} → ${pt?.название}\n\n🔍 Название товара:`);
  await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c=>c.session.state==='mv_search', async (ctx) => {
  const { data: prods } = await supabase.from('товары').select('id, название')
    .ilike('название', `%${ctx.message.text.trim()}%`).eq('активен', true).limit(10);
  if (!prods?.length) return ctx.reply('Не найдено. Ещё:');
  const kb = new InlineKeyboard();
  prods.forEach(p=>kb.text(p.название.substring(0,35), `mvp_${p.id}`).row());
  kb.text('✅ Готово', 'mv_done');
  await ctx.reply('Выберите:', { reply_markup: kb });
});

bot.callbackQuery(/^mvp_(\d+)$/, async (ctx) => {
  const d = ctx.session.data;
  d.mvProd = parseInt(ctx.match[1]);
  const { data: p } = await supabase.from('товары').select('название').eq('id', d.mvProd).single();
  d.mvProdName = p?.название;
  const { data: inv } = await supabase.from('инвентарь').select('количество')
    .eq('товар_id', d.mvProd).eq('точка_id', d.mvFrom).single();
  ctx.session.state = 'mv_qty';
  await ctx.editMessageText(`📦 ${p?.название}\n📍 ${d.mvFromName}: ${inv?.количество||0}\n\nСколько?`);
  await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c=>c.session.state==='mv_qty', async (ctx) => {
  const qty = parseInt(ctx.message.text); if (isNaN(qty)||qty<1) return ctx.reply('Число:');
  const d = ctx.session.data;
  const { data: from } = await supabase.from('инвентарь').select('id, количество')
    .eq('товар_id', d.mvProd).eq('точка_id', d.mvFrom).single();
  if (from) await supabase.from('инвентарь').update({ количество: Math.max(0, from.количество-qty), последнее_обновление: now() }).eq('id', from.id);
  const { data: to } = await supabase.from('инвентарь').select('id, количество')
    .eq('товар_id', d.mvProd).eq('точка_id', d.mvTo).single();
  if (to) await supabase.from('инвентарь').update({ количество: to.количество+qty, последнее_обновление: now() }).eq('id', to.id);
  else await supabase.from('инвентарь').insert({ товар_id: d.mvProd, точка_id: d.mvTo, количество: qty });

  await supabase.from('движения').insert({
    товар_id: d.mvProd, точка_откуда_id: d.mvFrom, точка_куда_id: d.mvTo,
    тип_операции: 'Перемещение', количество: qty,
    сотрудник_id: ctx.session.employee.id, комментарий: `${d.mvFromName} → ${d.mvToName}`,
  });
  d.mvItems.push({ name: d.mvProdName, qty });
  ctx.session.state = 'mv_search';
  const kb = new InlineKeyboard().text('✅ Готово', 'mv_done');
  await ctx.reply(`✅ ${d.mvProdName} ×${qty}: ${d.mvFromName} → ${d.mvToName}\n\nЕщё:`, { reply_markup: kb });
});

bot.callbackQuery('mv_done', async (ctx) => {
  const d = ctx.session.data;
  let t = `🔄 ${d.mvFromName} → ${d.mvToName}:\n\n`;
  (d.mvItems||[]).forEach(i=>{t+=`✅ ${i.name.substring(0,30)} — ${i.qty}\n`;});
  ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText(t); await ctx.answerCallbackQuery();
  await mainMenu(ctx);
});

// =============================================
// 📋 ЗАКАЗЫ (входящие из Mini App)
// =============================================
bot.hears('📋 Заказы', async (ctx) => {
  const emp = ctx.session.employee;
  const filter = emp.точка_id && emp.роль !== 'Владелец' ? { точка_id: emp.точка_id } : {};
  const { data: orders } = await supabase.from('заказы').select('*, клиенты(имя, уникальный_номер)')
    .match(filter).in('статус', ['Новый','Подтверждён','Готов']).order('дата_создания').limit(10);
  if (!orders?.length) return ctx.reply('✅ Нет входящих заказов');
  for (const o of orders) {
    const kb = new InlineKeyboard()
      .text('✅ Готов', `or_${o.id}`).text('🤝 Выдан', `od_${o.id}`).row()
      .text('❌ Отмена', `oc_${o.id}`);
    await ctx.reply(`📋 ${o.номер_заказа}\n👤 ${o.клиенты?.имя||'?'} (${o.клиенты?.уникальный_номер||''})\n💰 ${o.итоговая_сумма}₽ | ${o.тип_доставки}`, { reply_markup: kb });
  }
});

bot.callbackQuery(/^o(r|d|c)_(\d+)$/, async (ctx) => {
  const m = { r:'Готов', d:'Завершён', c:'Отменён' };
  const upd = { статус: m[ctx.match[1]] };
  if (ctx.match[1]==='d') upd.время_выдачи = now();
  await supabase.from('заказы').update(upd).eq('id', parseInt(ctx.match[2]));
  await ctx.editMessageText(ctx.msg.text+`\n\n→ ${m[ctx.match[1]]}`); await ctx.answerCallbackQuery(m[ctx.match[1]]);
});

// =============================================
// 📝 ЗАДАЧИ
// =============================================
bot.hears('📝 Задачи', async (ctx) => {
  const { data: tasks } = await supabase.from('задачи').select('*')
    .eq('исполнитель_id', ctx.session.employee.id).in('статус', ['Новая','В работе']).order('срок');
  if (!tasks?.length) return ctx.reply('✅ Нет задач');
  let t = `📝 Задачи (${tasks.length}):\n\n`;
  tasks.forEach(tk=>{t+=`${tk.статус==='Новая'?'🆕':'🔄'} ${tk.описание}\nСрок: ${tk.срок?new Date(tk.срок).toLocaleDateString('ru-RU'):'—'}\n\n`;});
  await ctx.reply(t);
});

// =============================================
// 👥 СОТРУДНИКИ + ➕👤 СОТРУДНИК
// =============================================
bot.hears('👥 Сотрудники', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;
  const { data: emps } = await supabase.from('сотрудники').select('*, точки(название)').eq('активен', true).order('роль');
  const em = {'Продавец':'🏪','Курьер':'🚗','Редактор':'✏️','Бухгалтер':'📊','Владелец':'👑'};
  let t = `👥 (${(emps||[]).length}):\n\n`;
  (emps||[]).forEach(e=>{t+=`${em[e.роль]||'👤'} ${e.имя} — ${e.роль}\n   ${e.точки?.название||'—'} | ${e.telegram_id}\n\n`;});
  await ctx.reply(t);
});

bot.hears('➕👤 Сотрудник', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;
  ctx.session.state = 'ae_tg';
  await ctx.reply('📱 Telegram ID:', { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(c=>c.session.state==='ae_tg', async (ctx) => {
  const id = parseInt(ctx.message.text); if (isNaN(id)) return ctx.reply('Число:');
  ctx.session.data.aeTg = id; ctx.session.state = 'ae_name';
  await ctx.reply('👤 Имя:');
});

bot.on('message:text').filter(c=>c.session.state==='ae_name', async (ctx) => {
  ctx.session.data.aeName = ctx.message.text; ctx.session.state = 'ae_role';
  const kb = new InlineKeyboard()
    .text('🏪 Продавец', 'ar_Продавец').text('🚗 Курьер', 'ar_Курьер').row()
    .text('✏️ Редактор', 'ar_Редактор').text('📊 Бухгалтер', 'ar_Бухгалтер');
  await ctx.reply('Роль:', { reply_markup: kb });
});

bot.callbackQuery(/^ar_(.+)$/, async (ctx) => {
  ctx.session.data.aeRole = ctx.match[1];
  const { data: pts } = await supabase.from('точки').select('id, название').eq('активна', true);
  const kb = new InlineKeyboard();
  (pts||[]).forEach(p => kb.text(`🏪 ${p.название}`, `ap_${p.id}`).row());
  kb.text('Без точки', 'ap_0');
  await ctx.editMessageText(`${ctx.match[1]}\nТочка:`);
  await ctx.reply('Выберите:', { reply_markup: kb }); await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^ap_(\d+)$/, async (ctx) => {
  const d = ctx.session.data;
  const { error } = await supabase.from('сотрудники').insert({
    telegram_id: d.aeTg, имя: d.aeName, роль: d.aeRole,
    точка_id: parseInt(ctx.match[1])||null, активен: true, зп_база: 2000,
  });
  if (error) { await ctx.answerCallbackQuery(); return ctx.editMessageText(`❌ ${error.message}`); }
  ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText(`✅ ${d.aeName} — ${d.aeRole}\nТеперь /start`);
  await ctx.answerCallbackQuery('Добавлен!');
});

// =============================================
// РАЗДЕЛИТЕЛЬ + FALLBACK
// =============================================
bot.hears(/^─+/, () => {});
bot.on('message:text', async (ctx) => {
  if (ctx.session.state) return ctx.reply('⚠️ Неверный ввод. /start');
});

// =============================================
// ЗАПУСК
// =============================================
bot.catch((err) => console.error('Bot error:', err));
bot.start({ onStart: () => console.log('🤖 TTS Staff Bot v3!') });
