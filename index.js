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
const KB = {
  seller: () => new Keyboard()
    .text('📂 Открыть смену').text('📋 Заказы').row()
    .text('➕ Продажа').text('💰 Ткоины').row()
    .text('↩️ Возврат').text('📊 Сегодня').row()
    .text('💸 Расход').text('🎁 Себе').row()
    .text('📝 Задачи').text('🆘 SOS').row()
    .text('🔒 Закрыть смену')
    .resized(),

  owner: () => new Keyboard()
    .text('📂 Открыть смену').text('➕ Продажа').row()
    .text('📋 Заказы').text('📊 Сегодня').row()
    .text('💰 Ткоины').text('↩️ Возврат').row()
    .text('💸 Расход').text('🎁 Себе').row()
    .text('🔒 Закрыть смену').text('🆘 SOS').row()
    .text('─────────────').row()
    .text('👥 Сотрудники').text('➕ Сотрудник').row()
    .text('📈 Топ продаж').text('📊 Статистика').row()
    .text('💸 Удержания').text('📦 Поступление').row()
    .text('🔄 Перемещение').text('📝 Задачи')
    .resized(),

  editor: () => new Keyboard()
    .text('📦 Поступление').text('🔄 Перемещение').row()
    .text('📋 Заказы').text('📊 Сегодня').row()
    .text('📝 Задачи')
    .resized(),

  courier: () => new Keyboard()
    .text('🚗 Активные').text('✅ Выполненные').row()
    .text('❌ Отменённые')
    .resized(),
};

function getKB(role) {
  if (role === 'Владелец') return KB.owner();
  if (role === 'Редактор') return KB.editor();
  if (role === 'Курьер') return KB.courier();
  return KB.seller();
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

function isSeller(e) { return ['Продавец', 'Владелец'].includes(e?.роль); }
function isManager(e) { return ['Владелец', 'Редактор'].includes(e?.роль); }

function calcSalaryPercent(cans) {
  if (cans >= 120) return 6.5; if (cans >= 110) return 6; if (cans >= 100) return 5.5;
  if (cans >= 90) return 5; if (cans >= 80) return 4.5; if (cans >= 70) return 4;
  if (cans >= 55) return 3.5; if (cans >= 40) return 2.5; return 0;
}

// =============================================
// /start, /id, /register_owner
// =============================================
bot.command('id', (ctx) => ctx.reply(`Ваш Telegram ID: ${ctx.from.id}`));

bot.command('start', async (ctx) => {
  const emp = await getEmployee(ctx.from.id);
  if (!emp) {
    if (ctx.from.id === OWNER_ID) return ctx.reply('👑 Отправьте /register_owner');
    return ctx.reply('⛔ Вы не зарегистрированы. Обратитесь к руководству.');
  }
  ctx.session.employee = emp;
  ctx.session.state = null;
  ctx.session.data = {};
  if (isSeller(emp)) ctx.session.shift = await getActiveShift(emp.id);

  const em = { 'Продавец':'🏪','Курьер':'🚗','Редактор':'✏️','Бухгалтер':'📊','Владелец':'👑' };
  const sh = isSeller(emp) ? (ctx.session.shift ? '\n🟢 Смена открыта' : '\n⚪ Смена закрыта') : '';
  await ctx.reply(`${em[emp.роль]||'👤'} ${emp.имя}\n${emp.роль} • ${emp.точки?.название||'—'}${sh}`,
    { reply_markup: getKB(emp.роль) });
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
  ctx.reply('✅ Владелец добавлен! /start');
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
    (pts||[]).forEach(p => kb.text(p.название, `shpt_${p.id}`).row());
    return ctx.reply('🏪 Точка для смены:', { reply_markup: kb });
  }
  ctx.session.state = 'sh_cans'; ctx.session.data = {};
  await ctx.reply('📂 Открытие смены\n\nБанок на начало?', { reply_markup: { remove_keyboard: true } });
});

bot.callbackQuery(/^shpt_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  const { data: pt } = await supabase.from('точки').select('название').eq('id', id).single();
  ctx.session.employee.точка_id = id;
  ctx.session.employee.точки = pt;
  ctx.session.state = 'sh_cans'; ctx.session.data = {};
  await ctx.editMessageText(`🏪 ${pt?.название}\n\nБанок на начало?`);
  await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'sh_cans', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('Число:');
  ctx.session.data.cans = n; ctx.session.state = 'sh_soda';
  await ctx.reply('Газировок на начало?');
});

bot.on('message:text').filter(c => c.session.state === 'sh_soda', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('Число:');
  ctx.session.data.soda = n; ctx.session.state = 'sh_cash';
  await ctx.reply('Наличных в кассе?');
});

bot.on('message:text').filter(c => c.session.state === 'sh_cash', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('Сумма:');
  const emp = ctx.session.employee;
  const { data: shift, error } = await supabase.from('смены').insert({
    сотрудник_id: emp.id, точка_id: emp.точка_id, дата: today(),
    время_открытия: new Date().toISOString(), статус: 'Открыта',
    банки_начало: ctx.session.data.cans, газировка_начало: ctx.session.data.soda, нал_начало: n,
  }).select().single();
  if (error) return ctx.reply(`❌ ${error.message}`);
  ctx.session.shift = shift; ctx.session.state = null; ctx.session.data = {};
  await ctx.reply(
    `✅ Смена открыта!\n📅 ${today()}\n🏪 ${emp.точки?.название||''}\n📦 ${shift.банки_начало} банок | 🥤 ${shift.газировка_начало} газ | 💵 ${n}₽`,
    { reply_markup: getKB(emp.роль) });
});

