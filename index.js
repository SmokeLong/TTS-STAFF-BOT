require('dotenv').config();
const { Bot, session, InlineKeyboard, Keyboard } = require('grammy');
const { createClient } = require('@supabase/supabase-js');

const bot = new Bot(process.env.STAFF_BOT_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const OWNER_ID = Number(process.env.OWNER_TELEGRAM_ID);

bot.use(session({
  initial: () => ({ state: null, data: {}, employee: null, shift: null }),
}));

// =============================================
// СКИДКИ ЗА ОБЪЁМ
// =============================================
function volumeDiscount(totalCans) {
  if (totalCans >= 10) return { per: 80, gift: '🎁 + шайба' };
  if (totalCans >= 7) return { per: 60, gift: '🎁 + шайба' };
  if (totalCans >= 5) return { per: 50, gift: '🎁 + шайба' };
  if (totalCans >= 2) return { per: 30, gift: '' };
  return { per: 0, gift: '' };
}

// =============================================
// КЛАВИАТУРЫ
// =============================================
function sellerKB(hasShift) {
  if (!hasShift) return new Keyboard().text('📂 Открыть смену').row().text('📋 Завершённые').text('📝 Задачи').resized();
  return new Keyboard()
    .text('➕ Продажа').text('📋 Заказы').row()
    .text('↩️ Возврат').text('📊 Сегодня').row()
    .text('💸 Расход').text('🎁 Себе').row()
    .text('💼 Инкассация').text('🆘 SOS').row()
    .text('📋 Завершённые').text('📝 Задачи').row()
    .text('🔒 Закрыть смену').resized();
}

function ownerKB(hasShift) {
  const kb = new Keyboard();
  if (!hasShift) kb.text('📂 Открыть смену').row();
  else {
    kb.text('➕ Продажа').text('📋 Заказы').row()
      .text('↩️ Возврат').text('💸 Расход').row()
      .text('🎁 Себе').text('💼 Инкассация').row()
      .text('🔒 Закрыть смену').text('🆘 SOS').row();
  }
  kb.text('─── Управление ───').row()
    .text('📈 Топ продаж').text('📊 Статистика').row()
    .text('📋 Завершённые').text('📊 Сегодня').row()
    .text('👥 Сотрудники').text('➕👤 Сотрудник').row()
    .text('💸 Удержания').text('📦 Поступление').row()
    .text('🔄 Перемещение').text('📝 Задачи').resized();
  return kb;
}

function getKB(emp, shift) {
  if (emp.роль === 'Владелец') return ownerKB(!!shift);
  if (emp.роль === 'Редактор') return new Keyboard()
    .text('📦 Поступление').text('🔄 Перемещение').row()
    .text('📋 Заказы').text('📋 Завершённые').row()
    .text('📊 Сегодня').text('📝 Задачи').resized();
  return sellerKB(!!shift);
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
function timeStr() { return new Date().toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' }); }
function isSeller(e) { return ['Продавец','Владелец'].includes(e?.роль); }
function isManager(e) { return ['Владелец','Редактор'].includes(e?.роль); }
function calcSalaryPercent(cans) {
  if (cans>=120) return 6.5; if (cans>=110) return 6; if (cans>=100) return 5.5;
  if (cans>=90) return 5; if (cans>=80) return 4.5; if (cans>=70) return 4;
  if (cans>=55) return 3.5; if (cans>=40) return 2.5; return 0;
}

// =============================================
// /start /id /register_owner
// =============================================
bot.command('id', (ctx) => ctx.reply(`Ваш Telegram ID: ${ctx.from.id}`));

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
  await ctx.reply('📂 Открытие смены\n\n📦 Банок на начало?', { reply_markup: { remove_keyboard: true } });
});

bot.callbackQuery(/^shpt_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  const { data: pt } = await supabase.from('точки').select('название').eq('id', id).single();
  ctx.session.employee.точка_id = id; ctx.session.employee.точки = pt;
  ctx.session.state = 'sh_cans'; ctx.session.data = {};
  await ctx.editMessageText(`🏪 ${pt?.название}\n\n📦 Банок на начало?`);
  await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c => c.session.state === 'sh_cans', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('Число:');
  ctx.session.data.cans = n; ctx.session.state = 'sh_soda';
  await ctx.reply('🥤 Газировок?');
});
bot.on('message:text').filter(c => c.session.state === 'sh_soda', async (ctx) => {
  const n = parseInt(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('Число:');
  ctx.session.data.soda = n; ctx.session.state = 'sh_cash';
  await ctx.reply('💵 Наличных в кассе?');
});
bot.on('message:text').filter(c => c.session.state === 'sh_cash', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<0) return ctx.reply('Сумма:');
  const emp = ctx.session.employee;
  const { data: shift, error } = await supabase.from('смены').insert({
    сотрудник_id: emp.id, точка_id: emp.точка_id, дата: today(),
    время_открытия: now(), статус: 'Открыта',
    банки_начало: ctx.session.data.cans, газировка_начало: ctx.session.data.soda, нал_начало: n,
  }).select().single();
  if (error) return ctx.reply(`❌ ${error.message}`);
  ctx.session.shift = shift; ctx.session.state = null; ctx.session.data = {};
  await ctx.reply(
    `✅ Смена открыта!\n📅 ${today()} ${timeStr()}\n🏪 ${emp.точки?.название||''}\n📦 ${shift.банки_начало} | 🥤 ${shift.газировка_начало} | 💵 ${n}₽`,
    { reply_markup: getKB(emp, shift) });
});

// =============================================
// ➕ ПРОДАЖА — Марка → Линейка → Вкус → Кол-во → Оплата → Клиент
// Автоматическая скидка за объём
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
  brands.forEach(b => { kb.text(`📦 ${b}`, `${p}b_${encodeURIComponent(b)}`).row(); });
  kb.text('❌ Отмена', `${p}_cx`);
  const title = p === 'ts' ? '🎁 Марка:' : '🛒 Марка:';
  try { if (ctx.callbackQuery) { await ctx.editMessageText(title, { reply_markup: kb }); await ctx.answerCallbackQuery(); return; } }
  catch {}
  await ctx.reply(title, { reply_markup: kb });
}

// Бренд → линейки
bot.callbackQuery(/^(s|ts)b_(.+)$/, async (ctx) => {
  const p = ctx.match[1], brand = decodeURIComponent(ctx.match[2]);
  ctx.session.data.brand = brand;
  const { data } = await supabase.from('товары').select('линейка').eq('бренд', brand).eq('активен', true);
  const lines = [...new Set((data||[]).map(x => x.линейка).filter(Boolean))].sort();
  ctx.session.data.lines = lines;
  const kb = new InlineKeyboard();
  lines.forEach(l => { kb.text(`📋 ${l}`, `${p}l_${encodeURIComponent(l)}`).row(); });
  kb.text('⬅️ Марки', `${p}_tobr`).row().text('❌ Отмена', `${p}_cx`);
  await ctx.editMessageText(`📦 ${brand}\n\nЛинейка:`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

// Линейка → вкусы
bot.callbackQuery(/^(s|ts)l_(.+)$/, async (ctx) => {
  const p = ctx.match[1], line = decodeURIComponent(ctx.match[2]);
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
    kb.text(`🔹 ${(pr.вкус||pr.название||'?').substring(0,35)} — ${pr.цена_безнал}₽`, `${p}f_${pr.id}`).row();
  });
  kb.text('⬅️ Линейки', `${p}_toln`).text('⬅️ Марки', `${p}_tobr`).row();
  kb.text('🏠 Меню', `${p}_mn`).text('❌ Отмена', `${p}_cx`);
  try { await ctx.editMessageText(`📦 ${brand} • ${line}\n\nВкус:`, { reply_markup: kb }); }
  catch { await ctx.reply(`📦 ${brand} • ${line}\n\nВкус:`, { reply_markup: kb }); }
  if (ctx.callbackQuery) try { await ctx.answerCallbackQuery(); } catch {}
}

// Вкус → кол-во (для продажи) / запись (для себе)
bot.callbackQuery(/^(s|ts)f_(\d+)$/, async (ctx) => {
  const p = ctx.match[1], id = parseInt(ctx.match[2]);
  const { data: product } = await supabase.from('товары').select('*').eq('id', id).single();
  if (!product) return ctx.answerCallbackQuery('Не найден');
  ctx.session.data.curProduct = product;

  if (p === 'ts') {
    const shift = ctx.session.shift;
    const val = shift?.товар_себе ? `${shift.товар_себе}, ${product.название}` : product.название;
    await supabase.from('смены').update({ товар_себе: val }).eq('id', shift.id);
    shift.товар_себе = val;
    const kb = new InlineKeyboard().text('🎁 Ещё', 'ts_tobr').text('🏠 Меню', 'ts_mn');
    await ctx.editMessageText(`✅ ${product.название}\n\nСебе: ${val}`, { reply_markup: kb });
    return ctx.answerCallbackQuery('Записано!');
  }

  const kb = new InlineKeyboard();
  for (let i = 1; i <= 5; i++) kb.text(`${i}`, `sq_${i}`);
  kb.row();
  for (let i = 6; i <= 10; i++) kb.text(`${i}`, `sq_${i}`);
  kb.row();
  kb.text('⬅️ Вкусы', 's_tofl').text('⬅️ Марки', 's_tobr').row();
  kb.text('❌ Отмена', 's_cx');
  await ctx.editMessageText(
    `📦 ${product.название}\n💰 ${product.цена_безнал}₽\n\nКоличество:`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

// Количество → в корзину → показать корзину
bot.callbackQuery(/^sq_(\d+)$/, async (ctx) => {
  const qty = parseInt(ctx.match[1]);
  const pr = ctx.session.data.curProduct;
  if (!pr) return ctx.answerCallbackQuery('Ошибка');
  ctx.session.data.items.push({ product: pr, qty, price: pr.цена_безнал, time: timeStr() });
  await showCart(ctx);
  await ctx.answerCallbackQuery('✅ Добавлено!');
});

async function showCart(ctx) {
  const items = ctx.session.data.items;
  const totalCans = items.reduce((s, i) => s + i.qty, 0);
  const rawTotal = items.reduce((s, i) => s + (i.price * i.qty), 0);
  const disc = volumeDiscount(totalCans);
  const discountTotal = disc.per * totalCans;
  const finalTotal = rawTotal - discountTotal;

  let cart = items.map((it, i) =>
    `${i+1}. ${(it.product.вкус||it.product.название).substring(0,28)} ×${it.qty} = ${it.price * it.qty}₽ (${it.time})`
  ).join('\n');

  cart += `\n\n📦 Всего банок: ${totalCans}`;
  if (disc.per > 0) {
    cart += `\n🏷 Скидка: -${disc.per}₽ × ${totalCans} = -${discountTotal}₽`;
    cart += `\n💰 Было: ${rawTotal}₽ → Итого: ${finalTotal}₽`;
  } else {
    cart += `\n💰 Итого: ${finalTotal}₽`;
  }
  if (disc.gift) cart += `\n${disc.gift}`;

  const kb = new InlineKeyboard()
    .text('➕ Ещё (эта линейка)', 's_tofl').row()
    .text('⬅️ Линейки', 's_toln').text('⬅️ Марки', 's_tobr').row()
    .text('✅ Оформить', 'sale_go').row()
    .text('🗑 Убрать последний', 'sale_dellast').row()
    .text('❌ Отменить', 's_cx');

  try { await ctx.editMessageText(`🛒 Корзина:\n${cart}`, { reply_markup: kb }); }
  catch { await ctx.reply(`🛒 Корзина:\n${cart}`, { reply_markup: kb }); }
}

bot.callbackQuery('sale_dellast', async (ctx) => {
  if (ctx.session.data.items?.length) ctx.session.data.items.pop();
  if (!ctx.session.data.items?.length) {
    await ctx.editMessageText('🛒 Корзина пуста');
    return showBrands(ctx, 's');
  }
  await showCart(ctx);
  await ctx.answerCallbackQuery('Удалено');
});

// Оформить → оплата
bot.callbackQuery('sale_go', async (ctx) => {
  const items = ctx.session.data.items;
  const totalCans = items.reduce((s, i) => s + i.qty, 0);
  const rawTotal = items.reduce((s, i) => s + (i.price * i.qty), 0);
  const disc = volumeDiscount(totalCans);
  const final = rawTotal - (disc.per * totalCans);

  const kb = new InlineKeyboard()
    .text(`💵 Нал ${final}₽`, 'spay_cash')
    .text(`💳 Безнал ${final}₽`, 'spay_card').row()
    .text('⬅️ Назад', 'sale_backcart');
  await ctx.editMessageText(`💰 Итого: ${final}₽\n\nТип оплаты:`, { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery('sale_backcart', async (ctx) => {
  await showCart(ctx); await ctx.answerCallbackQuery();
});

// Оплата → клиент
bot.callbackQuery(/^spay_(cash|card)$/, async (ctx) => {
  ctx.session.data.payType = ctx.match[1] === 'cash' ? 'Наличные' : 'Безналичные';
  ctx.session.state = 'sale_client';
  const kb = new InlineKeyboard()
    .text('⏩ Без клиента', 'sale_nocl').row()
    .text('⬅️ Назад', 'sale_go');
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
    return ctx.reply(`❌ "${code}" не найден.`, { reply_markup: kb });
  }
  ctx.session.data.client = cl;
  await ctx.reply(`✅ ${cl.имя||code}`);
  await finishSale(ctx);
});

async function finishSale(ctx) {
  const emp = ctx.session.employee, shift = ctx.session.shift;
  const items = ctx.session.data.items, client = ctx.session.data.client;
  const payType = ctx.session.data.payType || 'Безналичные';
  const totalCans = items.reduce((s, i) => s + i.qty, 0);
  const rawTotal = items.reduce((s, i) => s + (i.price * i.qty), 0);
  const disc = volumeDiscount(totalCans);
  const discountTotal = disc.per * totalCans;
  const grand = rawTotal - discountTotal;
  const cash = payType === 'Наличные' ? grand : 0;
  const card = payType === 'Безналичные' ? grand : 0;

  const { data: order, error } = await supabase.from('заказы').insert({
    клиент_id: client?.id || null, точка_id: emp.точка_id, статус: 'Завершён',
    тип_доставки: 'Самовывоз', тип_оплаты: payType,
    сумма_товаров: rawTotal, итоговая_сумма: grand,
    сумма_безнал: card, сумма_нал: cash, продавец_id: emp.id,
    товары_json: JSON.stringify(items.map(i => ({
      id: i.product.id, name: i.product.название, qty: i.qty, price: i.price, time: i.time
    }))),
    комментарий: discountTotal > 0 ? `Скидка ${disc.per}₽×${totalCans}=-${discountTotal}₽${disc.gift?' '+disc.gift:''}` : null,
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

  const nc = (shift.банок_продано||0) + totalCans;
  const nr = (shift.выручка_общая||0) + grand;
  await supabase.from('смены').update({
    банок_продано: nc, выручка_общая: nr,
    выручка_безнал: (shift.выручка_безнал||0) + card,
    выручка_нал_факт: (shift.выручка_нал_факт||0) + cash,
  }).eq('id', shift.id);
  shift.банок_продано = nc; shift.выручка_общая = nr;
  shift.выручка_безнал = (shift.выручка_безнал||0) + card;
  shift.выручка_нал_факт = (shift.выручка_нал_факт||0) + cash;

  ctx.session.state = null; ctx.session.data = {};

  let msg = `✅ ${order.номер_заказа} | ⏰ ${timeStr()}\n\n`;
  msg += items.map(i => `• ${i.product.название.substring(0,35)} ×${i.qty} = ${i.price*i.qty}₽`).join('\n');
  if (discountTotal > 0) msg += `\n\n🏷 Скидка: -${disc.per}₽ × ${totalCans} = -${discountTotal}₽`;
  if (disc.gift) msg += `\n${disc.gift}`;
  msg += `\n\n💰 ${grand}₽ ${payType==='Наличные'?'💵':'💳'}`;
  if (client) msg += `\n👤 ${client.имя||client.уникальный_номер}`;
  msg += `\n📦 За смену: ${nc} банок`;

  await ctx.reply(msg, { reply_markup: getKB(emp, shift) });
}

// =============================================
// НАВИГАЦИЯ
// =============================================
bot.callbackQuery(/^(s|ts)_tobr$/, async (ctx) => { await showBrands(ctx, ctx.match[1]); });
bot.callbackQuery(/^(s|ts)_toln$/, async (ctx) => {
  const p = ctx.match[1], brand = ctx.session.data.brand;
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
  await ctx.editMessageText('🏠');
  await ctx.reply('Меню:', { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
  await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^(s|ts)_cx$/, async (ctx) => {
  const p = ctx.match[1], items = ctx.session.data.items || [];
  if (!items.length) { ctx.session.state = null; ctx.session.data = {}; await ctx.editMessageText('❌ Отменено'); return ctx.answerCallbackQuery(); }
  const kb = new InlineKeyboard().text('✅ Да', `${p}_cxy`).text('↩️ Нет', `${p}_tobr`);
  await ctx.editMessageText(`⚠️ В корзине ${items.length}. Отменить?`, { reply_markup: kb }); await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^(s|ts)_cxy$/, async (ctx) => {
  ctx.session.state = null; ctx.session.data = {};
  await ctx.editMessageText('❌ Отменено');
  await ctx.reply('Меню:', { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
  await ctx.answerCallbackQuery();
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
// 📋 ЗАВЕРШЁННЫЕ (с редактированием / удалением)
// =============================================
bot.hears('📋 Завершённые', async (ctx) => {
  const emp = ctx.session.employee;
  const filter = emp.роль !== 'Владелец' && emp.точка_id ? { точка_id: emp.точка_id } : {};
  const { data: orders } = await supabase.from('заказы').select('*, точки(название)')
    .match(filter).eq('статус', 'Завершён')
    .gte('дата_создания', today()+'T00:00:00')
    .order('дата_создания', { ascending: false }).limit(20);
  if (!orders?.length) return ctx.reply('📋 Нет завершённых за сегодня');

  for (const o of orders.slice(0, 10)) {
    const time = new Date(o.дата_создания).toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    let items = '';
    try { const j = JSON.parse(o.товары_json); items = j.map(i => `${(i.name||'?').substring(0,25)} ×${i.qty}`).join(', '); } catch {}
    const kb = new InlineKeyboard()
      .text('✏️ Изменить', `oedit_${o.id}`).text('🗑 Удалить', `odel_${o.id}`);
    await ctx.reply(
      `📋 ${o.номер_заказа} | ${time}\n🏪 ${o.точки?.название||''}\n${items}\n💰 ${o.итоговая_сумма}₽ ${o.тип_оплаты}` +
      (o.комментарий?`\n📝 ${o.комментарий}`:''), { reply_markup: kb });
  }
  if (orders.length > 10) await ctx.reply(`...ещё ${orders.length - 10}`);
});

bot.callbackQuery(/^odel_(\d+)$/, async (ctx) => {
  const kb = new InlineKeyboard().text('✅ Да', `odelc_${ctx.match[1]}`).text('↩️ Нет', `odeln`);
  await ctx.editMessageText(ctx.msg.text + '\n\n⚠️ Удалить?', { reply_markup: kb }); await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^odelc_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  await supabase.from('позиции_в_заказах').delete().eq('заказ_id', id);
  await supabase.from('заказы').update({ статус: 'Удалён' }).eq('id', id);
  await ctx.editMessageText('🗑 Удалён'); await ctx.answerCallbackQuery('Удалён');
});
bot.callbackQuery('odeln', async (ctx) => { await ctx.answerCallbackQuery('Ок'); });

bot.callbackQuery(/^oedit_(\d+)$/, async (ctx) => {
  const id = ctx.match[1];
  const kb = new InlineKeyboard()
    .text('💰 Сумму', `oechg_${id}`).text('💳↔💵 Оплату', `oepay_${id}`).row()
    .text('📝 Комментарий', `oecom_${id}`);
  await ctx.editMessageText(ctx.msg.text + '\n\n✏️ Что изменить?', { reply_markup: kb }); await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^oepay_(\d+)$/, async (ctx) => {
  const id = parseInt(ctx.match[1]);
  const { data: o } = await supabase.from('заказы').select('тип_оплаты').eq('id', id).single();
  const nt = o?.тип_оплаты === 'Наличные' ? 'Безналичные' : 'Наличные';
  await supabase.from('заказы').update({ тип_оплаты: nt }).eq('id', id);
  await ctx.editMessageText(`✅ Оплата → ${nt}`); await ctx.answerCallbackQuery('Изменено');
});

bot.callbackQuery(/^oechg_(\d+)$/, async (ctx) => {
  ctx.session.state = 'oe_sum'; ctx.session.data.editId = parseInt(ctx.match[1]);
  await ctx.editMessageText('Новая сумма (₽):'); await ctx.answerCallbackQuery();
});
bot.on('message:text').filter(c => c.session.state === 'oe_sum', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<=0) return ctx.reply('Сумма:');
  await supabase.from('заказы').update({ итоговая_сумма: n }).eq('id', ctx.session.data.editId);
  ctx.session.state = null;
  await ctx.reply(`✅ Сумма → ${n}₽`, { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
});

bot.callbackQuery(/^oecom_(\d+)$/, async (ctx) => {
  ctx.session.state = 'oe_com'; ctx.session.data.editId = parseInt(ctx.match[1]);
  await ctx.editMessageText('Комментарий:'); await ctx.answerCallbackQuery();
});
bot.on('message:text').filter(c => c.session.state === 'oe_com', async (ctx) => {
  await supabase.from('заказы').update({ комментарий: ctx.message.text }).eq('id', ctx.session.data.editId);
  ctx.session.state = null;
  await ctx.reply('✅ Сохранено', { reply_markup: getKB(ctx.session.employee, ctx.session.shift) });
});

// =============================================
// 📊 СЕГОДНЯ
// =============================================
bot.hears('📊 Сегодня', async (ctx) => {
  const emp = ctx.session.employee;
  const filter = emp.роль !== 'Владелец' ? { продавец_id: emp.id } : {};
  const { data: orders } = await supabase.from('заказы')
    .select('итоговая_сумма, сумма_нал, сумма_безнал, позиции_в_заказах(количество)')
    .match(filter).eq('статус', 'Завершён').gte('дата_создания', today()+'T00:00:00');
  if (!orders?.length) return ctx.reply('📊 Нет продаж');
  const t=orders.reduce((s,o)=>s+(o.итоговая_сумма||0),0);
  const cn=orders.reduce((s,o)=>s+(o.позиции_в_заказах||[]).reduce((ss,p)=>ss+(p.количество||0),0),0);
  const ca=orders.reduce((s,o)=>s+(o.сумма_нал||0),0);
  const cd=orders.reduce((s,o)=>s+(o.сумма_безнал||0),0);
  await ctx.reply(`📊 Сегодня: ${orders.length} продаж\n📦 ${cn} банок\n💰 ${t}₽\n💵 ${ca}₽ | 💳 ${cd}₽`);
});

// =============================================
// 💼 ИНКАССАЦИЯ
// =============================================
bot.hears('💼 Инкассация', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Смену!');
  const sh = ctx.session.shift;
  const expected = (sh.нал_начало||0) + (sh.выручка_нал_факт||0) - (sh.доп_траты||0);
  ctx.session.state = 'inc_sum';
  await ctx.reply(
    `💼 Инкассация\n\n💵 Начало: ${sh.нал_начало||0}₽\n💵 Приход нал: ${sh.выручка_нал_факт||0}₽\n💸 Расходы: ${sh.доп_траты||0}₽\n💰 В кассе ~${expected}₽\n\nСколько забираете?`,
    { reply_markup: { remove_keyboard: true } });
});
bot.on('message:text').filter(c => c.session.state === 'inc_sum', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<=0) return ctx.reply('Сумма:');
  const emp = ctx.session.employee, sh = ctx.session.shift;
  await supabase.from('расходы').insert({
    точка_id: emp.точка_id, категория: 'Инкассация', сумма: n,
    описание: `Инкассация ${timeStr()}`, сотрудник_id: emp.id, смена_id: sh.id,
  });
  const tot = (sh.инкассация||0) + n;
  await supabase.from('смены').update({ инкассация: tot }).eq('id', sh.id);
  sh.инкассация = tot;
  ctx.session.state = null;
  await ctx.reply(`✅ Инкассация: ${n}₽ | Всего: ${tot}₽`, { reply_markup: getKB(emp, sh) });
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
  if (!ctx.session.shift) return ctx.reply('⚠️ Смену!');
  ctx.session.state = 'ex_desc';
  await ctx.reply('📝 Расход — описание:', { reply_markup: { remove_keyboard: true } });
});
bot.on('message:text').filter(c => c.session.state === 'ex_desc', async (ctx) => {
  ctx.session.data.exDesc = ctx.message.text; ctx.session.state = 'ex_sum';
  await ctx.reply('💰 Сумма:');
});
bot.on('message:text').filter(c => c.session.state === 'ex_sum', async (ctx) => {
  const n = parseFloat(ctx.message.text); if (isNaN(n)||n<=0) return ctx.reply('Сумма:');
  const emp = ctx.session.employee, desc = ctx.session.data.exDesc;
  await supabase.from('расходы').insert({ точка_id: emp.точка_id, категория: 'Доп траты', сумма: n, описание: desc, сотрудник_id: emp.id, смена_id: ctx.session.shift?.id });
  if (ctx.session.shift) { await supabase.from('смены').update({ доп_траты: (ctx.session.shift.доп_траты||0)+n }).eq('id', ctx.session.shift.id); ctx.session.shift.доп_траты = (ctx.session.shift.доп_траты||0)+n; }
  ctx.session.state = null; ctx.session.data = {};
  await ctx.reply(`✅ ${n}₽ — ${desc}`, { reply_markup: getKB(emp, ctx.session.shift) });
});

// =============================================
// ↩️ ВОЗВРАТ
// =============================================
bot.hears('↩️ Возврат', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Смену!');
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
  await supabase.from('возвраты').insert({ причина: ctx.session.data.rtReason, фото_упаковки: ctx.session.data.ph1, фото_содержимого: ctx.session.data.ph2, фото_дополнительное: fid, статус: 'На рассмотрении', продавец_id: emp.id });
  const { data: mgrs } = await supabase.from('сотрудники').select('telegram_id').in('роль', ['Редактор','Владелец']).eq('активен', true);
  for (const m of (mgrs||[])) { try { await bot.api.sendMessage(m.telegram_id, `↩️ Возврат от ${emp.имя}\n${ctx.session.data.rtReason}`); } catch {} }
  ctx.session.state = null; ctx.session.data = {};
  await ctx.reply('✅ Возврат отправлен!', { reply_markup: getKB(emp, ctx.session.shift) });
});

// =============================================
// 🔒 ЗАКРЫТЬ СМЕНУ (+ 2 фото чеков + разница)
// =============================================
bot.hears('🔒 Закрыть смену', async (ctx) => {
  if (!ctx.session.shift) return ctx.reply('⚠️ Нет смены!');
  ctx.session.state = 'sc_cans'; ctx.session.data = {};
  await ctx.reply('🔒 Закрытие\n\n📦 Банок на конец?', { reply_markup: { remove_keyboard: true } });
});
bot.on('message:text').filter(c=>c.session.state==='sc_cans', async (ctx) => {
  const n=parseInt(ctx.message.text); if(isNaN(n)||n<0) return ctx.reply('Число:');
  ctx.session.data.ecans=n; ctx.session.state='sc_soda'; await ctx.reply('🥤 Газировок?');
});
bot.on('message:text').filter(c=>c.session.state==='sc_soda', async (ctx) => {
  const n=parseInt(ctx.message.text); if(isNaN(n)||n<0) return ctx.reply('Число:');
  ctx.session.data.esoda=n; ctx.session.state='sc_cash'; await ctx.reply('💵 Нал в кассе?');
});
bot.on('message:text').filter(c=>c.session.state==='sc_cash', async (ctx) => {
  const n=parseFloat(ctx.message.text); if(isNaN(n)||n<0) return ctx.reply('Сумма:');
  ctx.session.data.ecash=n; ctx.session.state='sc_term'; await ctx.reply('🏧 Терминал?');
});
bot.on('message:text').filter(c=>c.session.state==='sc_term', async (ctx) => {
  const n=parseFloat(ctx.message.text); if(isNaN(n)||n<0) return ctx.reply('Сумма:');
  ctx.session.data.eterm=n; ctx.session.state='sc_ph1'; await ctx.reply('📷 Фото чека терминала (1/2):');
});
bot.on('message:photo').filter(c=>c.session.state==='sc_ph1', async (ctx) => {
  ctx.session.data.tph1=ctx.message.photo.at(-1).file_id; ctx.session.state='sc_ph2';
  await ctx.reply('📷 Фото чека (2/2):');
});
bot.on('message:photo').filter(c=>c.session.state==='sc_ph2', async (ctx) => {
  ctx.session.data.tph2=ctx.message.photo.at(-1).file_id;
  const kb=new InlineKeyboard().text('✅ Да','cl_y').text('❌ Нет','cl_n');
  await ctx.reply('🧹 Уборка?', { reply_markup: kb });
});

bot.callbackQuery(/^cl_(y|n)$/, async (ctx) => {
  const cleaned=ctx.match[1]==='y';
  const emp=ctx.session.employee, sh=ctx.session.shift, d=ctx.session.data;

  const cansUsed=(sh.банки_начало||0)-d.ecans;
  const shortage=cansUsed-(sh.банок_продано||0);
  const sodaUsed=(sh.газировка_начало||0)-d.esoda;
  const expectedCash=(sh.нал_начало||0)+(sh.выручка_нал_факт||0)-(sh.доп_траты||0)-(sh.инкассация||0);
  const cashDiff=d.ecash-expectedCash;
  const pct=calcSalaryPercent(sh.банок_продано||0);
  const sal=Math.round((emp.зп_база||2000)+((sh.выручка_общая||0)*pct/100));

  await supabase.from('смены').update({
    время_закрытия: now(), статус: 'Закрыта',
    банки_конец: d.ecans, газировка_конец: d.esoda,
    нал_конец: d.ecash, терминал_сумма: d.eterm,
    уборка_выполнена: cleaned,
    недостача_банки: Math.max(0, shortage),
    процент_зп: pct, зп_за_смену: sal,
  }).eq('id', sh.id);

  let r=`🔒 Смена закрыта! ${timeStr()}\n\n📅 ${today()}\n🏪 ${emp.точки?.название||''}\n\n`;
  r+=`📦 Банки: ${sh.банки_начало}→${d.ecans} (продано ${sh.банок_продано||0})`;
  if(shortage>0) r+=`\n⚠️ НЕДОСТАЧА: ${shortage} банок`;
  else if(shortage<0) r+=`\n✅ Лишних: ${Math.abs(shortage)}`;
  r+=`\n🥤 Газировки: ${sh.газировка_начало}→${d.esoda} (ушло ${sodaUsed})`;
  r+=`\n\n💰 Выручка: ${sh.выручка_общая||0}₽`;
  r+=`\n💳 Безнал: ${sh.выручка_безнал||0}₽`;
  r+=`\n💵 Нал факт: ${d.ecash}₽ (ожид: ${expectedCash}₽)`;
  if(cashDiff>0) r+=`\n✅ Излишек: +${cashDiff}₽`;
  else if(cashDiff<0) r+=`\n⚠️ НЕДОСТАЧА: ${Math.abs(cashDiff)}₽`;
  r+=`\n🏧 Терминал: ${d.eterm}₽`;
  if(sh.инкассация) r+=`\n💼 Инкассация: ${sh.инкассация}₽`;
  r+=`\n\n💵 ЗП: ${sal}₽ (${emp.зп_база||2000}+${pct}%)`;
  r+=`\n🧹 ${cleaned?'✅':'❌'}`;

  ctx.session.shift=null; ctx.session.state=null; ctx.session.data={};
  await ctx.editMessageText(r);
  await ctx.reply('Смена закрыта:', { reply_markup: getKB(emp, null) });

  if(OWNER_ID && emp.telegram_id!==OWNER_ID) { try { await bot.api.sendMessage(OWNER_ID, `📋 ${emp.имя} (${emp.точки?.название||'?'})\n${r}`); } catch {} }
  await ctx.answerCallbackQuery('Закрыта');
});

// =============================================
// 📈 ТОП ПРОДАЖ
// =============================================
bot.hears('📈 Топ продаж', async (ctx) => {
  if(ctx.session.employee?.роль!=='Владелец') return;
  const wa=new Date(Date.now()-7*86400000).toISOString().split('T')[0];
  const { data:dd }=await supabase.from('позиции_в_заказах')
    .select('количество, товары(название), заказы!inner(дата_создания,статус)')
    .gte('заказы.дата_создания', today()+'T00:00:00').eq('заказы.статус','Завершён');
  const { data:wd }=await supabase.from('позиции_в_заказах')
    .select('количество, товары(название), заказы!inner(дата_создания,статус)')
    .gte('заказы.дата_создания', wa+'T00:00:00').eq('заказы.статус','Завершён');
  function top(rows){const m={};(rows||[]).forEach(r=>{const n=r.товары?.название||'?';m[n]=(m[n]||0)+(r.количество||0);});return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,10);}
  const dt=top(dd),wt=top(wd);
  let t='📈 ТОП ПРОДАЖ\n\n📅 Сегодня:\n';
  if(dt.length) dt.forEach(([n,c],i)=>{t+=`${i+1}. ${n.substring(0,30)} — ${c}\n`;});
  else t+='—\n';
  t+='\n📅 Неделя:\n';
  if(wt.length) wt.forEach(([n,c],i)=>{t+=`${i+1}. ${n.substring(0,30)} — ${c}\n`;});
  else t+='—\n';
  await ctx.reply(t);
});

// =============================================
// 📊 СТАТИСТИКА
// =============================================
bot.hears('📊 Статистика', async (ctx) => {
  if(ctx.session.employee?.роль!=='Владелец') return;
  const { data:orders }=await supabase.from('заказы')
    .select('итоговая_сумма, сумма_нал, сумма_безнал, точки(название)')
    .eq('статус','Завершён').gte('дата_создания', today()+'T00:00:00');
  const { data:shifts }=await supabase.from('смены')
    .select('статус, банок_продано, выручка_общая, сотрудники(имя), точки(название)').eq('дата', today());
  const rev=(orders||[]).reduce((s,o)=>s+(o.итоговая_сумма||0),0);
  const ca=(orders||[]).reduce((s,o)=>s+(o.сумма_нал||0),0);
  const cd=(orders||[]).reduce((s,o)=>s+(o.сумма_безнал||0),0);
  const byPt={};(orders||[]).forEach(o=>{const p=o.точки?.название||'?';byPt[p]=(byPt[p]||0)+(o.итоговая_сумма||0);});
  let t=`📊 ${today()}\n\n💰 ${rev}₽ (💵${ca} / 💳${cd})\n📋 ${(orders||[]).length} заказов\n\n🏪 Точки:\n`;
  Object.entries(byPt).sort((a,b)=>b[1]-a[1]).forEach(([p,s])=>{t+=`  ${p}: ${s}₽\n`;});
  t+='\n👥 Смены:\n';
  (shifts||[]).forEach(s=>{t+=`  ${s.сотрудники?.имя||'?'} (${s.точки?.название||'?'}) ${s.статус}`;if(s.банок_продано)t+=` | ${s.банок_продано} бан`;t+='\n';});
  await ctx.reply(t);
});

// =============================================
// 💸 УДЕРЖАНИЯ
// =============================================
bot.hears('💸 Удержания', async (ctx) => {
  if(ctx.session.employee?.роль!=='Владелец') return;
  const kb=new InlineKeyboard().text('📋 Активные','ud_list').text('➕ Создать','ud_new');
  await ctx.reply('💸 Удержания:', { reply_markup: kb });
});
bot.callbackQuery('ud_list', async (ctx) => {
  const { data:uds }=await supabase.from('удержания').select('*, сотрудники!удержания_сотрудник_id_fkey(имя)').eq('статус','Активно');
  if(!uds?.length){await ctx.editMessageText('Нет активных');return ctx.answerCallbackQuery();}
  let t='💸:\n\n';uds.forEach(u=>{t+=`👤 ${u.сотрудники?.имя||'?'} | ${u.причина} | ${u.сумма_общая||u.сумма}₽\n\n`;});
  await ctx.editMessageText(t);await ctx.answerCallbackQuery();
});
bot.callbackQuery('ud_new', async (ctx) => {
  const { data:emps }=await supabase.from('сотрудники').select('id, имя').eq('активен', true).neq('роль','Владелец');
  const kb=new InlineKeyboard();(emps||[]).forEach(e=>kb.text(e.имя,`ude_${e.id}`).row());
  await ctx.editMessageText('На кого?',{reply_markup:kb});await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^ude_(\d+)$/,async(ctx)=>{ctx.session.data.udEmp=parseInt(ctx.match[1]);ctx.session.state='ud_reason';await ctx.editMessageText('Причина:');await ctx.answerCallbackQuery();});
bot.on('message:text').filter(c=>c.session.state==='ud_reason',async(ctx)=>{ctx.session.data.udReason=ctx.message.text;ctx.session.state='ud_sum';await ctx.reply('Сумма:');});
bot.on('message:text').filter(c=>c.session.state==='ud_sum',async(ctx)=>{const n=parseFloat(ctx.message.text);if(isNaN(n)||n<=0)return ctx.reply('Сумма:');ctx.session.data.udSum=n;ctx.session.state='ud_shifts';await ctx.reply('Смен для погашения:');});
bot.on('message:text').filter(c=>c.session.state==='ud_shifts',async(ctx)=>{
  const n=parseInt(ctx.message.text);if(isNaN(n)||n<1)return ctx.reply('Число:');
  const d=ctx.session.data;
  await supabase.from('удержания').insert({сотрудник_id:d.udEmp,причина:d.udReason,сумма:d.udSum,сумма_общая:d.udSum,смен_для_погашения:n,сумма_за_смену:Math.ceil(d.udSum/n),погашено_смен:0,статус:'Активно',назначил_id:ctx.session.employee.id});
  ctx.session.state=null;ctx.session.data={};
  await ctx.reply(`✅ ${d.udSum}₽ за ${n} смен`,{reply_markup:getKB(ctx.session.employee,ctx.session.shift)});
});

// =============================================
// 📦 ПОСТУПЛЕНИЕ (через каталог кнопками)
// =============================================
bot.hears('📦 Поступление', async (ctx) => {
  if(!isManager(ctx.session.employee)) return;
  const { data:pts }=await supabase.from('точки').select('id, название').eq('активна', true);
  const kb=new InlineKeyboard();(pts||[]).forEach(p=>kb.text(`🏪 ${p.название}`,`rcpt_${p.id}`).row());
  ctx.session.data={recvItems:[]};
  await ctx.reply('📦 На какую точку?',{reply_markup:kb});
});

bot.callbackQuery(/^rcpt_(\d+)$/,async(ctx)=>{
  ctx.session.data.rcPt=parseInt(ctx.match[1]);
  const { data:pt }=await supabase.from('точки').select('название').eq('id',ctx.session.data.rcPt).single();
  ctx.session.data.rcPtName=pt?.название;
  await showRcBrands(ctx);await ctx.answerCallbackQuery();
});

async function showRcBrands(ctx){
  const { data }=await supabase.from('товары').select('бренд').eq('активен', true);
  const brands=[...new Set((data||[]).map(x=>x.бренд).filter(Boolean))].sort();
  const kb=new InlineKeyboard();
  brands.forEach(b=>{kb.text(`📦 ${b}`,`rcb_${encodeURIComponent(b)}`).row();});
  kb.text('✅ Завершить','rc_done');
  try{await ctx.editMessageText(`📦 → ${ctx.session.data.rcPtName}\n\nМарка:`,{reply_markup:kb});}
  catch{await ctx.reply(`📦 → ${ctx.session.data.rcPtName}\n\nМарка:`,{reply_markup:kb});}
}

bot.callbackQuery(/^rcb_(.+)$/,async(ctx)=>{
  const brand=decodeURIComponent(ctx.match[1]);ctx.session.data.rcBrand=brand;
  const { data }=await supabase.from('товары').select('линейка').eq('бренд',brand).eq('активен', true);
  const lines=[...new Set((data||[]).map(x=>x.линейка).filter(Boolean))].sort();
  const kb=new InlineKeyboard();lines.forEach(l=>{kb.text(`📋 ${l}`,`rcl_${encodeURIComponent(l)}`).row();});
  kb.text('⬅️ Марки','rc_tobr').row().text('✅ Завершить','rc_done');
  await ctx.editMessageText(`📦 ${brand}\nЛинейка:`,{reply_markup:kb});await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^rcl_(.+)$/,async(ctx)=>{
  const line=decodeURIComponent(ctx.match[1]);ctx.session.data.rcLine=line;
  const brand=ctx.session.data.rcBrand;
  const { data:products }=await supabase.from('товары').select('id, вкус, название')
    .eq('бренд',brand).eq('линейка',line).eq('активен', true).order('вкус');
  const kb=new InlineKeyboard();
  (products||[]).forEach(p=>{kb.text(`🔹 ${(p.вкус||p.название).substring(0,40)}`,`rcf_${p.id}`).row();});
  kb.text('⬅️ Линейки',`rcbl_${encodeURIComponent(brand)}`).text('⬅️ Марки','rc_tobr').row();
  kb.text('✅ Завершить','rc_done');
  await ctx.editMessageText(`📦 ${brand} • ${line}\nВкус:`,{reply_markup:kb});await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^rcf_(\d+)$/,async(ctx)=>{
  ctx.session.data.rcProd=parseInt(ctx.match[1]);
  const { data:p }=await supabase.from('товары').select('название').eq('id',ctx.session.data.rcProd).single();
  ctx.session.data.rcProdName=p?.название;ctx.session.state='rc_qty';
  await ctx.editMessageText(`📦 ${p?.название}\nКоличество:`);await ctx.answerCallbackQuery();
});

bot.on('message:text').filter(c=>c.session.state==='rc_qty',async(ctx)=>{
  const qty=parseInt(ctx.message.text);if(isNaN(qty)||qty<1)return ctx.reply('Число:');
  const d=ctx.session.data;
  const { data:inv }=await supabase.from('инвентарь').select('id, количество').eq('товар_id',d.rcProd).eq('точка_id',d.rcPt).single();
  if(inv) await supabase.from('инвентарь').update({количество:inv.количество+qty,последнее_обновление:now()}).eq('id',inv.id);
  else await supabase.from('инвентарь').insert({товар_id:d.rcProd,точка_id:d.rcPt,количество:qty});
  await supabase.from('движения').insert({товар_id:d.rcProd,точка_куда_id:d.rcPt,тип_операции:'Поступление',количество:qty,сотрудник_id:ctx.session.employee.id,комментарий:`→ ${d.rcPtName}`});
  d.recvItems.push({name:d.rcProdName,qty});
  ctx.session.state=null;
  await ctx.reply(`✅ +${qty} ${d.rcProdName}`);
  await showRcBrands(ctx);
});

bot.callbackQuery('rc_tobr',async(ctx)=>{await showRcBrands(ctx);await ctx.answerCallbackQuery();});
bot.callbackQuery(/^rcbl_(.+)$/,async(ctx)=>{
  const brand=decodeURIComponent(ctx.match[1]);ctx.session.data.rcBrand=brand;
  const { data }=await supabase.from('товары').select('линейка').eq('бренд',brand).eq('активен', true);
  const lines=[...new Set((data||[]).map(x=>x.линейка).filter(Boolean))].sort();
  const kb=new InlineKeyboard();lines.forEach(l=>{kb.text(`📋 ${l}`,`rcl_${encodeURIComponent(l)}`).row();});
  kb.text('⬅️ Марки','rc_tobr').row().text('✅ Завершить','rc_done');
  await ctx.editMessageText(`📦 ${brand}\nЛинейка:`,{reply_markup:kb});await ctx.answerCallbackQuery();
});

bot.callbackQuery('rc_done',async(ctx)=>{
  const items=ctx.session.data.recvItems||[];
  let t=`📦 → ${ctx.session.data.rcPtName||'?'}:\n\n`;
  items.forEach(i=>{t+=`✅ ${i.name.substring(0,30)} — ${i.qty}\n`;});
  if(!items.length) t+='Пусто';
  ctx.session.state=null;ctx.session.data={};
  await ctx.editMessageText(t);await ctx.answerCallbackQuery();
  await ctx.reply('Меню:',{reply_markup:getKB(ctx.session.employee,ctx.session.shift)});
});

// =============================================
// 🔄 ПЕРЕМЕЩЕНИЕ
// =============================================
bot.hears('🔄 Перемещение',async(ctx)=>{
  if(!isManager(ctx.session.employee)) return;
  const { data:pts }=await supabase.from('точки').select('id, название').eq('активна', true);
  const kb=new InlineKeyboard();(pts||[]).forEach(p=>kb.text(`🏪 ${p.название}`,`mvf_${p.id}`).row());
  ctx.session.data={mvItems:[]};
  await ctx.reply('🔄 ОТКУДА?',{reply_markup:kb});
});
bot.callbackQuery(/^mvf_(\d+)$/,async(ctx)=>{
  ctx.session.data.mvFrom=parseInt(ctx.match[1]);
  const { data:pt }=await supabase.from('точки').select('название').eq('id',ctx.session.data.mvFrom).single();
  ctx.session.data.mvFromName=pt?.название;
  const { data:pts }=await supabase.from('точки').select('id, название').eq('активна', true).neq('id',ctx.session.data.mvFrom);
  const kb=new InlineKeyboard();(pts||[]).forEach(p=>kb.text(`🏪 ${p.название}`,`mvt_${p.id}`).row());
  await ctx.editMessageText(`${pt?.название} → ?\n\nКУДА?`,{reply_markup:kb});await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^mvt_(\d+)$/,async(ctx)=>{
  ctx.session.data.mvTo=parseInt(ctx.match[1]);
  const { data:pt }=await supabase.from('точки').select('название').eq('id',ctx.session.data.mvTo).single();
  ctx.session.data.mvToName=pt?.название;ctx.session.state='mv_search';
  await ctx.editMessageText(`🔄 ${ctx.session.data.mvFromName} → ${pt?.название}\n\n🔍 Название товара:`);await ctx.answerCallbackQuery();
});
bot.on('message:text').filter(c=>c.session.state==='mv_search',async(ctx)=>{
  const { data:prods }=await supabase.from('товары').select('id, название').ilike('название',`%${ctx.message.text.trim()}%`).eq('активен', true).limit(10);
  if(!prods?.length) return ctx.reply('Не найдено:');
  const kb=new InlineKeyboard();prods.forEach(p=>kb.text(p.название.substring(0,35),`mvp_${p.id}`).row());kb.text('✅ Готово','mv_done');
  await ctx.reply('Выберите:',{reply_markup:kb});
});
bot.callbackQuery(/^mvp_(\d+)$/,async(ctx)=>{
  const d=ctx.session.data;d.mvProd=parseInt(ctx.match[1]);
  const { data:p }=await supabase.from('товары').select('название').eq('id',d.mvProd).single();
  d.mvProdName=p?.название;
  const { data:inv }=await supabase.from('инвентарь').select('количество').eq('товар_id',d.mvProd).eq('точка_id',d.mvFrom).single();
  ctx.session.state='mv_qty';
  await ctx.editMessageText(`📦 ${p?.название}\n📍 ${d.mvFromName}: ${inv?.количество||0}\nСколько?`);await ctx.answerCallbackQuery();
});
bot.on('message:text').filter(c=>c.session.state==='mv_qty',async(ctx)=>{
  const qty=parseInt(ctx.message.text);if(isNaN(qty)||qty<1)return ctx.reply('Число:');
  const d=ctx.session.data;
  const { data:from }=await supabase.from('инвентарь').select('id, количество').eq('товар_id',d.mvProd).eq('точка_id',d.mvFrom).single();
  if(from) await supabase.from('инвентарь').update({количество:Math.max(0,from.количество-qty),последнее_обновление:now()}).eq('id',from.id);
  const { data:to }=await supabase.from('инвентарь').select('id, количество').eq('товар_id',d.mvProd).eq('точка_id',d.mvTo).single();
  if(to) await supabase.from('инвентарь').update({количество:to.количество+qty,последнее_обновление:now()}).eq('id',to.id);
  else await supabase.from('инвентарь').insert({товар_id:d.mvProd,точка_id:d.mvTo,количество:qty});
  await supabase.from('движения').insert({товар_id:d.mvProd,точка_откуда_id:d.mvFrom,точка_куда_id:d.mvTo,тип_операции:'Перемещение',количество:qty,сотрудник_id:ctx.session.employee.id,комментарий:`${d.mvFromName}→${d.mvToName}`});
  d.mvItems.push({name:d.mvProdName,qty});ctx.session.state='mv_search';
  const kb=new InlineKeyboard().text('✅ Готово','mv_done');
  await ctx.reply(`✅ ${d.mvProdName} ×${qty}: ${d.mvFromName}→${d.mvToName}`,{reply_markup:kb});
});
bot.callbackQuery('mv_done',async(ctx)=>{
  const d=ctx.session.data;let t=`🔄 ${d.mvFromName}→${d.mvToName}:\n\n`;
  (d.mvItems||[]).forEach(i=>{t+=`✅ ${i.name.substring(0,30)} — ${i.qty}\n`;});
  ctx.session.state=null;ctx.session.data={};
  await ctx.editMessageText(t);await ctx.answerCallbackQuery();
  await ctx.reply('Меню:',{reply_markup:getKB(ctx.session.employee,ctx.session.shift)});
});

// =============================================
// 📋 ЗАКАЗЫ (входящие)
// =============================================
bot.hears('📋 Заказы',async(ctx)=>{
  const emp=ctx.session.employee;
  const filter=emp.роль!=='Владелец'&&emp.точка_id?{точка_id:emp.точка_id}:{};
  const { data:orders }=await supabase.from('заказы').select('*, клиенты(имя, уникальный_номер)')
    .match(filter).in('статус',['Новый','Подтверждён','Готов']).order('дата_создания').limit(10);
  if(!orders?.length) return ctx.reply('✅ Нет входящих');
  for(const o of orders){
    const kb=new InlineKeyboard().text('✅ Готов',`or_${o.id}`).text('🤝 Выдан',`od_${o.id}`).row().text('❌ Отмена',`oc_${o.id}`);
    await ctx.reply(`📋 ${o.номер_заказа}\n👤 ${o.клиенты?.имя||'?'}\n💰 ${o.итоговая_сумма}₽`,{reply_markup:kb});
  }
});
bot.callbackQuery(/^o(r|d|c)_(\d+)$/,async(ctx)=>{
  const m={r:'Готов',d:'Завершён',c:'Отменён'};const upd={статус:m[ctx.match[1]]};
  if(ctx.match[1]==='d')upd.время_выдачи=now();
  await supabase.from('заказы').update(upd).eq('id',parseInt(ctx.match[2]));
  await ctx.editMessageText(ctx.msg.text+`\n→ ${m[ctx.match[1]]}`);await ctx.answerCallbackQuery(m[ctx.match[1]]);
});

// =============================================
// 📝 ЗАДАЧИ
// =============================================
bot.hears('📝 Задачи',async(ctx)=>{
  const { data:tasks }=await supabase.from('задачи').select('*').eq('исполнитель_id',ctx.session.employee.id).in('статус',['Новая','В работе']).order('срок');
  if(!tasks?.length) return ctx.reply('✅ Нет задач');
  let t=`📝 (${tasks.length}):\n\n`;tasks.forEach(tk=>{t+=`${tk.статус==='Новая'?'🆕':'🔄'} ${tk.описание}\n`;});
  await ctx.reply(t);
});

// =============================================
// 👥 СОТРУДНИКИ + ➕👤
// =============================================
bot.hears('👥 Сотрудники',async(ctx)=>{
  if(ctx.session.employee?.роль!=='Владелец') return;
  const { data:emps }=await supabase.from('сотрудники').select('*, точки(название)').eq('активен', true).order('роль');
  let t=`👥 (${(emps||[]).length}):\n\n`;
  (emps||[]).forEach(e=>{t+=`${{Продавец:'🏪',Курьер:'🚗',Редактор:'✏️',Бухгалтер:'📊',Владелец:'👑'}[e.роль]||'👤'} ${e.имя} — ${e.роль}\n   ${e.точки?.название||'—'} | ${e.telegram_id}\n\n`;});
  await ctx.reply(t);
});

bot.hears('➕👤 Сотрудник',async(ctx)=>{
  if(ctx.session.employee?.роль!=='Владелец') return;
  ctx.session.state='ae_tg';await ctx.reply('📱 Telegram ID:',{reply_markup:{remove_keyboard:true}});
});
bot.on('message:text').filter(c=>c.session.state==='ae_tg',async(ctx)=>{
  const id=parseInt(ctx.message.text);if(isNaN(id))return ctx.reply('Число:');
  ctx.session.data.aeTg=id;ctx.session.state='ae_name';await ctx.reply('👤 Имя:');
});
bot.on('message:text').filter(c=>c.session.state==='ae_name',async(ctx)=>{
  ctx.session.data.aeName=ctx.message.text;ctx.session.state='ae_role';
  const kb=new InlineKeyboard().text('🏪 Продавец','ar_Продавец').text('🚗 Курьер','ar_Курьер').row().text('✏️ Редактор','ar_Редактор').text('📊 Бухгалтер','ar_Бухгалтер');
  await ctx.reply('Роль:',{reply_markup:kb});
});
bot.callbackQuery(/^ar_(.+)$/,async(ctx)=>{
  ctx.session.data.aeRole=ctx.match[1];
  const { data:pts }=await supabase.from('точки').select('id, название').eq('активна', true);
  const kb=new InlineKeyboard();(pts||[]).forEach(p=>kb.text(`🏪 ${p.название}`,`ap_${p.id}`).row());kb.text('Без','ap_0');
  await ctx.editMessageText('Точка:');await ctx.reply('Выберите:',{reply_markup:kb});await ctx.answerCallbackQuery();
});
bot.callbackQuery(/^ap_(\d+)$/,async(ctx)=>{
  const d=ctx.session.data;
  const { error }=await supabase.from('сотрудники').insert({telegram_id:d.aeTg,имя:d.aeName,роль:d.aeRole,точка_id:parseInt(ctx.match[1])||null,активен:true,зп_база:2000});
  if(error){await ctx.answerCallbackQuery();return ctx.editMessageText(`❌ ${error.message}`);}
  ctx.session.state=null;ctx.session.data={};
  await ctx.editMessageText(`✅ ${d.aeName} — ${d.aeRole}\n/start в боте`);await ctx.answerCallbackQuery('✅');
});

// =============================================
bot.hears(/^─+/,()=>{});
bot.on('message:text',async(ctx)=>{if(ctx.session.state) return ctx.reply('⚠️ /start');});
bot.catch((err)=>console.error('Bot error:',err));
bot.start({onStart:()=>console.log('🤖 TTS Staff Bot v4!')});