// =============================================
// ➕ ПРОДАЖА — Марка → Линейка → Вкус → Кол-во → Оплата → ещё/оформить
// =============================================
bot.hears('➕ Продажа', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.data = { items: [] };
  await showBrands(ctx, 's');
});

// --- Показать бренды ---
async function showBrands(ctx, p) {
  const { data } = await supabase.from('товары').select('бренд').eq('активен', true);
  const brands = [...new Set((data||[]).map(x => x.бренд).filter(Boolean))].sort();
  ctx.session.data.brands = brands;

  const kb = new InlineKeyboard();
  brands.forEach((b, i) => { kb.text(b, `${p}b_${i}`); if (i%3===2) kb.row(); });
  if (brands.length%3!==0) kb.row();
  kb.text('❌ Отмена', `${p}_cx`);

  const title = p === 'ts' ? '🎁 Марка:' : '🛒 Марка:';
  if (ctx.callbackQuery) { await ctx.editMessageText(title, { reply_markup: kb }); await ctx.answerCallbackQuery(); }
  else await ctx.reply(title, { reply_markup: kb });
}

// --- Выбор бренда → линейки ---
bot.callbackQuery(/^(s|ts)b_(\d+)$/, async (ctx) => {
  const p = ctx.match[1];
  const brand = ctx.session.data.brands?.[parseInt(ctx.match[2])];
  if (!brand) return ctx.answerCallbackQuery('Ошибка');
  ctx.session.data.brand = brand;

  const { data } = await supabase.from('товары').select('линейка')
    .eq('бренд', brand).eq('активен', true);
  const lines = [...new Set((data||[]).map(x => x.линейка).filter(Boolean))].sort();
  ctx.session.data.lines = lines;

  const kb = new InlineKeyboard();
  lines.forEach((l, i) => { kb.text(l, `${p}l_${i}`); if (i%3===2) kb.row(); });
  if (lines.length%3!==0) kb.row();
  kb.text('← Марки', `${p}_tobr`).text('❌ Отмена', `${p}_cx`);

  await ctx.editMessageText(`📦 ${brand}\nЛинейка:`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

// --- Выбор линейки → вкусы ---
bot.callbackQuery(/^(s|ts)l_(\d+)$/, async (ctx) => {
  const p = ctx.match[1];
  const line = ctx.session.data.lines?.[parseInt(ctx.match[2])];
  if (!line) return ctx.answerCallbackQuery('Ошибка');
  ctx.session.data.line = line;
  await showFlavors(ctx, p);
});

async function showFlavors(ctx, p) {
  const { brand, line } = ctx.session.data;
  const { data: products } = await supabase.from('товары')
    .select('id, вкус, цена_безнал, цена_нал')
    .eq('бренд', brand).eq('линейка', line).eq('активен', true).order('вкус');
  ctx.session.data.flavors = products || [];

  const kb = new InlineKeyboard();
  (products||[]).forEach(pr => {
    kb.text((pr.вкус||'???').substring(0, 32), `${p}f_${pr.id}`).row();
  });
  kb.text('← Линейки', `${p}_toln`).text('← Марки', `${p}_tobr`).row();
  kb.text('🏠 Меню', `${p}_mn`).text('❌ Отмена', `${p}_cx`);

  await ctx.editMessageText(`📦 ${brand} • ${line}\nВкус:`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
}

// --- Выбор вкуса ---
bot.callbackQuery(/^(s|ts)f_(\d+)$/, async (ctx) => {
  const p = ctx.match[1];
  const id = parseInt(ctx.match[2]);
  const { data: product } = await supabase.from('товары').select('*').eq('id', id).single();
  if (!product) return ctx.answerCallbackQuery('Не найден');
  ctx.session.data.curProduct = product;

  if (p === 'ts') {
    // Товар себе — сразу записать
    const shift = ctx.session.shift;
    const existing = shift?.товар_себе;
    const val = existing ? `${existing}, ${product.название}` : product.название;
    await supabase.from('смены').update({ товар_себе: val }).eq('id', shift.id);
    shift.товар_себе = val;
    await ctx.editMessageText(`✅ Записано: ${product.название}`);
    return ctx.answerCallbackQuery('Записано!');
  }

  // Продажа — количество
  const kb = new InlineKeyboard();
  for (let i = 1; i <= 5; i++) kb.text(`${i}`, `sq_${i}`);
  kb.row();
  for (let i = 6; i <= 10; i++) kb.text(`${i}`, `sq_${i}`);
  kb.row();
  kb.text('← Вкусы', `${p}_tofl`).text('← Марки', `${p}_tobr`).row();
  kb.text('❌ Отмена', `${p}_cx`);

  await ctx.editMessageText(
    `📦 ${product.название}\n💳 ${product.цена_безнал}₽ | 💵 ${product.цена_нал}₽\n\nКоличество:`,
    { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

// --- Количество → оплата ---
bot.callbackQuery(/^sq_(\d+)$/, async (ctx) => {
  const qty = parseInt(ctx.match[1]);
  const pr = ctx.session.data.curProduct;
  if (!pr) return ctx.answerCallbackQuery('Ошибка');
  ctx.session.data.curQty = qty;

  const kb = new InlineKeyboard()
    .text(`💵 Нал ${pr.цена_нал * qty}₽`, 'spay_cash')
    .text(`💳 Безнал ${pr.цена_безнал * qty}₽`, 'spay_card');
  await ctx.editMessageText(`📦 ${pr.название} × ${qty}\n\nОплата:`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

// --- Оплата → корзина → обратно к вкусам ---
bot.callbackQuery(/^spay_(cash|card)$/, async (ctx) => {
  const pr = ctx.session.data.curProduct;
  const qty = ctx.session.data.curQty;
  const payType = ctx.match[1] === 'cash' ? 'Наличные' : 'Безналичные';
  const price = payType === 'Наличные' ? pr.цена_нал : pr.цена_безнал;

  ctx.session.data.items.push({ product: pr, qty, payType, price, total: price * qty });

  // Показываем корзину + возвращаем к вкусам текущей линейки
  const items = ctx.session.data.items;
  const sum = items.reduce((s, i) => s + i.total, 0);
  let cart = items.map((it, i) =>
    `${i+1}. ${(it.product.вкус||it.product.название).substring(0, 28)} ×${it.qty} ${it.total}₽ (${it.payType === 'Наличные' ? 'нал' : 'б/н'})`
  ).join('\n');

  const kb = new InlineKeyboard()
    .text('➕ Ещё (этой линейки)', 's_tofl').row()
    .text('← Линейки', 's_toln').text('← Марки', 's_tobr').row()
    .text('✅ Оформить', 'sale_go').row()
    .text('❌ Отменить заказ', 's_cx');

  await ctx.editMessageText(`🛒 Корзина:\n${cart}\n\n💰 Итого: ${sum}₽`, { reply_markup: kb });
  await ctx.answerCallbackQuery('Добавлено!');
});

// =============================================
// НАВИГАЦИЯ КАТАЛОГА
// =============================================
bot.callbackQuery(/^(s|ts)_tobr$/, async (ctx) => { await showBrands(ctx, ctx.match[1]); });

bot.callbackQuery(/^(s|ts)_toln$/, async (ctx) => {
  const p = ctx.match[1];
  const brand = ctx.session.data.brand;
  if (!brand) return showBrands(ctx, p);
  const { data } = await supabase.from('товары').select('линейка').eq('бренд', brand).eq('активен', true);
  const lines = [...new Set((data||[]).map(x => x.линейка).filter(Boolean))].sort();
  ctx.session.data.lines = lines;
  const kb = new InlineKeyboard();
  lines.forEach((l, i) => { kb.text(l, `${p}l_${i}`); if (i%3===2) kb.row(); });
  if (lines.length%3!==0) kb.row();
  kb.text('← Марки', `${p}_tobr`).text('❌ Отмена', `${p}_cx`);
  await ctx.editMessageText(`📦 ${brand}\nЛинейка:`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^(s|ts)_tofl$/, async (ctx) => {
  const p = ctx.match[1];
  const { brand, line } = ctx.session.data;
  if (!brand || !line) return showBrands(ctx, p);
  await showFlavors(ctx, p);
});

bot.callbackQuery(/^(s|ts)_mn$/, async (ctx) => {
  ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText('🏠 Меню');
  await ctx.answerCallbackQuery();
});

// Отмена с подтверждением
bot.callbackQuery(/^(s|ts)_cx$/, async (ctx) => {
  const p = ctx.match[1];
  const items = ctx.session.data.items || [];
  if (!items.length) {
    ctx.session.state = null; ctx.session.data = {};
    await ctx.editMessageText('❌ Отменено');
    return ctx.answerCallbackQuery();
  }
  const kb = new InlineKeyboard()
    .text('✅ Да, отменить', `${p}_cxy`)
    .text('↩️ Нет', `${p}_tobr`);
  await ctx.editMessageText(`⚠️ В корзине ${items.length} товаров. Точно отменить?`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^(s|ts)_cxy$/, async (ctx) => {
  ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText('❌ Заказ отменён');
  await ctx.answerCallbackQuery();
});

// =============================================
// ОФОРМЛЕНИЕ ПРОДАЖИ — клиент по коду
// =============================================
bot.callbackQuery('sale_go', async (ctx) => {
  ctx.session.state = 'sale_client';
  const kb = new InlineKeyboard().text('⏩ Без клиента', 'sale_nocl');
  await ctx.editMessageText('👤 Код клиента (4 цифры + буква):\n\nКлиент называет свой номер из приложения.', { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery('sale_nocl', async (ctx) => {
  ctx.session.data.client = null;
  await finishSale(ctx);
  await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'sale_client', async (ctx) => {
  const code = ctx.message.text.trim().toUpperCase();
  const { data: client } = await supabase.from('клиенты').select('*').eq('уникальный_номер', code).single();
  if (!client) {
    const kb = new InlineKeyboard().text('⏩ Без клиента', 'sale_nocl');
    return ctx.reply(`❌ "${code}" не найден. Ещё раз или:`, { reply_markup: kb });
  }
  ctx.session.data.client = client;
  await ctx.reply(`✅ ${client.имя||code} | 💎 ${client.баланс_ткоинов||0} тк | Скидка ${client.постоянная_скидка||0}%`);
  await finishSale(ctx);
});

async function finishSale(ctx) {
  const emp = ctx.session.employee, shift = ctx.session.shift;
  const items = ctx.session.data.items, client = ctx.session.data.client;
  const grand = items.reduce((s, i) => s + i.total, 0);
  const cash = items.filter(i => i.payType === 'Наличные').reduce((s, i) => s + i.total, 0);
  const card = items.filter(i => i.payType === 'Безналичные').reduce((s, i) => s + i.total, 0);
  const cans = items.reduce((s, i) => s + i.qty, 0);

  const { data: order, error } = await supabase.from('заказы').insert({
    клиент_id: client?.id || null, точка_id: emp.точка_id, статус: 'Завершён',
    тип_доставки: 'Самовывоз',
    тип_оплаты: cash > 0 && card > 0 ? 'Смешанная' : (cash > 0 ? 'Наличные' : 'Безналичные'),
    сумма_товаров: grand, итоговая_сумма: grand, сумма_безнал: card, сумма_нал: cash,
    продавец_id: emp.id,
    товары_json: JSON.stringify(items.map(i => ({ id: i.product.id, name: i.product.название, qty: i.qty, price: i.price }))),
  }).select().single();

  if (error) { ctx.session.state = null; return ctx.reply(`❌ ${error.message}`, { reply_markup: getKB(emp.роль) }); }

  for (const item of items) {
    await supabase.from('позиции_в_заказах').insert({
      заказ_id: order.id, товар_id: item.product.id, количество: item.qty,
      цена_за_единицу: item.price, тип_оплаты: item.payType,
    });
    const { data: inv } = await supabase.from('инвентарь').select('id, количество')
      .eq('товар_id', item.product.id).eq('точка_id', emp.точка_id).single();
    if (inv) await supabase.from('инвентарь')
      .update({ количество: Math.max(0, inv.количество - item.qty), последнее_обновление: new Date().toISOString() })
      .eq('id', inv.id);
  }

  const nc = (shift.банок_продано||0) + cans;
  const nr = (shift.выручка_общая||0) + grand;
  await supabase.from('смены').update({
    банок_продано: nc, выручка_общая: nr,
    выручка_безнал: (shift.выручка_безнал||0) + card,
    выручка_нал_факт: (shift.выручка_нал_факт||0) + cash,
  }).eq('id', shift.id);
  shift.банок_продано = nc; shift.выручка_общая = nr;

  if (client && cash > 0) {
    const tc = Math.floor(cash); // 1₽ = 1 ткоин за нал
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
    `✅ ${order.номер_заказа}\n\n` +
    items.map(i => `• ${i.product.название.substring(0,35)} ×${i.qty}`).join('\n') +
    `\n\n💰 ${grand}₽` + (cash ? ` 💵${cash}` : '') + (card ? ` 💳${card}` : '') +
    (client ? `\n👤 ${client.имя||client.уникальный_номер}` : '') +
    `\n📦 За смену: ${nc} банок`,
    { reply_markup: getKB(emp.роль) });
}

// =============================================
// 🎁 СЕБЕ (через каталог кнопками)
// =============================================
bot.hears('🎁 Себе', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.data = { items: [] };
  await showBrands(ctx, 'ts');
});

// =============================================
// 💰 ТКОИНЫ — по коду клиента
// =============================================
bot.hears('💰 Ткоины', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.state = 'tc_code';
  await ctx.reply('Код клиента (4 цифры + буква):', { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(c => c.session.state === 'tc_code', async (ctx) => {
  const code = ctx.message.text.trim().toUpperCase();
  const { data: cl } = await supabase.from('клиенты').select('*').eq('уникальный_номер', code).single();
  if (!cl) return ctx.reply(`❌ "${code}" не найден. Ещё раз:`);
  ctx.session.data.client = cl; ctx.session.state = 'tc_amt';
  await ctx.reply(`👤 ${cl.имя||code}\n💎 ${cl.баланс_ткоинов||0} тк\n\nСумма пополнения:`);
});

bot.on('message:text').filter(c => c.session.state === 'tc_amt', async (ctx) => {
  const amt = parseInt(ctx.message.text); if (isNaN(amt)||amt<=0) return ctx.reply('Число:');
  const cl = ctx.session.data.client, emp = ctx.session.employee;
  const nb = (cl.баланс_ткоинов||0) + amt;
  await supabase.from('транзакции_ткоинов').insert({
    клиент_id: cl.id, тип: 'Пополнение', сумма: amt,
    баланс_до: cl.баланс_ткоинов||0, баланс_после: nb,
    причина: `Пополнение ${emp.имя}`, сотрудник_id: emp.id,
  });
  await supabase.from('клиенты').update({ баланс_ткоинов: nb }).eq('id', cl.id);
  ctx.session.state = null; ctx.session.data = {};
  await ctx.reply(`✅ +${amt} тк | Баланс: ${nb}`, { reply_markup: getKB(emp.роль) });
});

// =============================================
// 📊 СЕГОДНЯ
// =============================================
bot.hears('📊 Сегодня', async (ctx) => {
  const emp = ctx.session.employee;
  const { data: orders } = await supabase.from('заказы')
    .select('итоговая_сумма, сумма_нал, сумма_безнал, позиции_в_заказах(количество)')
    .eq('продавец_id', emp.id).gte('дата_создания', today()+'T00:00:00');

  if (!orders?.length) return ctx.reply('📊 Сегодня продаж нет');
  const tot = orders.reduce((s,o) => s + (o.итоговая_сумма||0), 0);
  const cn = orders.reduce((s,o) => s + (o.позиции_в_заказах||[]).reduce((ss,p) => ss+(p.количество||0),0), 0);
  const ca = orders.reduce((s,o) => s + (o.сумма_нал||0), 0);
  const cd = orders.reduce((s,o) => s + (o.сумма_безнал||0), 0);
  await ctx.reply(`📊 Сегодня: ${orders.length} продаж\n📦 ${cn} банок\n💰 ${tot}₽\n💵 ${ca}₽ | 💳 ${cd}₽`);
});

// =============================================
// 📈 ТОП ПРОДАЖ (Владелец) — день + неделя по всем точкам
// =============================================
bot.hears('📈 Топ продаж', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;

  const weekAgo = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];

  const { data: dayData } = await supabase.from('позиции_в_заказах')
    .select('количество, товары(название), заказы!inner(дата_создания, статус)')
    .gte('заказы.дата_создания', today()+'T00:00:00').eq('заказы.статус', 'Завершён');

  const { data: weekData } = await supabase.from('позиции_в_заказах')
    .select('количество, товары(название), заказы!inner(дата_создания, статус)')
    .gte('заказы.дата_создания', weekAgo+'T00:00:00').eq('заказы.статус', 'Завершён');

  function top(rows) {
    const m = {};
    (rows||[]).forEach(r => { const n = r.товары?.название||'?'; m[n] = (m[n]||0) + (r.количество||0); });
    return Object.entries(m).sort((a,b) => b[1]-a[1]).slice(0,10);
  }

  const dt = top(dayData), wt = top(weekData);
  let t = '📈 ТОП ПРОДАЖ (все точки)\n\n📅 Сегодня:\n';
  if (dt.length) dt.forEach(([n,c],i) => { t += `${i+1}. ${n.substring(0,30)} — ${c}\n`; });
  else t += 'Нет данных\n';
  t += '\n📅 За неделю:\n';
  if (wt.length) wt.forEach(([n,c],i) => { t += `${i+1}. ${n.substring(0,30)} — ${c}\n`; });
  else t += 'Нет данных\n';
  await ctx.reply(t);
});

// =============================================
// 📊 СТАТИСТИКА (Владелец) — выручка по точкам, смены
// =============================================
bot.hears('📊 Статистика', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;

  const { data: orders } = await supabase.from('заказы')
    .select('итоговая_сумма, сумма_нал, сумма_безнал, точки(название)')
    .eq('статус', 'Завершён').gte('дата_создания', today()+'T00:00:00');

  const { data: shifts } = await supabase.from('смены')
    .select('статус, банок_продано, выручка_общая, сотрудники(имя), точки(название)')
    .eq('дата', today());

  const rev = (orders||[]).reduce((s,o) => s+(o.итоговая_сумма||0), 0);
  const ca = (orders||[]).reduce((s,o) => s+(o.сумма_нал||0), 0);
  const cd = (orders||[]).reduce((s,o) => s+(o.сумма_безнал||0), 0);

  const byPt = {};
  (orders||[]).forEach(o => { const p = o.точки?.название||'?'; byPt[p] = (byPt[p]||0)+(o.итоговая_сумма||0); });

  let t = `📊 ${today()}\n\n💰 ${rev}₽ (💵${ca} / 💳${cd})\n📋 ${(orders||[]).length} заказов\n\n🏪 По точкам:\n`;
  Object.entries(byPt).sort((a,b)=>b[1]-a[1]).forEach(([p,s]) => { t += `  ${p}: ${s}₽\n`; });
  t += '\n👥 Смены:\n';
  (shifts||[]).forEach(s => {
    t += `  ${s.сотрудники?.имя||'?'} (${s.точки?.название||'?'}) ${s.статус}`;
    if (s.банок_продано) t += ` | ${s.банок_продано} бан | ${s.выручка_общая||0}₽`;
    t += '\n';
  });
  await ctx.reply(t);
});

// =============================================
// 💸 УДЕРЖАНИЯ (Владелец)
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
  let t = '💸 Активные:\n\n';
  uds.forEach(u => {
    const left = (u.сумма_общая||u.сумма) - ((u.сумма_за_смену||0)*(u.погашено_смен||0));
    t += `👤 ${u.сотрудники?.имя||'?'} | ${u.причина}\n   ${u.сумма_общая||u.сумма}₽ | Ост: ${left}₽\n\n`;
  });
  await ctx.editMessageText(t); await ctx.answerCallbackQuery();
});

bot.callbackQuery('ud_new', async (ctx) => {
  const { data: emps } = await supabase.from('сотрудники').select('id, имя').eq('активен', true).neq('роль', 'Владелец');
  const kb = new InlineKeyboard();
  (emps||[]).forEach(e => kb.text(e.имя, `ude_${e.id}`).row());
  await ctx.editMessageText('На кого?', { reply_markup: kb }); await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^ude_(\d+)$/, async (ctx) => {
  ctx.session.data.udEmp = parseInt(ctx.match[1]); ctx.session.state = 'ud_reason';
  await ctx.editMessageText('Причина:'); await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'ud_reason', async (ctx) => {
  ctx.session.data.udReason = ctx.message.text; ctx.session.state = 'ud_sum';
  await ctx.reply('Сумма (₽):');
});

bot.on('message:text').filter(c => c.session.state === 'ud_sum', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<=0) return ctx.reply('Сумма:');
  ctx.session.data.udSum = n; ctx.session.state = 'ud_shifts';
  await ctx.reply('За сколько смен погасить?');
});

bot.on('message:text').filter(c => c.session.state === 'ud_shifts', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n)||n<1) return ctx.reply('Число:');
  const d = ctx.session.data;
  await supabase.from('удержания').insert({
    сотрудник_id: d.udEmp, причина: d.udReason, сумма: d.udSum, сумма_общая: d.udSum,
    смен_для_погашения: n, сумма_за_смену: Math.ceil(d.udSum/n), погашено_смен: 0,
    статус: 'Активно', назначил_id: ctx.session.employee.id,
  });
  ctx.session.state = null; ctx.session.data = {};
  await ctx.reply(`✅ Удержание: ${d.udSum}₽ за ${n} смен`, { reply_markup: getKB(ctx.session.employee.роль) });
});

// =============================================
// 📦 ПОСТУПЛЕНИЕ (Владелец / Редактор)
// =============================================
bot.hears('📦 Поступление', async (ctx) => {
  if (!isManager(ctx.session.employee)) return;
  const { data: pts } = await supabase.from('точки').select('id, название').eq('активна', true);
  const kb = new InlineKeyboard();
  (pts||[]).forEach(p => kb.text(p.название, `rcpt_${p.id}`).row());
  ctx.session.data = { recvItems: [] };
  await ctx.reply('📦 Поступление — на какую точку?', { reply_markup: kb });
});

bot.callbackQuery(/^rcpt_(\d+)$/, async (ctx) => {
  ctx.session.data.rcPt = parseInt(ctx.match[1]);
  const { data: pt } = await supabase.from('точки').select('название').eq('id', ctx.session.data.rcPt).single();
  ctx.session.data.rcPtName = pt?.название;
  ctx.session.state = 'rc_search';
  await ctx.editMessageText(`📦 → ${pt?.название}\n\nВведите название товара:`);
  await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'rc_search', async (ctx) => {
  const { data: prods } = await supabase.from('товары').select('id, название')
    .ilike('название', `%${ctx.message.text.trim()}%`).eq('активен', true).limit(10);
  if (!prods?.length) return ctx.reply('Не найдено. Ещё:');
  const kb = new InlineKeyboard();
  prods.forEach(p => kb.text(p.название.substring(0,35), `rcp_${p.id}`).row());
  kb.text('✅ Готово', 'rc_done');
  await ctx.reply('Выберите:', { reply_markup: kb });
});

bot.callbackQuery(/^rcp_(\d+)$/, async (ctx) => {
  ctx.session.data.rcProd = parseInt(ctx.match[1]);
  const { data: p } = await supabase.from('товары').select('название').eq('id', ctx.session.data.rcProd).single();
  ctx.session.data.rcProdName = p?.название;
  ctx.session.state = 'rc_qty';
  await ctx.editMessageText(`📦 ${p?.название}\nКоличество:`); await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'rc_qty', async (ctx) => {
  const qty = parseInt(ctx.message.text); if (isNaN(qty)||qty<1) return ctx.reply('Число:');
  const d = ctx.session.data;
  const { data: inv } = await supabase.from('инвентарь').select('id, количество')
    .eq('товар_id', d.rcProd).eq('точка_id', d.rcPt).single();
  if (inv) await supabase.from('инвентарь').update({ количество: inv.количество+qty, последнее_обновление: new Date().toISOString() }).eq('id', inv.id);
  else await supabase.from('инвентарь').insert({ товар_id: d.rcProd, точка_id: d.rcPt, количество: qty });

  await supabase.from('движения').insert({
    товар_id: d.rcProd, точка_куда_id: d.rcPt, тип_операции: 'Поступление',
    количество: qty, сотрудник_id: ctx.session.employee.id, комментарий: `→ ${d.rcPtName}`,
  });
  d.recvItems.push({ name: d.rcProdName, qty });
  ctx.session.state = 'rc_search';
  const kb = new InlineKeyboard().text('✅ Готово', 'rc_done');
  await ctx.reply(`✅ +${qty} ${d.rcProdName}\n\nЕщё товар или:`, { reply_markup: kb });
});

bot.callbackQuery('rc_done', async (ctx) => {
  const items = ctx.session.data.recvItems||[];
  let t = `📦 Поступление на ${ctx.session.data.rcPtName}:\n\n`;
  items.forEach(i => { t += `• ${i.name.substring(0,30)} — ${i.qty}\n`; });
  if (!items.length) t += 'Пусто';
  ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText(t); await ctx.answerCallbackQuery();
});

// =============================================
// 🔄 ПЕРЕМЕЩЕНИЕ (Владелец / Редактор)
// =============================================
bot.hears('🔄 Перемещение', async (ctx) => {
  if (!isManager(ctx.session.employee)) return;
  const { data: pts } = await supabase.from('точки').select('id, название').eq('активна', true);
  const kb = new InlineKeyboard();
  (pts||[]).forEach(p => kb.text(p.название, `mvf_${p.id}`).row());
  ctx.session.data = { mvItems: [] };
  await ctx.reply('🔄 Перемещение — ОТКУДА?', { reply_markup: kb });
});

bot.callbackQuery(/^mvf_(\d+)$/, async (ctx) => {
  ctx.session.data.mvFrom = parseInt(ctx.match[1]);
  const { data: pt } = await supabase.from('точки').select('название').eq('id', ctx.session.data.mvFrom).single();
  ctx.session.data.mvFromName = pt?.название;
  const { data: pts } = await supabase.from('точки').select('id, название').eq('активна', true).neq('id', ctx.session.data.mvFrom);
  const kb = new InlineKeyboard();
  (pts||[]).forEach(p => kb.text(p.название, `mvt_${p.id}`).row());
  await ctx.editMessageText(`${pt?.название} → ?\n\nКУДА?`, { reply_markup: kb }); await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^mvt_(\d+)$/, async (ctx) => {
  ctx.session.data.mvTo = parseInt(ctx.match[1]);
  const { data: pt } = await supabase.from('точки').select('название').eq('id', ctx.session.data.mvTo).single();
  ctx.session.data.mvToName = pt?.название;
  ctx.session.state = 'mv_search';
  await ctx.editMessageText(`🔄 ${ctx.session.data.mvFromName} → ${pt?.название}\n\nНазвание товара:`); await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'mv_search', async (ctx) => {
  const { data: prods } = await supabase.from('товары').select('id, название')
    .ilike('название', `%${ctx.message.text.trim()}%`).eq('активен', true).limit(10);
  if (!prods?.length) return ctx.reply('Не найдено. Ещё:');
  const kb = new InlineKeyboard();
  prods.forEach(p => kb.text(p.название.substring(0,35), `mvp_${p.id}`).row());
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
  await ctx.editMessageText(`📦 ${p?.название}\n📍 ${d.mvFromName}: ${inv?.количество||0} шт\n\nСколько?`);
  await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'mv_qty', async (ctx) => {
  const qty = parseInt(ctx.message.text); if (isNaN(qty)||qty<1) return ctx.reply('Число:');
  const d = ctx.session.data;

  const { data: from } = await supabase.from('инвентарь').select('id, количество')
    .eq('товар_id', d.mvProd).eq('точка_id', d.mvFrom).single();
  if (from) await supabase.from('инвентарь').update({ количество: Math.max(0, from.количество-qty), последнее_обновление: new Date().toISOString() }).eq('id', from.id);

  const { data: to } = await supabase.from('инвентарь').select('id, количество')
    .eq('товар_id', d.mvProd).eq('точка_id', d.mvTo).single();
  if (to) await supabase.from('инвентарь').update({ количество: to.количество+qty, последнее_обновление: new Date().toISOString() }).eq('id', to.id);
  else await supabase.from('инвентарь').insert({ товар_id: d.mvProd, точка_id: d.mvTo, количество: qty });

  await supabase.from('движения').insert({
    товар_id: d.mvProd, точка_откуда_id: d.mvFrom, точка_куда_id: d.mvTo,
    тип_операции: 'Перемещение', количество: qty,
    сотрудник_id: ctx.session.employee.id, комментарий: `${d.mvFromName} → ${d.mvToName}`,
  });

  d.mvItems.push({ name: d.mvProdName, qty });
  ctx.session.state = 'mv_search';
  const kb = new InlineKeyboard().text('✅ Готово', 'mv_done');
  await ctx.reply(`✅ ${d.mvProdName} ×${qty}: ${d.mvFromName} → ${d.mvToName}\n\nЕщё или:`, { reply_markup: kb });
});

bot.callbackQuery('mv_done', async (ctx) => {
  const d = ctx.session.data;
  let t = `🔄 ${d.mvFromName} → ${d.mvToName}:\n\n`;
  (d.mvItems||[]).forEach(i => { t += `• ${i.name.substring(0,30)} — ${i.qty}\n`; });
  ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText(t); await ctx.answerCallbackQuery();
});

// =============================================
// 💸 РАСХОД
// =============================================
bot.hears('💸 Расход', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.state = 'ex_desc';
  await ctx.reply('Описание расхода:', { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(c => c.session.state === 'ex_desc', async (ctx) => {
  ctx.session.data.exDesc = ctx.message.text; ctx.session.state = 'ex_sum';
  await ctx.reply('Сумма (₽):');
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
  await ctx.reply(`✅ ${n}₽ — ${desc}`, { reply_markup: getKB(emp.роль) });
});

// =============================================
// ↩️ ВОЗВРАТ
// =============================================
bot.hears('↩️ Возврат', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Сначала откройте смену!');
  ctx.session.state = 'rt_reason'; ctx.session.data = {};
  await ctx.reply('Причина возврата:', { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(c => c.session.state === 'rt_reason', async (ctx) => {
  ctx.session.data.rtReason = ctx.message.text; ctx.session.state = 'rt_ph1';
  await ctx.reply('📷 Фото упаковки (1/3):');
});

bot.on('message:photo').filter(
  c => ['rt_ph1','rt_ph2','rt_ph3'].includes(c.session.state),
  async (ctx) => {
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
    await ctx.reply('✅ Возврат на рассмотрении!', { reply_markup: getKB(emp.роль) });
  }
);

// =============================================
// 🆘 SOS
// =============================================
bot.hears('🆘 SOS', async (ctx) => {
  const emp = ctx.session.employee;
  await supabase.from('sos_сигналы').insert({ сотрудник_id: emp.id, точка_id: emp.точка_id, тип: 'Проверка', сообщение: `SOS ${emp.имя}` });
  const { data: mgrs } = await supabase.from('сотрудники').select('telegram_id').in('роль', ['Редактор','Владелец']).eq('активен', true);
  for (const m of (mgrs||[])) { try { await bot.api.sendMessage(m.telegram_id, `🚨🚨🚨 SOS!\n${emp.имя} • ${emp.точки?.название||'?'}\n${new Date().toLocaleTimeString('ru-RU')}`); } catch {} }
  await ctx.reply('🚨 SOS отправлен!');
});

// =============================================
// 📋 ЗАКАЗЫ (из Mini App)
// =============================================
bot.hears('📋 Заказы', async (ctx) => {
  const emp = ctx.session.employee;
  const filter = emp.точка_id ? { точка_id: emp.точка_id } : {};
  const { data: orders } = await supabase.from('заказы').select('*, клиенты(имя, уникальный_номер)')
    .match(filter).in('статус', ['Новый','Подтверждён','Готов']).order('дата_создания').limit(10);
  if (!orders?.length) return ctx.reply('✅ Нет заказов');
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
  if (ctx.match[1]==='d') upd.время_выдачи = new Date().toISOString();
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
  tasks.forEach(tk => { t += `${tk.статус==='Новая'?'🆕':'🔄'} ${tk.описание}\nСрок: ${tk.срок?new Date(tk.срок).toLocaleDateString('ru-RU'):'—'}\n\n`; });
  await ctx.reply(t);
});

// =============================================
// 👥 СОТРУДНИКИ + ➕ СОТРУДНИК (Владелец)
// =============================================
bot.hears('👥 Сотрудники', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;
  const { data: emps } = await supabase.from('сотрудники').select('*, точки(название)').eq('активен', true).order('роль');
  const em = { 'Продавец':'🏪','Курьер':'🚗','Редактор':'✏️','Бухгалтер':'📊','Владелец':'👑' };
  let t = `👥 Сотрудники (${(emps||[]).length}):\n\n`;
  (emps||[]).forEach(e => { t += `${em[e.роль]||'👤'} ${e.имя} — ${e.роль}\n   ${e.точки?.название||'—'} | ${e.telegram_id}\n\n`; });
  await ctx.reply(t);
});

bot.hears('➕ Сотрудник', async (ctx) => {
  if (ctx.session.employee?.роль !== 'Владелец') return;
  ctx.session.state = 'ae_tg';
  await ctx.reply('Telegram ID:', { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(c => c.session.state === 'ae_tg', async (ctx) => {
  const id = parseInt(ctx.message.text); if (isNaN(id)) return ctx.reply('Число:');
  ctx.session.data.aeTg = id; ctx.session.state = 'ae_name';
  await ctx.reply('Имя:');
});

bot.on('message:text').filter(c => c.session.state === 'ae_name', async (ctx) => {
  ctx.session.data.aeName = ctx.message.text; ctx.session.state = 'ae_role';
  const kb = new InlineKeyboard()
    .text('🏪 Продавец', 'ar_Продавец').text('🚗 Курьер', 'ar_Курьер').row()
    .text('✏️ Редактор', 'ar_Редактор').text('📊 Бухгалтер', 'ar_Бухгалтер');
  await ctx.reply('Роль:', { reply_markup: kb });
});

bot.callbackQuery(/^ar_(.+)$/, async (ctx) => {
  ctx.session.data.aeRole = ctx.match[1]; ctx.session.state = 'ae_pt';
  const { data: pts } = await supabase.from('точки').select('id, название').eq('активна', true);
  const kb = new InlineKeyboard();
  (pts||[]).forEach(p => kb.text(p.название, `ap_${p.id}`).row());
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
  await ctx.editMessageText(`✅ ${d.aeName} — ${d.aeRole}\nТеперь /start в боте`);
  await ctx.answerCallbackQuery('Добавлен!');
});

// =============================================
// 🔒 ЗАКРЫТЬ СМЕНУ
// =============================================
bot.hears('🔒 Закрыть смену', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Смена не открыта!');
  ctx.session.state = 'sc_cans';
  await ctx.reply('🔒 Закрытие\n\nБанок на конец?', { reply_markup: { remove_keyboard: true } });
});

bot.on('message:text').filter(c => c.session.state === 'sc_cans', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('Число:');
  ctx.session.data.ecans = n; ctx.session.state = 'sc_soda';
  await ctx.reply('Газировок на конец?');
});

bot.on('message:text').filter(c => c.session.state === 'sc_soda', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('Число:');
  ctx.session.data.esoda = n; ctx.session.state = 'sc_cash';
  await ctx.reply('Наличных в кассе?');
});

bot.on('message:text').filter(c => c.session.state === 'sc_cash', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('Сумма:');
  ctx.session.data.ecash = n; ctx.session.state = 'sc_term';
  await ctx.reply('Сумма по терминалу?');
});

bot.on('message:text').filter(c => c.session.state === 'sc_term', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('Сумма:');
  ctx.session.data.eterm = n;
  const kb = new InlineKeyboard().text('✅ Да', 'cl_y').text('❌ Нет', 'cl_n');
  await ctx.reply('Уборка выполнена?', { reply_markup: kb });
});

bot.callbackQuery(/^cl_(y|n)$/, async (ctx) => {
  const cl = ctx.match[1] === 'y';
  const emp = ctx.session.employee, sh = ctx.session.shift, d = ctx.session.data;
  const sold = (sh.банки_начало||0) - d.ecans;
  const short = sold - (sh.банок_продано||0);
  const pct = calcSalaryPercent(sh.банок_продано||0);
  const sal = Math.round((emp.зп_база||2000) + ((sh.выручка_общая||0)*pct/100));

  await supabase.from('смены').update({
    время_закрытия: new Date().toISOString(), время_закрытия_факт: new Date().toISOString(),
    статус: 'Закрыта', банки_конец: d.ecans, газировка_конец: d.esoda,
    нал_конец: d.ecash, терминал_сумма: d.eterm, уборка_выполнена: cl,
    недостача_банки: Math.max(0, short), процент_зп: pct, зп_за_смену: sal,
  }).eq('id', sh.id);

  const report =
    `🔒 Смена закрыта!\n\n📅 ${today()}\n📦 Продано: ${sh.банок_продано||0}\n` +
    `💰 ${sh.выручка_общая||0}₽\n💵 ${d.ecash}₽ нал | 🏧 ${d.eterm}₽ терм\n` +
    (short>0?`⚠️ Недостача: ${short} бан\n`:'') +
    `\n💵 ЗП: ${sal}₽ (${emp.зп_база||2000} + ${pct}%)\n🧹 ${cl?'✅':'❌'}`;

  ctx.session.shift = null; ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText(report);
  if (OWNER_ID && emp.telegram_id !== OWNER_ID) { try { await bot.api.sendMessage(OWNER_ID, `📋 ${emp.имя} (${emp.точки?.название||'?'})\n${report}`); } catch {} }
  await ctx.answerCallbackQuery('Закрыта');
});

// =============================================
// РАЗДЕЛИТЕЛЬ + FALLBACK
// =============================================
bot.hears('─────────────', () => {});
bot.on('message:text', async (ctx) => {
  if (ctx.session.state) return ctx.reply('⚠️ Неверный ввод. /start для сброса.');
});

// =============================================
// ЗАПУСК
// =============================================
bot.catch((err) => console.error('Bot error:', err));
bot.start({ onStart: () => console.log('🤖 TTS Staff Bot v2!') });
